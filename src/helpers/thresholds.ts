import { notifyAlert } from '../alerts/notifier.js';
import { env } from '../config/env.js';

export interface ThresholdCheckResult {
  breached: boolean;
  type?: 'PROFIT_TARGET' | 'STOP_LOSS';
  thresholdValue?: number;
}

export function checkThresholds(
  positionId: string,
  baselineValue: number | undefined | null,
  currentMTM: number,
  profitTargetPct: number = env.PROFIT_TARGET_PCT,
  stopLossPct: number = env.STOPLOSS_PCT,
): ThresholdCheckResult {
  if (
    baselineValue === undefined ||
    baselineValue === null ||
    isNaN(baselineValue) ||
    baselineValue <= 0
  ) {
    notifyAlert(
      `[${positionId}] baselineValue missing or invalid (${baselineValue}). Threshold checks blocked.`,
    );
    return { breached: false };
  }

  const profitThreshold = baselineValue * (profitTargetPct / 100);
  const lossThreshold = baselineValue * (stopLossPct / 100);

  if (currentMTM >= profitThreshold) {
    return {
      breached: true,
      type: 'PROFIT_TARGET',
      thresholdValue: profitThreshold,
    };
  }

  if (currentMTM <= -lossThreshold) {
    return {
      breached: true,
      type: 'STOP_LOSS',
      thresholdValue: -lossThreshold,
    };
  }

  return { breached: false };
}
