import cron from 'node-cron';
import { app } from './server.js';
import { env } from './config/env.js';
import { startPositionWatcherInterval } from './jobs/positionWatcher.js';
import { runMTMLogger } from './jobs/mtmLogger.js';
import { positionStore } from './store/index.js';
import { notifyAlert } from './alerts/notifier.js';

export function checkStaleTicks(): void {
  const now = Date.now();
  const maxAgeMs = env.STALE_TICK_SECONDS * 1000;
  const positions = positionStore.getPositions();

  for (const [posId, pos] of positions.entries()) {
    if (pos.status !== 'OPEN') continue;

    for (const leg of pos.legs) {
      if (leg.status !== 'OPEN') continue;

      const ltpInfo = positionStore.getLtpInfo(leg.token);
      if (!ltpInfo) {
        notifyAlert(`[${posId}] Token ${leg.token} (${leg.symbol}) has received NO ticks yet.`);
      } else if (now - ltpInfo.lastUpdated > maxAgeMs) {
        const ageSec = Math.round((now - ltpInfo.lastUpdated) / 1000);
        notifyAlert(
          `[${posId}] Token ${leg.token} (${leg.symbol}) tick is STALE (${ageSec}s old > ${env.STALE_TICK_SECONDS}s).`,
        );
      }
    }
  }
}

export function startApp() {
  startPositionWatcherInterval(60000);

  const cronPattern = `*/${env.MTM_LOG_INTERVAL_MINUTES} * * * *`;
  cron.schedule(cronPattern, () => {
    runMTMLogger();
  });

  cron.schedule('*/30 * * * * *', () => {
    checkStaleTicks();
  });

  app.listen(env.PORT, () => {
    console.log(`Position Monitor running on port ${env.PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startApp();
}
