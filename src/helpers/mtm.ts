import { Leg, Position } from '../types/position.js';
import { positionStore } from '../store/index.js';

export function calculateLegMTM(leg: Leg, currentLTP: number): number {
  if (leg.status !== 'OPEN') {
    return 0;
  }
  if (leg.side === 'BUY') {
    return (currentLTP - leg.entryPrice) * leg.qty;
  } else {
    return (leg.entryPrice - currentLTP) * leg.qty;
  }
}

/** Realised rupees already banked on legs that were closed earlier in this position. */
export function realisedPnlOf(position: Position): number {
  return position.legs.reduce(
    (sum, leg) =>
      leg.status === 'OPEN'
        ? sum
        : sum + (typeof leg.realisedPnl === 'number' ? leg.realisedPnl : 0),
    0,
  );
}

export function calculatePositionMTM(
  position: Position,
  ltpCache: Map<string, number>,
): { totalMTM: number; hasAllLTPs: boolean; missingTokens: string[] } {
  // Start from the money already realised on closed legs. Without this, closing a LOSING leg
  // removes its negative mark from the total instead of booking the loss, which inflates MTM by
  // the size of that loss — enough to fake a profit-target breach (real incident: BANKNIFTY
  // iron fly, 30 Oct 2026 — a −₹23,643 wing close lifted MTM 20,029 → 44,110 and auto-exited).
  let totalMTM = realisedPnlOf(position);
  let hasAllLTPs = true;
  const missingTokens: string[] = [];

  for (const leg of position.legs) {
    if (leg.status !== 'OPEN') {
      continue;
    }
    const currentLTP = ltpCache.get(leg.token);
    if (currentLTP === undefined) {
      hasAllLTPs = false;
      missingTokens.push(leg.token);
    } else {
      totalMTM += calculateLegMTM(leg, currentLTP);
    }
  }

  return { totalMTM, hasAllLTPs, missingTokens };
}

export function isMTMPlausible(position: Position, totalMTM: number): boolean {
  const margin = positionStore.getPositionMargin(position);
  if (margin === null || margin <= 0) return false;
  return Math.abs(totalMTM) <= margin * 5;
}
