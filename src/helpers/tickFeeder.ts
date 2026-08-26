import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import axios from 'axios';
import { env } from '../config/env.js';
import { positionStore } from '../store/index.js';
import { getBrokerAuthSession, resetBrokerAuthSession } from './login.js';
import { modeManager } from './modeManager.js';
import { notifyAlert } from '../alerts/notifier.js';
import { loadScripMaster, resolveTokensFromScripMaster } from './scripMaster.js';

export interface ParsedTick {
  token: string;
  ltp: number;
  exchangeType?: number;
}

export function buildSubscribeMessage(tokens: string[], correlationId = 'position-monitor-feeder') {
  return JSON.stringify({
    correlationId,
    action: 1, // Subscribe
    params: {
      mode: 1, // LTP mode
      tokenList: [{ exchangeType: 2, tokens }], // 2 = NFO
    },
  });
}

export function parseSmartStreamPacket(data: Buffer | ArrayBuffer): ParsedTick | null {
  try {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length < 47) return null;

    // SmartAPI SmartStream binary protocol structure (LTP Mode / Mode 1):
    // Byte 0: Subscription Mode (1 = LTP)
    // Byte 1: Exchange Type (1 = NSE, 2 = NFO, etc.)
    // Bytes 2..26: Token string (25 bytes, null-padded)
    // Bytes 27..34 (8 bytes, int64): Sequence Number
    // Bytes 35..42 (8 bytes, int64): Exchange Timestamp
    // Bytes 43..46 (4 bytes, int32): Last Traded Price (LTP in paise, divide by 100)
    const mode = buf.readInt8(0);
    if (mode !== 1) return null;

    const tokenRaw = buf.toString('utf8', 2, 27).replace(/\0/g, '').trim();
    if (!tokenRaw) return null;

    const ltpPaise = buf.readInt32LE(43);
    const ltp = ltpPaise / 100;

    // Guard A — LTP plausibility check
    if (!isFinite(ltp) || ltp <= 0 || ltp > 1_000_000) {
      const hexDump = buf.subarray(0, Math.min(buf.length, 60)).toString('hex');
      notifyAlert(
        `[tickFeeder] Rejected implausible LTP: token=${tokenRaw} raw=${hexDump} ltp=${ltp}`,
      );
      return null;
    }

    return {
      token: tokenRaw,
      ltp,
      exchangeType: buf[1],
    };
  } catch {
    return null;
  }
}

export function isMarketHours(now = new Date()): boolean {
  // IST is UTC + 5:30
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 330 * 60000);

  const day = ist.getDay();
  if (day === 0 || day === 6) return false; // Weekend

  const hour = ist.getHours();
  const minute = ist.getMinutes();
  const timeInMins = hour * 60 + minute;

  // 09:15 = 555 mins, 15:30 = 930 mins
  return timeInMins >= 555 && timeInMins <= 930;
}

let wsInstance: WebSocket | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let refreshInterval: NodeJS.Timeout | null = null;
let repairInterval: NodeJS.Timeout | null = null;
let watchedTokens: string[] = [];
const lastTickAtMap: Map<string, number> = new Map();
let lastAnyTickAt = 0;
let isRepairing = false;
let repairCooldownUntil = 0;

export async function forwardTicksToWebhook(ticks: { token: string; ltp: number }[]) {
  if (!ticks || ticks.length === 0) return;
  try {
    await axios.post(env.MONITOR_WEBHOOK_URL, { ticks }, { timeout: 5000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notifyAlert(`[tickFeeder] Failed to POST tick batch to webhook: ${msg}`);
  }
}

export function getWatchedTokensFromStore(): string[] {
  const positions = positionStore.getPositions();
  const tokensSet = new Set<string>();
  for (const pos of positions.values()) {
    if (pos.status === 'OPEN') {
      for (const leg of pos.legs) {
        if (leg.status === 'OPEN' && leg.token) {
          tokensSet.add(leg.token);
        }
      }
    }
  }
  return Array.from(tokensSet);
}

export async function executeRepairLadder(): Promise<void> {
  if (isRepairing) return;
  if (Date.now() < repairCooldownUntil) return;

  isRepairing = true;
  notifyAlert('[tickFeeder] Stale tick detected — executing repair ladder');

  try {
    // Step 1: Re-subscribe
    notifyAlert('[tickFeeder] Re-subscribing (step 1)');
    watchedTokens = getWatchedTokensFromStore();
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN && watchedTokens.length > 0) {
      wsInstance.send(buildSubscribeMessage(watchedTokens));
    }

    // Short delay to check if ticks start arriving
    await new Promise((r) => setTimeout(r, 5000));
    if (Date.now() - lastAnyTickAt < 10000) {
      notifyAlert('[tickFeeder] Feed recovered — ticks flowing again after re-subscribe');
      isRepairing = false;
      return;
    }

    // Step 2: Re-login + reconnect
    notifyAlert('[tickFeeder] Re-login + reconnect (step 2)');
    resetBrokerAuthSession();
    await connectWebSocket();

    await new Promise((r) => setTimeout(r, 5000));
    if (Date.now() - lastAnyTickAt < 10000) {
      notifyAlert('[tickFeeder] Feed recovered — ticks flowing again after re-login');
      isRepairing = false;
      return;
    }

    // Step 3: Token refresh via scrip master
    notifyAlert('[tickFeeder] Token refresh via scrip master (step 3)');
    const scripMaster = await loadScripMaster();
    const positions = Array.from(positionStore.getPositions().values());

    let fileUpdated = false;
    for (const pos of positions) {
      if (pos.status !== 'OPEN') continue;
      const openLegs = pos.legs.filter((l) => l.status === 'OPEN');
      const { tokenMap, missingSymbols } = resolveTokensFromScripMaster(openLegs, scripMaster);

      for (const sym of missingSymbols) {
        notifyAlert(`[tickFeeder] Symbol not in scrip master: ${sym}`);
      }

      let posChanged = false;
      for (const leg of pos.legs) {
        if (leg.status === 'OPEN') {
          const resolved = tokenMap.get(leg.symbol);
          if (resolved && resolved !== leg.token) {
            notifyAlert(
              `[tickFeeder] Token corrected via scrip master: ${leg.token} -> ${resolved} (${leg.symbol})`,
            );
            leg.token = resolved;
            posChanged = true;
            fileUpdated = true;
          }
        }
      }

      if (posChanged) {
        const filePath = path.join(env.POSITIONS_DIR, `${pos.positionId}.json`);
        try {
          fs.writeFileSync(filePath, JSON.stringify(pos, null, 2), 'utf-8');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          notifyAlert(`[tickFeeder] Failed to update position file ${pos.positionId}: ${msg}`);
        }
      }
    }

    if (fileUpdated) {
      positionStore.loadPositionsFromDir(env.POSITIONS_DIR);
    }

    watchedTokens = getWatchedTokensFromStore();
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN && watchedTokens.length > 0) {
      wsInstance.send(buildSubscribeMessage(watchedTokens));
    }

    await new Promise((r) => setTimeout(r, 5000));
    if (Date.now() - lastAnyTickAt < 10000) {
      notifyAlert('[tickFeeder] Feed recovered — ticks flowing again after scrip master update');
      isRepairing = false;
      return;
    }

    // Step 4: Escalation guard
    notifyAlert('[tickFeeder] FEED DOWN after repair cycle — manual intervention needed');
    repairCooldownUntil = Date.now() + 5 * 60 * 1000; // 5 min cooldown
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notifyAlert(`[tickFeeder] Error during repair ladder execution: ${msg}`);
  } finally {
    isRepairing = false;
  }
}

export function checkFeedHealth(): void {
  if (!isMarketHours()) return;
  if (modeManager.isKillMode()) return;

  const maxAgeMs = env.STALE_TICK_SECONDS * 1000;
  const now = Date.now();
  watchedTokens = getWatchedTokensFromStore();

  if (watchedTokens.length === 0) return;

  // Global silence check
  if (lastAnyTickAt > 0 && now - lastAnyTickAt > maxAgeMs) {
    executeRepairLadder().catch(() => {});
    return;
  }

  // Per-token silence check
  for (const token of watchedTokens) {
    const lastAt = lastTickAtMap.get(token) || 0;
    if (lastAt > 0 && now - lastAt > maxAgeMs) {
      executeRepairLadder().catch(() => {});
      return;
    }
  }
}

export async function connectWebSocket(): Promise<void> {
  if (modeManager.isKillMode()) {
    notifyAlert('[tickFeeder] Kill mode enabled — skipping WebSocket connect');
    return;
  }

  const session = await getBrokerAuthSession();
  if (!session) {
    notifyAlert('[tickFeeder] Unable to obtain broker credentials for SmartAPI WebSocket');
    return;
  }

  if (wsInstance) {
    try {
      wsInstance.close();
    } catch {
      // ignore
    }
  }

  watchedTokens = getWatchedTokensFromStore();

  const ws = new WebSocket(env.FEEDER_WS_URL, {
    headers: {
      Authorization: `Bearer ${session.jwtToken}`,
      'x-feed-token': session.feedToken,
    },
  });

  wsInstance = ws;

  let consecutiveCloseCount = 0;

  ws.on('open', () => {
    consecutiveCloseCount = 0;
    console.log(
      `Tick feeder started — watching ${watchedTokens.length} tokens: ${watchedTokens.join(', ')}`,
    );
    if (watchedTokens.length > 0) {
      ws.send(buildSubscribeMessage(watchedTokens));
    }

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
  });

  ws.on('message', (data: Buffer) => {
    const tick = parseSmartStreamPacket(data);
    if (tick) {
      const now = Date.now();
      lastAnyTickAt = now;
      lastTickAtMap.set(tick.token, now);
      forwardTicksToWebhook([{ token: tick.token, ltp: tick.ltp }]).catch(() => {});
    }
  });

  ws.on('error', (err: Error) => {
    notifyAlert(`[tickFeeder] WebSocket error: ${err.message}`);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    const reasonStr = reason.toString();
    consecutiveCloseCount++;

    if (consecutiveCloseCount >= 3) {
      notifyAlert(
        `[tickFeeder] WebSocket closed repeatedly (count=${consecutiveCloseCount}) code=${code} reason=${reasonStr}`,
      );
    } else {
      console.warn(
        `[tickFeeder] WebSocket closed code=${code} reason=${reasonStr} (attempt ${consecutiveCloseCount})`,
      );
    }

    if (heartbeatInterval) clearInterval(heartbeatInterval);

    // Re-login if unauthorized
    if (code === 4401 || code === 4001 || reasonStr.includes('unauthorized')) {
      resetBrokerAuthSession();
    }

    const backoffMs = Math.min(30000, 5000 * Math.pow(1.5, consecutiveCloseCount - 1));
    setTimeout(() => {
      if (!modeManager.isKillMode()) {
        connectWebSocket().catch(() => {});
      }
    }, backoffMs);
  });
}

export function startTickFeeder(): void {
  // Load initial tokens
  positionStore.loadPositionsFromDir(env.POSITIONS_DIR);
  watchedTokens = getWatchedTokensFromStore();

  connectWebSocket().catch(() => {});

  // Morning refresh timer (default 09:10 IST)
  refreshInterval = setInterval(() => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const ist = new Date(utc + 330 * 60000);

    const timeStr = `${String(ist.getHours()).padStart(2, '0')}:${String(ist.getMinutes()).padStart(2, '0')}`;
    if (timeStr === env.FEEDER_REFRESH_TIME && ist.getSeconds() < 10) {
      notifyAlert('[tickFeeder] Morning refresh triggered — re-logging and re-subscribing');
      resetBrokerAuthSession();
      positionStore.loadPositionsFromDir(env.POSITIONS_DIR);
      connectWebSocket().catch(() => {});
    }
  }, 10000);

  // Stale tick repair health loop (check every 15s)
  repairInterval = setInterval(() => {
    checkFeedHealth();
  }, 15000);
}

export function stopTickFeeder(): void {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (refreshInterval) clearInterval(refreshInterval);
  if (repairInterval) clearInterval(repairInterval);

  if (wsInstance) {
    try {
      wsInstance.close();
    } catch {
      // ignore
    }
    wsInstance = null;
  }
}
