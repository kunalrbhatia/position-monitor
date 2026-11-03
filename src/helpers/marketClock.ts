import { env } from '../config/env.js';

const IST_OFFSET_MINUTES = 330; // UTC + 05:30

/** Minutes elapsed since IST midnight (0–1439) for the given instant. */
export function istMinutesOfDay(now: Date = new Date()): number {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMinutes + IST_OFFSET_MINUTES) % 1440;
}

/** Parse "HH:MM" into minutes past midnight; null when malformed. */
export function parseHHMM(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * True while the open blackout is in force: no threshold-driven exit may fire before
 * `EXIT_BLACKOUT_UNTIL` (default 09:30 IST).
 *
 * The first prints of a session are unreliable. On 2026-11-03 a single bad tick on the 260-lot
 * short leg of the NIFTY broken-wing butterfly showed MTM +13,761 at 09:15:01 against an 11,300
 * target, so the monitor liquidated a position that was really worth -7,054. Waiting for the
 * market to settle removes that entire class of trigger.
 */
export function isInOpenBlackout(
  now: Date = new Date(),
  until: string = env.EXIT_BLACKOUT_UNTIL,
): boolean {
  const cutoff = parseHHMM(until);
  if (cutoff === null) return false;
  return istMinutesOfDay(now) < cutoff;
}
