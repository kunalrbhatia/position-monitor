import { modeManager } from '../helpers/modeManager.js';
import { positionStore } from '../store/index.js';
import { notifyAlert } from '../alerts/notifier.js';
import { env } from '../config/env.js';

export async function runPositionWatcher(): Promise<void> {
  if (modeManager.isKillMode()) {
    return;
  }

  try {
    positionStore.loadPositionsFromDir(env.POSITIONS_DIR);
    await positionStore.backfillBaselineValues(env.POSITIONS_DIR);
  } catch (err: any) {
    notifyAlert(`[positionWatcher] Error scanning directory: ${err.message}`);
  }
}

export function startPositionWatcherInterval(intervalMs: number = 60000): NodeJS.Timeout {
  runPositionWatcher();
  return setInterval(() => {
    runPositionWatcher();
  }, intervalMs);
}
