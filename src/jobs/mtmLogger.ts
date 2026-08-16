import fs from 'node:fs';
import path from 'node:path';
import { positionStore } from '../store/index.js';
import { env } from '../config/env.js';

export function formatISTLogDate(date: Date = new Date()): {
  dateStr: string;
  timeStr: string;
  ymd: string;
} {
  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });

  const day = map.day;
  const month = map.month;
  const year = map.year;
  const hour = map.hour;
  const minute = map.minute;
  const second = map.second;
  const dayPeriod = (map.dayPeriod || '').toLowerCase();

  const dateStr = `${day}/${month}/${year}`;
  const timeStr = `${hour}:${minute}:${second} ${dayPeriod}`;

  const yyyy = year;
  const mm = month.padStart(2, '0');
  const dd = day.padStart(2, '0');
  const ymd = `${yyyy}-${mm}-${dd}`;

  return { dateStr, timeStr, ymd };
}

export function writeMTMLogLine(
  positionId: string,
  index: string,
  mtm: number,
  now: Date = new Date(),
): void {
  const { dateStr, timeStr, ymd } = formatISTLogDate(now);
  const line = `[${dateStr}, ${timeStr}] [INFO] ${index}: MTM = ${mtm.toFixed(2)}\n`;

  if (!fs.existsSync(env.MTM_LOG_DIR)) {
    fs.mkdirSync(env.MTM_LOG_DIR, { recursive: true });
  }

  const filename = `mtm-${positionId}-${ymd}.log`;
  const filePath = path.join(env.MTM_LOG_DIR, filename);

  fs.appendFileSync(filePath, line, 'utf-8');
}

import { calculatePositionMTM } from '../helpers/mtm.js';

export function runMTMLogger(now: Date = new Date()): void {
  const openPositions = positionStore.getPositions();
  const ltpCache = positionStore.getLtpCache();

  for (const [posId, pos] of openPositions.entries()) {
    if (pos.status !== 'OPEN') continue;

    if (positionStore.hasFreshTickSinceLastCheck(posId)) {
      const { totalMTM, hasAllLTPs } = calculatePositionMTM(pos, ltpCache);
      if (hasAllLTPs) {
        writeMTMLogLine(posId, pos.index, totalMTM, now);
        positionStore.resetFreshTickFlag(posId);
      }
    }
  }
}
