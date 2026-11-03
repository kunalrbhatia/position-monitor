import { describe, test, expect } from '@jest/globals';
import { istMinutesOfDay, parseHHMM, isInOpenBlackout } from '../src/helpers/marketClock.js';
import { env } from '../src/config/env.js';

describe('marketClock — open blackout', () => {
  test('istMinutesOfDay converts UTC to IST minutes past midnight', () => {
    expect(istMinutesOfDay(new Date('2026-11-03T03:45:00Z'))).toBe(555); // 09:15 IST
    expect(istMinutesOfDay(new Date('2026-11-03T04:00:00Z'))).toBe(570); // 09:30 IST
    expect(istMinutesOfDay(new Date('2026-11-03T18:29:00Z'))).toBe(1439); // 23:59 IST
    expect(istMinutesOfDay(new Date('2026-11-03T18:30:00Z'))).toBe(0); // 00:00 IST
  });

  test('parseHHMM accepts valid clock strings and rejects junk', () => {
    expect(parseHHMM('09:30')).toBe(570);
    expect(parseHHMM(' 9:05 ')).toBe(545);
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('23:59')).toBe(1439);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('9:5')).toBeNull();
    expect(parseHHMM('ab:cd')).toBeNull();
    expect(parseHHMM('')).toBeNull();
  });

  test('blocks exits before the cutoff and allows them afterwards', () => {
    // The 2026-11-03 NIFTY exit fired at 09:15:01 — this is the minute it must now be refused.
    expect(isInOpenBlackout(new Date('2026-11-03T03:45:01Z'), '09:30')).toBe(true);
    expect(isInOpenBlackout(new Date('2026-11-03T03:59:59Z'), '09:30')).toBe(true);
    expect(isInOpenBlackout(new Date('2026-11-03T04:00:00Z'), '09:30')).toBe(false);
    expect(isInOpenBlackout(new Date('2026-11-03T09:00:00Z'), '09:30')).toBe(false);
  });

  test('a malformed cutoff disables the blackout instead of blocking everything', () => {
    expect(isInOpenBlackout(new Date('2026-11-03T03:45:01Z'), 'nonsense')).toBe(false);
  });

  test('falls back to EXIT_BLACKOUT_UNTIL', () => {
    const original = env.EXIT_BLACKOUT_UNTIL;
    env.EXIT_BLACKOUT_UNTIL = '10:00';
    expect(isInOpenBlackout(new Date('2026-11-03T04:15:00Z'))).toBe(true);
    expect(isInOpenBlackout(new Date('2026-11-03T04:30:00Z'))).toBe(false);
    env.EXIT_BLACKOUT_UNTIL = original;
  });
});
