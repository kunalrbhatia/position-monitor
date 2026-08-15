import request from 'supertest';
import { app } from '../src/server.js';
import { modeManager, getFileSwitchState } from '../src/helpers/modeManager.js';
import { positionStore } from '../src/store/index.js';
import { startPositionWatcherInterval } from '../src/jobs/positionWatcher.js';

describe('Server & Endpoints Integration Tests', () => {
  test('GET /health returns status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /webhook/ticks rejects invalid payload with 400', async () => {
    const res = await request(app).post('/webhook/ticks').send({ invalid: 'data' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid tick payload');
  });

  test('POST /webhook/ticks accepts single tick', async () => {
    const res = await request(app)
      .post('/webhook/ticks')
      .send({ token: '45234', ltp: 145.5, timestamp: '2026-08-15T10:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('received');
  });

  test('POST /webhook/ticks accepts batch ticks', async () => {
    const res = await request(app)
      .post('/webhook/ticks')
      .send({
        ticks: [
          { token: '45234', ltp: 145.5 },
          { token: '45241', ltp: 140.0 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('received');
  });

  test('getFileSwitchState returns false for non-existent file', () => {
    expect(getFileSwitchState('.non_existent_file')).toBe(false);
  });

  test('modeManager checks switches', () => {
    expect(typeof modeManager.isPaperMode()).toBe('boolean');
    expect(typeof modeManager.isKillMode()).toBe('boolean');
    expect(typeof modeManager.isPanicMode()).toBe('boolean');
  });

  test('startPositionWatcherInterval initializes timer', () => {
    const timer = startPositionWatcherInterval(100000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  test('positionStore helper getters', () => {
    expect(positionStore.getWatchedTokens()).toBeDefined();
    expect(positionStore.updatePositionStatus('non-existent', 'CLOSED')).toBeUndefined();
  });
});
