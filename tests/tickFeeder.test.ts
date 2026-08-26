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
    const buf = Buffer.alloc(60);
    buf.writeInt8(1, 0); // Mode 1
    buf.writeUInt8(2, 1); // Exchange NFO = 2
    buf.write('144389', 2, 'utf8'); // Token
    buf.writeInt32LE(425, 43); // LTP 4.25 in paise

    const parsed = parseSmartStreamPacket(buf);
    expect(parsed).not.toBeNull();
    expect(parsed?.token).toBe('144389');
    expect(parsed?.ltp).toBe(4.25);
    expect(parsed?.exchangeType).toBe(2);
  });

  it('rejects implausible LTP (> 1,000,000)', () => {
    const buf = Buffer.alloc(60);
    buf.writeInt8(1, 0);
    buf.write('144389', 2, 'utf8');
    buf.writeInt32LE(150_000_000, 43); // LTP = 1.5M > 10L

    expect(parseSmartStreamPacket(buf)).toBeNull();
  });

  it('returns null for invalid/short binary packet or wrong mode', () => {
    const shortBuf = Buffer.alloc(5);
    expect(parseSmartStreamPacket(shortBuf)).toBeNull();

    const wrongModeBuf = Buffer.alloc(60);
    wrongModeBuf.writeInt8(2, 0); // Mode 2 != 1
    expect(parseSmartStreamPacket(wrongModeBuf)).toBeNull();
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
