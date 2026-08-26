import fs from 'node:fs';
import path from 'node:path';
import { Position } from '../types/position.js';
import { modeManager } from '../helpers/modeManager.js';
import { positionStore } from '../store/index.js';
import { getBrokerSessionToken } from '../helpers/login.js';
import { placeBrokerExitOrder, OrderPayload } from '../helpers/api.js';
import { notifyAlert } from '../alerts/notifier.js';
import { writeMTMLogLine } from './mtmLogger.js';
import { env } from '../config/env.js';

function getISTDateString(d = new Date()): string {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 330 * 60000);
  return ist.toISOString().split('T')[0];
}

export async function executePositionExit(
  position: Position,
  reason: 'PROFIT_TARGET' | 'STOP_LOSS',
  currentMTM: number,
): Promise<{ success: boolean; closedLegs: string[]; failedLegs: string[] }> {
  const posId = position.positionId;

  if (modeManager.isPanicMode()) {
    notifyAlert(`[${posId}] .panic switch is ACTIVE! Exit order placement BLOCKED.`);
    return { success: false, closedLegs: [], failedLegs: position.legs.map((l) => l.legId) };
  }

  if (modeManager.isKillMode()) {
    notifyAlert(`[${posId}] .kill switch is ACTIVE! Exit order placement BLOCKED.`);
    return { success: false, closedLegs: [], failedLegs: position.legs.map((l) => l.legId) };
  }

  const margin = positionStore.getPositionMargin(position);
  if (margin !== null && margin > 0 && Math.abs(currentMTM) > margin * 5) {
    notifyAlert(
      `[${posId}] REFUSING exit: MTM ₹${currentMTM.toFixed(2)} is ${(Math.abs(currentMTM) / margin).toFixed(0)}x margin — data error, not a real signal.`,
    );
    return { success: false, closedLegs: [], failedLegs: position.legs.map((l) => l.legId) };
  }

  // FIX 2c: In-flight guard
  if (positionStore.isExitInFlight(posId)) {
    return { success: false, closedLegs: [], failedLegs: [] };
  }

  positionStore.markExitInFlight(posId, true);

  try {
    writeMTMLogLine(posId, position.index, currentMTM);

    const todayIST = getISTDateString();
    const nowMs = Date.now();

    position.exitState = position.exitState || {};
    const exitState = position.exitState;

    // Reset daily attempt counter if new IST day
    if (exitState.lastAttemptDate !== todayIST) {
      exitState.attemptCount = 0;
      exitState.lastAttemptDate = todayIST;
    }

    // Check rate limit backoff (FIX 3)
    if (exitState.blockedUntil) {
      const blockedUntilMs = new Date(exitState.blockedUntil).getTime();
      if (nowMs < blockedUntilMs) {
        return { success: false, closedLegs: [], failedLegs: position.legs.map((l) => l.legId) };
      } else {
        delete exitState.blockedUntil;
      }
    }

    // Check retry cooldown (FIX 2a)
    if (exitState.lastAttemptAt) {
      const lastAttemptMs = new Date(exitState.lastAttemptAt).getTime();
      if (nowMs < lastAttemptMs + env.EXIT_RETRY_COOLDOWN_MS) {
        return { success: false, closedLegs: [], failedLegs: [] };
      }
    }

    // Check max daily attempt cap (FIX 2b)
    const currentAttempts = exitState.attemptCount || 0;
    if (currentAttempts >= env.EXIT_MAX_ATTEMPTS_PER_DAY) {
      notifyAlert(
        `[${posId}] Exit attempts exhausted (${currentAttempts}/${env.EXIT_MAX_ATTEMPTS_PER_DAY}) — manual intervention required`,
      );
      return { success: false, closedLegs: [], failedLegs: position.legs.map((l) => l.legId) };
    }

    const isPaper = modeManager.isPaperMode();
    let jwtToken: string | null = null;

    if (!isPaper) {
      jwtToken = await getBrokerSessionToken();
      if (!jwtToken) {
        notifyAlert(`[${posId}] Failed to obtain broker session token for exit execution.`);
      }
    }

    const closedLegs: string[] = [];
    const failedLegs: string[] = [];
    let rateLimitHit = false;
    let anyLegAttempted = false;

    for (const leg of position.legs) {
      if (leg.status !== 'OPEN') {
        continue;
      }

      const ltpInfo = positionStore.getLtpInfo(leg.token);
      const currentLTP = ltpInfo ? ltpInfo.ltp : 0;

      if (currentLTP < env.WORTHLESS_LTP_THRESHOLD) {
        leg.status = 'EXPIRED_UNBOOKED';
        closedLegs.push(leg.legId);
        continue;
      }

      const exitSide: 'BUY' | 'SELL' = leg.side === 'BUY' ? 'SELL' : 'BUY';
      const exchange = position.index === 'SENSEX' ? 'BFO' : 'NFO';

      const orderPayload: OrderPayload = {
        tradingsymbol: leg.symbol,
        symboltoken: leg.token,
        transactiontype: exitSide,
        exchange: exchange as 'NFO' | 'BFO',
        ordertype: 'MARKET',
        producttype: 'CARRYFORWARD',
        quantity: leg.qty,
        variety: 'NORMAL',
        duration: 'DAY',
      };

      if (isPaper) {
        leg.status = 'CLOSED';
        closedLegs.push(leg.legId);
      } else {
        if (!jwtToken) {
          failedLegs.push(leg.legId);
          notifyAlert(`[${posId}] Cannot place exit order for leg ${leg.legId}: No JWT token.`);
          continue;
        }

        anyLegAttempted = true;
        let res = await placeBrokerExitOrder(jwtToken, orderPayload);

        // FIX 2d: Session refresh on 401 or 403
        if (!res.success && (res.status === 401 || res.status === 403) && !res.rateLimited) {
          const { resetBrokerAuthSession } = await import('../helpers/login.js');
          resetBrokerAuthSession();
          const freshToken = await getBrokerSessionToken();
          if (freshToken) {
            jwtToken = freshToken;
            res = await placeBrokerExitOrder(jwtToken, orderPayload);
          }
        }

        if (res.success) {
          leg.status = 'CLOSED';
          closedLegs.push(leg.legId);
        } else {
          failedLegs.push(leg.legId);
          if (res.rateLimited) {
            rateLimitHit = true;
          }
          notifyAlert(
            `[${posId}] Exit order failed for leg ${leg.legId} (${leg.symbol}): ${res.error}`,
          );
        }
      }
    }

    if (anyLegAttempted || failedLegs.length > 0) {
      exitState.lastAttemptAt = new Date(nowMs).toISOString();
      exitState.lastAttemptDate = todayIST;
      exitState.attemptCount = (exitState.attemptCount || 0) + 1;
      if (failedLegs.length > 0) {
        exitState.lastError = `Failed legs: ${failedLegs.join(', ')}`;
      }
    }

    if (rateLimitHit) {
      const blockedUntilMs = nowMs + env.RATE_LIMIT_BACKOFF_MS;
      exitState.blockedUntil = new Date(blockedUntilMs).toISOString();
      notifyAlert(
        `[${posId}] Angel One rate limit hit — backing off ${Math.round(env.RATE_LIMIT_BACKOFF_MS / 60000)} min`,
      );
    }

    const previousStatus = position.status;
    const allOpenResolved = position.legs.every(
      (l) => l.status === 'CLOSED' || l.status === 'EXPIRED_UNBOOKED',
    );
    if (allOpenResolved) {
      position.status = 'CLOSED';
    }

    // FIX 4: Only write JSON file and update store status if state changed
    const statusChanged = position.status !== previousStatus;
    if (closedLegs.length > 0 || statusChanged) {
      const filePath = path.join(env.POSITIONS_DIR, `${posId}.json`);
      try {
        fs.writeFileSync(filePath, JSON.stringify(position, null, 2), 'utf-8');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        notifyAlert(`[${posId}] Failed to update position JSON on exit: ${message}`);
      }

      if (statusChanged) {
        positionStore.updatePositionStatus(posId, position.status);
      } else {
        positionStore.setPosition(position);
      }
    }

    return {
      success: failedLegs.length === 0,
      closedLegs,
      failedLegs,
    };
  } finally {
    positionStore.markExitInFlight(posId, false);
  }
}

export async function executeCombinedExit(
  positions: Position[],
  reason: 'PROFIT_TARGET' | 'STOP_LOSS',
  currentMTM: number,
): Promise<{ success: boolean; closedLegs: string[]; failedLegs: string[] }> {
  let allSuccess = true;
  const allClosedLegs: string[] = [];
  const allFailedLegs: string[] = [];

  for (const pos of positions) {
    const res = await executePositionExit(pos, reason, currentMTM);
    if (!res.success) allSuccess = false;
    allClosedLegs.push(...res.closedLegs);
    allFailedLegs.push(...res.failedLegs);
  }

  return {
    success: allSuccess,
    closedLegs: allClosedLegs,
    failedLegs: allFailedLegs,
  };
}
