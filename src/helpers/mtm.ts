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

export function calculatePositionMTM(
  position: Position,
  ltpCache: Map<string, number>,
): { totalMTM: number; hasAllLTPs: boolean; missingTokens: string[] } {
  let totalMTM = 0;
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
