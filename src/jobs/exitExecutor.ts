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

export async function executePositionExit(
  position: Position,
  reason: 'PROFIT_TARGET' | 'STOP_LOSS',
  currentMTM: number,
): Promise<{ success: boolean; closedLegs: string[]; failedLegs: string[] }> {
  writeMTMLogLine(position.positionId, position.index, currentMTM);

  if (modeManager.isPanicMode()) {
    notifyAlert(`[${position.positionId}] .panic switch is ACTIVE! Exit order placement BLOCKED.`);
    return { success: false, closedLegs: [], failedLegs: position.legs.map((l) => l.legId) };
  }

  const isPaper = modeManager.isPaperMode();
  let jwtToken: string | null = null;

  if (!isPaper) {
    jwtToken = await getBrokerSessionToken();
    if (!jwtToken) {
      notifyAlert(
        `[${position.positionId}] Failed to obtain broker session token for exit execution.`,
      );
    }
  }

  const closedLegs: string[] = [];
  const failedLegs: string[] = [];

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
    };

    if (isPaper) {
      leg.status = 'CLOSED';
      closedLegs.push(leg.legId);
    } else {
      if (!jwtToken) {
        failedLegs.push(leg.legId);
        notifyAlert(
          `[${position.positionId}] Cannot place exit order for leg ${leg.legId}: No JWT token.`,
        );
        continue;
      }

      const res = await placeBrokerExitOrder(jwtToken, orderPayload);
      if (res.success) {
        leg.status = 'CLOSED';
        closedLegs.push(leg.legId);
      } else {
        failedLegs.push(leg.legId);
        notifyAlert(
          `[${position.positionId}] Exit order failed for leg ${leg.legId} (${leg.symbol}): ${res.error}`,
        );
      }
    }
  }

  const allOpenResolved = position.legs.every(
    (l) => l.status === 'CLOSED' || l.status === 'EXPIRED_UNBOOKED',
  );
  if (allOpenResolved) {
    position.status = 'CLOSED';
  }

  const filePath = path.join(env.POSITIONS_DIR, `${position.positionId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(position, null, 2), 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    notifyAlert(`[${position.positionId}] Failed to update position JSON on exit: ${message}`);
  }

  positionStore.setPosition(position);

  return {
    success: failedLegs.length === 0,
    closedLegs,
    failedLegs,
  };
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
