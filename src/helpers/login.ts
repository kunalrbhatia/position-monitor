import axios from 'axios';
import { generateSync, createGuardrails } from 'otplib';
import { env } from '../config/env.js';

let cachedJwtToken: string | null = null;
let tokenExpiryTime = 0;

async function getPublicIP(): Promise<string> {
  try {
    const resp = await axios.get('https://api.ipify.org', { timeout: 5000 });
    return resp.data?.trim() || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

export async function getBrokerSessionToken(): Promise<string | null> {
  if (cachedJwtToken && Date.now() < tokenExpiryTime) {
    return cachedJwtToken;
  }

  if (!env.API_KEY || !env.CLIENT_CODE || !env.CLIENT_PIN || !env.CLIENT_TOTP_PIN) {
    return null;
  }

  try {
    const secret = env.CLIENT_TOTP_PIN;
    // otplib v13 API — generateSync with guardrails for shorter broker secrets
    const token = generateSync({
      secret,
      guardrails: createGuardrails({
        MIN_SECRET_BYTES: Math.min(10, secret.length),
      }),
    });

    const publicIP = await getPublicIP();

    const response = await axios.post(
      'https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword',
      {
        clientcode: env.CLIENT_CODE,
        password: env.CLIENT_PIN,
        totp: token,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': publicIP,
          'X-MACAddress': '02:00:00:00:00:00',
          'X-PrivateKey': env.API_KEY,
        },
        timeout: 15000,
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
