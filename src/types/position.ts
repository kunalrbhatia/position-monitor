import { z } from 'zod';

export const LegSchema = z.object({
  legId: z.string(),
  symbol: z.string(),
  token: z.string(),
  expiry: z.string(),
  optionType: z.enum(['CE', 'PE']),
  side: z.enum(['BUY', 'SELL']),
  qty: z.number().positive(),
  lotSize: z.number().positive(),
  entryPrice: z.number().nonnegative(),
  status: z.enum(['OPEN', 'CLOSED', 'EXPIRED_UNBOOKED']),
});

export const ExitStateSchema = z.object({
  lastAttemptAt: z.string().optional(),
  attemptCount: z.number().int().nonnegative().optional(),
  lastAttemptDate: z.string().optional(),
  blockedUntil: z.string().optional(),
  lastError: z.string().optional(),
});

export const PositionSchema = z.object({
  positionId: z.string(),
  index: z.enum(['NIFTY', 'SENSEX', 'BANKNIFTY']),
  status: z.enum(['OPEN', 'CLOSED']),
  marginUtilized: z.number().positive().nullable().optional(),
  baselineValue: z.number().positive().nullable().optional(),
  // ptAmount positive number -> profit threshold = that amount; absent/null -> fall back to PROFIT_TARGET_PCT * base
  ptAmount: z.number().positive().nullable().optional(),
  // slAmount positive number -> loss threshold = that amount; explicit null -> no SL check at all; absent/undefined -> fall back to STOPLOSS_PCT * base
  slAmount: z.number().positive().nullable().optional(),
  entryTimestamp: z.string(),
  legs: z.array(LegSchema),
  exitState: ExitStateSchema.optional(),
});

export type Leg = z.infer<typeof LegSchema>;
export type ExitState = z.infer<typeof ExitStateSchema>;
export type Position = z.infer<typeof PositionSchema>;
