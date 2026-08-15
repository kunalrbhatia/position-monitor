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
