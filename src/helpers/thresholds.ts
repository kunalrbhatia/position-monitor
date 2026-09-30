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
  ptAmount?: number | null,
  slAmount?: number | null,
): ThresholdCheckResult {
  const hasAbsolutePT = typeof ptAmount === 'number' && ptAmount > 0;
  const isSlDisabled = slAmount === null;
  const hasAbsoluteSL = typeof slAmount === 'number' && slAmount > 0;

  const isBaselineInvalid =
    baselineValue === undefined ||
    baselineValue === null ||
    isNaN(baselineValue) ||
    baselineValue <= 0;

  const needsBaselineForPT = !hasAbsolutePT;
  const needsBaselineForSL = !isSlDisabled && !hasAbsoluteSL;

  if ((needsBaselineForPT || needsBaselineForSL) && isBaselineInvalid) {
    notifyAlert(
      `[${positionId}] baselineValue missing or invalid (${baselineValue}). Threshold checks blocked.`,
    );
    return { breached: false };
  }

  const profitThreshold = hasAbsolutePT
    ? ptAmount!
    : (baselineValue as number) * (profitTargetPct / 100);

  if (currentMTM >= profitThreshold) {
    return {
      breached: true,
      type: 'PROFIT_TARGET',
      thresholdValue: profitThreshold,
    };
  }

  if (!isSlDisabled) {
    const lossThreshold = hasAbsoluteSL
      ? slAmount!
      : (baselineValue as number) * (stopLossPct / 100);

    if (currentMTM <= -lossThreshold) {
      return {
        breached: true,
        type: 'STOP_LOSS',
        thresholdValue: -lossThreshold,
      };
    }
  }

  return { breached: false };
}
