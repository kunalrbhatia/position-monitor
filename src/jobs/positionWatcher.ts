import { modeManager } from '../helpers/modeManager.js';
import { positionStore } from '../store/index.js';
import { notifyAlert } from '../alerts/notifier.js';
import { env } from '../config/env.js';
import { checkThresholds } from '../helpers/thresholds.js';
import { calculatePositionMTM } from '../helpers/mtm.js';
import { executePositionExit } from './exitExecutor.js';
import { fetchPositionLTPs } from '../helpers/restQuotes.js';

/**
 * A breach recorded here has been seen once and is awaiting confirmation on the next pass.
 * The tick cache alone never fires an order: on 2026-11-03 a single bad opening tick showed the
 * NIFTY butterfly at +13,761 against an 11,300 target and liquidated a position worth -7,054.
 */
const pendingBreach = new Map<string, { type: string; firstSeenAt: number }>();

/** Test seam: drop confirmation state between cases. */
export function resetBreachConfirmation(): void {
  pendingBreach.clear();
}

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
      if (!hasAllLTPs) continue;

      const thresholdRes = checkThresholds(
        posId,
        margin,
        totalMTM,
        undefined,
        undefined,
        pos.ptAmount,
        pos.slAmount,
      );

      if (!thresholdRes.breached || !thresholdRes.type) {
        pendingBreach.delete(posId);
        continue;
      }

      // First sighting of this breach type: remember it and wait for the next pass.
      const pending = pendingBreach.get(posId);
      if (!pending || pending.type !== thresholdRes.type) {
        pendingBreach.set(posId, { type: thresholdRes.type, firstSeenAt: Date.now() });
        continue;
      }

      // Confirmed twice in the cache, but the cache is not the broker. Re-price over REST and
      // require the breach to survive; a failed re-price means "do nothing", never "exit anyway".
      const freshPrices = modeManager.isPaperMode() ? ltpCache : await fetchPositionLTPs(pos);
      if (!freshPrices) {
        notifyAlert(
          `[${posId}] ${thresholdRes.type} confirmed in cache but re-price failed — exit NOT fired.`,
        );
        continue;
      }

      const repriced = calculatePositionMTM(pos, freshPrices);
      if (!repriced.hasAllLTPs) continue;

      const confirmRes = checkThresholds(
        posId,
        margin,
        repriced.totalMTM,
        undefined,
        undefined,
        pos.ptAmount,
        pos.slAmount,
      );

      if (!confirmRes.breached || !confirmRes.type) {
        notifyAlert(
          `[${posId}] ${thresholdRes.type} vanished on re-price ` +
            `(cache ₹${totalMTM.toFixed(2)} → broker ₹${repriced.totalMTM.toFixed(2)}) — tick artefact ignored.`,
        );
        pendingBreach.delete(posId);
        continue;
      }

      pendingBreach.delete(posId);
      await executePositionExit(pos, confirmRes.type, repriced.totalMTM);
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
