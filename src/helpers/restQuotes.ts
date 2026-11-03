import axios from 'axios';
import { buildCommonHeaders } from './api.js';
import { getBrokerSessionToken } from './login.js';
import { Position, exchangeForIndex } from '../types/position.js';

const LTP_URL = 'https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/getLtpData';

/** Angel rate-limits getLtpData bursts with 403s, so space the legs out. */
const PACE_MS = 300;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Re-price every OPEN leg of a position straight from the broker.
 *
 * Used as the confirmation step before an exit: a threshold that only exists in the websocket
 * cache is not allowed to fire an order. Returns null when any leg cannot be priced, because a
 * partial quote set silently drops a leg from the MTM and manufactures a profit.
 */
export async function fetchPositionLTPs(
  position: Position,
  getToken: () => Promise<string | null> = getBrokerSessionToken,
): Promise<Map<string, number> | null> {
  const openLegs = position.legs.filter((leg) => leg.status === 'OPEN');
  if (openLegs.length === 0) return new Map();

  const jwtToken = await getToken();
  if (!jwtToken) return null;

  const exchange = exchangeForIndex(position.index);
  const headers = buildCommonHeaders(jwtToken);
  const prices = new Map<string, number>();

  for (const [i, leg] of openLegs.entries()) {
    if (i > 0) await sleep(PACE_MS);
    try {
      const response = await axios.post(
        LTP_URL,
        { exchange, tradingsymbol: leg.symbol, symboltoken: leg.token },
        { headers, timeout: 10000 },
      );
      const ltp = Number(response.data?.data?.ltp);
      if (!Number.isFinite(ltp) || ltp <= 0) return null;
      prices.set(leg.token, ltp);
    } catch {
      return null;
    }
  }

  return prices;
}
