import express, { Request, Response } from 'express';
import { z } from 'zod';
import { positionStore } from './store/index.js';
import { calculatePositionMTM, isMTMPlausible } from './helpers/mtm.js';
import { checkThresholds } from './helpers/thresholds.js';
import { executePositionExit } from './jobs/exitExecutor.js';
import { modeManager } from './helpers/modeManager.js';
import { notifyAlert } from './alerts/notifier.js';

export const app = express();
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const SingleTickSchema = z.object({
  token: z.string(),
  ltp: z.number(),
  timestamp: z.string().optional(),
});

const WebhookBodySchema = z.union([
  SingleTickSchema,
  z.object({
    ticks: z.array(SingleTickSchema),
  }),
]);

interface BreachState {
  type: 'PROFIT_TARGET' | 'STOP_LOSS';
  firstSeenAt: number;
}
const breachStateMap = new Map<string, BreachState>();

export function processTick(token: string, ltp: number): void {
  if (modeManager.isKillMode() || modeManager.isPanicMode()) return;

  const updatedAny = positionStore.updateTick(token, ltp);
  if (!updatedAny) return;

  const positions = positionStore.getPositions();
  const ltpCache = positionStore.getLtpCache();

  for (const [posId, pos] of positions.entries()) {
    if (pos.status !== 'OPEN') continue;

    const margin = positionStore.getPositionMargin(pos);
    if (margin === null || margin <= 0) continue;

    const hasLegToken = pos.legs.some((l) => l.status === 'OPEN' && l.token === token);
    if (!hasLegToken) continue;

    const { totalMTM, hasAllLTPs } = calculatePositionMTM(pos, ltpCache);
    if (!hasAllLTPs) continue;

    const thresholdRes = checkThresholds(posId, margin, totalMTM);
    if (thresholdRes.breached && thresholdRes.type) {
      if (!isMTMPlausible(pos, totalMTM)) {
        notifyAlert(
          `[${posId}] MTM sanity check FAILED — blocking exit. totalMTM=${totalMTM}, margin=${margin}`,
        );
        continue;
      }

      // H1 — Breach confirmation across 2 consecutive checks
      const existing = breachStateMap.get(posId);
      const now = Date.now();
      if (!existing || existing.type !== thresholdRes.type) {
        breachStateMap.set(posId, { type: thresholdRes.type, firstSeenAt: now });
        continue;
      }

      // Confirmed breach (seen previously for same type)
      executePositionExit(pos, thresholdRes.type, totalMTM).catch((_err) => {
        // Error logged inside exitExecutor
      });
    } else {
      breachStateMap.delete(posId);
    }
  }
}

app.post('/webhook/ticks', (req: Request, res: Response) => {
  const parseResult = WebhookBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid tick payload', details: parseResult.error.issues });
    return;
  }

  const payload = parseResult.data;
  if ('ticks' in payload) {
    for (const t of payload.ticks) {
      processTick(t.token, t.ltp);
    }
  } else {
    processTick(payload.token, payload.ltp);
  }

  res.json({ status: 'received' });
});
