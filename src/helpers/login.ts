import axios from 'axios';
import * as otplibModule from 'otplib';
import { env } from '../config/env.js';

let cachedJwtToken: string | null = null;
let tokenExpiryTime = 0;

export async function getBrokerSessionToken(): Promise<string | null> {
  if (cachedJwtToken && Date.now() < tokenExpiryTime) {
    return cachedJwtToken;
  }

  if (!env.API_KEY || !env.CLIENT_CODE || !env.CLIENT_PIN || !env.CLIENT_TOTP_PIN) {
    return null;
  }

  try {
    const authenticator =
      (otplibModule as any).authenticator || (otplibModule as any).default?.authenticator;
    const totp = authenticator ? authenticator.generate(env.CLIENT_TOTP_PIN) : '';
    const response = await axios.post(
      'https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword',
      {
        clientcode: env.CLIENT_CODE,
        password: env.CLIENT_PIN,
        totp,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': '127.0.0.1',
          'X-MACAddress': 'MAC',
          'X-PrivateKey': env.API_KEY,
        },
        timeout: 10000,
      },
    );

    if (response.data && response.data.status === true && response.data.data?.jwtToken) {
      cachedJwtToken = response.data.data.jwtToken;
      tokenExpiryTime = Date.now() + 12 * 60 * 60 * 1000;
      return cachedJwtToken;
    }
  } catch {
    // Auth failure
  }
  return null;
}
