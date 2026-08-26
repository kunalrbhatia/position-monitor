import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LIVE_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true'),
  API_KEY: z.string().optional().default(''),
  CLIENT_CODE: z.string().optional().default(''),
  CLIENT_PIN: z.string().optional().default(''),
  CLIENT_TOTP_PIN: z.string().optional().default(''),
  PROFIT_TARGET_PCT: z.coerce.number().default(1.5),
  STOPLOSS_PCT: z.coerce.number().default(2.0),
  WORTHLESS_LTP_THRESHOLD: z.coerce.number().default(5.0),
  STALE_TICK_SECONDS: z.coerce.number().default(90),
  MTM_LOG_INTERVAL_MINUTES: z.coerce.number().default(5),
  POSITIONS_DIR: z.string().default(path.join(process.cwd(), 'data', 'positions')),
  MTM_LOG_DIR: z.string().default(path.join(process.cwd(), 'logs', 'mtm')),
  ALERTS_LOG_DIR: z.string().default(path.join(process.cwd(), 'logs', 'alerts')),
  FEEDER_REFRESH_TIME: z.string().default('09:10'),
  FEEDER_WS_URL: z.string().default('wss://smartapisocket.angelone.in/smart-stream'),
  MONITOR_WEBHOOK_URL: z.string().default('http://localhost:3000/webhook/ticks'),
  SCRIP_MASTER_PATH: z.string().default('/home/ubuntu/niftyicifalgo/scrip_master.json'),
  EXIT_RETRY_COOLDOWN_MS: z.coerce.number().default(300000),
  EXIT_MAX_ATTEMPTS_PER_DAY: z.coerce.number().default(5),
  RATE_LIMIT_BACKOFF_MS: z.coerce.number().default(900000),
});

export type EnvConfig = z.infer<typeof envSchema>;

let parsedEnv: EnvConfig;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (err) {
  console.error('Invalid environment variables:', err);
  throw err;
}

export const env = parsedEnv;
