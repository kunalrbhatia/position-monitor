import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import { env } from '../config/env.js';

if (!fs.existsSync(env.ALERTS_LOG_DIR)) {
  fs.mkdirSync(env.ALERTS_LOG_DIR, { recursive: true });
}

const alertLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    }),
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(env.ALERTS_LOG_DIR, 'alerts.log'),
    }),
    new winston.transports.Console(),
  ],
});

export function notifyAlert(alertMessage: string): void {
  alertLogger.warn(alertMessage);
}
