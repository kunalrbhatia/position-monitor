import { describe, expect, jest, beforeEach, afterEach, it } from '@jest/globals';
import {
  buildSubscribeMessage,
  parseSmartStreamPacket,
  isMarketHours,
  forwardTicksToWebhook,
  startTickFeeder,
  stopTickFeeder,
  checkFeedHealth,
} from '../src/helpers/tickFeeder.js';
import axios from 'axios';

jest.mock('axios');

describe('tickFeeder full coverage unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    stopTickFeeder();
  });

  it('builds valid subscribe JSON message', () => {
    const tokens = ['67046', '99001'];
    const msgStr = buildSubscribeMessage(tokens, 'test-correlation');
    const msg = JSON.parse(msgStr);

    expect(msg.correlationId).toBe('test-correlation');
    expect(msg.action).toBe(1);
    expect(msg.params.mode).toBe(1);
    expect(msg.params.tokenList[0]).toEqual({
      exchangeType: 2,
      tokens: ['67046', '99001'],
    });
  });

  it('parses valid SmartStream binary packet', () => {
    const buf = Buffer.alloc(51);
    buf.writeUInt8(1, 0); // Mode 1
    buf.writeUInt8(2, 1); // Exchange NFO = 2
    buf.write('67046', 2, 25, 'ascii'); // Token
    buf.writeBigInt64LE(BigInt(12345), 35); // LTP 123.45 in paise

    const parsed = parseSmartStreamPacket(buf);
    expect(parsed).not.toBeNull();
    expect(parsed?.token).toBe('67046');
    expect(parsed?.ltp).toBe(123.45);
    expect(parsed?.exchangeType).toBe(2);
  });

  it('returns null for invalid/short binary packet', () => {
    const shortBuf = Buffer.alloc(5);
    expect(parseSmartStreamPacket(shortBuf)).toBeNull();
  });

  it('evaluates market hours correctly', () => {
    const testDate = new Date('2026-08-19T04:30:00.000Z'); // 10:00 AM IST
    expect(isMarketHours(testDate)).toBe(true);

    const earlyDate = new Date('2026-08-19T02:30:00.000Z');
    expect(isMarketHours(earlyDate)).toBe(false);
  });

  it('forwardTicksToWebhook posts ticks payload to webhook', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { status: 'received' } });
    await forwardTicksToWebhook([{ token: '67046', ltp: 123.45 }]);
    expect(axios.post).toHaveBeenCalled();
  });

  it('startTickFeeder and stopTickFeeder manage lifecycle timers cleanly', () => {
    expect(() => {
      startTickFeeder();
      checkFeedHealth();
      stopTickFeeder();
    }).not.toThrow();
  });
});
