import axios from 'axios';
import { env } from '../config/env.js';

export async function fetchMarginUtilized(jwtToken: string): Promise<number> {
  // NOTE: getRMS returns total account-level margin utilized (utiliseddebits).
  // This is used as default baselineValue when a position JSON omits baselineValue.
  const response = await axios.get(
    'https://apiconnect.angelbroking.com/rest/secure/angelbroking/user/v1/getRMS',
    {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '02:00:00:00:00:00',
        'X-PrivateKey': env.API_KEY,
      },
      timeout: 10000,
    },
  );

  if (response.data && response.data.status === true && response.data.data) {
    const rawVal = response.data.data.utiliseddebits;
    const margin = parseFloat(rawVal);
    if (isNaN(margin) || margin <= 0) {
      throw new Error(`Invalid margin value returned: ${rawVal}`);
    }
    return margin;
  }

  throw new Error(response.data?.message || 'Failed to fetch RMS margin from Angel One');
}
