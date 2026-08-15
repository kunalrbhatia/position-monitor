import { describe, test, expect, jest, beforeEach } from '@jest/globals';

describe('fetchMarginUtilized Unit Tests', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('successfully returns parsed margin utilized number', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn().mockResolvedValue({
          data: {
            status: true,
            message: 'SUCCESS',
            data: {
              utiliseddebits: '12345.67',
            },
          },
        }),
      },
    }));

    const { fetchMarginUtilized: fetchMargin } = await import('../src/helpers/margin.js');
    const margin = await fetchMargin('mock_jwt_token');
    expect(margin).toBe(12345.67);
  });

  test('throws error on non-true status from broker', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn().mockResolvedValue({
          data: {
            status: false,
            message: 'Invalid token',
          },
        }),
      },
    }));

    const { fetchMarginUtilized: fetchMargin } = await import('../src/helpers/margin.js');
    await expect(fetchMargin('bad_jwt')).rejects.toThrow('Invalid token');
  });

  test('throws error when utiliseddebits is invalid or NaN', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn().mockResolvedValue({
          data: {
            status: true,
            data: {
              utiliseddebits: 'invalid_number',
            },
          },
        }),
      },
    }));

    const { fetchMarginUtilized: fetchMargin } = await import('../src/helpers/margin.js');
    await expect(fetchMargin('mock_jwt')).rejects.toThrow(
      'Invalid margin value returned: invalid_number',
    );
  });

  test('throws error on network or HTTP failure', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn().mockRejectedValue(new Error('Network Error')),
      },
    }));

    const { fetchMarginUtilized: fetchMargin } = await import('../src/helpers/margin.js');
    await expect(fetchMargin('mock_jwt')).rejects.toThrow('Network Error');
  });
});
