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

export const PositionSchema = z.object({
  positionId: z.string(),
  index: z.enum(['NIFTY', 'SENSEX']),
  status: z.enum(['OPEN', 'CLOSED']),
  baselineValue: z.number().positive(),
  entryTimestamp: z.string(),
  legs: z.array(LegSchema),
});

export type Leg = z.infer<typeof LegSchema>;
export type Position = z.infer<typeof PositionSchema>;
