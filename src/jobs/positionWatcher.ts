import { modeManager } from '../helpers/modeManager.js';
import { positionStore } from '../store/index.js';
import { notifyAlert } from '../alerts/notifier.js';
import { env } from '../config/env.js';
import { checkThresholds } from '../helpers/thresholds.js';
import { calculatePositionMTM } from '../helpers/mtm.js';
import { executePositionExit } from './exitExecutor.js';

export async function runPositionWatcher(): Promise<void> {
  if (modeManager.isKillMode()) {
    return;
  }

  try {
    positionStore.loadPositionsFromDir(env.POSITIONS_DIR);
    await positionStore.backfillBaselineValues(env.POSITIONS_DIR);

    const positions = positionStore.getPositions();
    const ltpCache = positionStore.getLtpCache();

    for (const [posId, pos] of positions.entries()) {
      if (pos.status !== 'OPEN') continue;

      const margin = positionStore.getPositionMargin(pos);
      if (margin === null || margin <= 0) continue;

      const { totalMTM, hasAllLTPs } = calculatePositionMTM(pos, ltpCache);
      if (hasAllLTPs) {
        const thresholdRes = checkThresholds(posId, margin, totalMTM);
        if (thresholdRes.breached && thresholdRes.type) {
          await executePositionExit(pos, thresholdRes.type, totalMTM);
        }
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    notifyAlert(`[positionWatcher] Error scanning directory: ${message}`);
  }
}

export function startPositionWatcherInterval(intervalMs: number = 60000): NodeJS.Timeout {
  runPositionWatcher();
  return setInterval(() => {
    runPositionWatcher();
  }, intervalMs);
}
