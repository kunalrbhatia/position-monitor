#!/usr/bin/env node
/**
 * Calendar Position P&L Reporter (ESM)
 * Fetches live LTPs for the IC2IF calendar legs and prints a formatted
 * P&L report with PT/SL thresholds. Designed to run as a no_agent cron job.
 *
 * Quiet when: weekend, outside market hours (9:30-15:30 IST), no position file,
 * or no open legs — so the cron stays silent outside trading windows.
 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as otplibModule from 'otplib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const POSITION_FILE = path.join(__dirname, '..', 'data', 'positions', 'IC2IF-CAL-18-25AUG.json');
const BASE_URL = 'https://apiconnect.angelbroking.com';

// ---------- Time gating (IST) ----------
function isTradingTime() {
  if (process.env.PNL_FORCE === '1') return true; // test bypass
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false; // weekend
  const h = ist.getHours();
  const m = ist.getMinutes();
  const minutes = h * 60 + m;
  return minutes >= 9 * 60 + 30 && minutes <= 15 * 60 + 30; // 9:30 - 15:30
}

// ---------- Login ----------
async function login() {
  const secret = process.env.CLIENT_TOTP_PIN || process.env.ANGEL_TOTP_SECRET;
  const generateSync = otplibModule.generateSync;
  const createGuardrails = otplibModule.createGuardrails;
  const totp = generateSync({
    secret,
    guardrails: createGuardrails({
      MIN_SECRET_BYTES: Math.min(10, secret.length),
    }),
  });
  const publicIP = await axios
    .get('https://api.ipify.org', { timeout: 5000 })
    .then((r) => r.data)
    .catch(() => '127.0.0.1');

  const resp = await axios.post(
    `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
    {
      clientcode: process.env.CLIENT_CODE || process.env.ANGEL_CLIENT_ID,
      password: process.env.CLIENT_PIN || process.env.ANGEL_PASSWORD,
      totp,
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
        'X-PrivateKey': process.env.API_KEY || process.env.ANGEL_API_KEY,
      },
      timeout: 15000,
    },
  );

  if (resp.data && resp.data.status === true && resp.data.data?.jwtToken) {
    return { jwtToken: resp.data.data.jwtToken, publicIP };
  }
  throw new Error(resp.data?.message || 'Login failed');
}

// ---------- Fetch LTP for one leg ----------
async function fetchLTP(jwtToken, publicIP, leg) {
  const resp = await axios.post(
    `${BASE_URL}/rest/secure/angelbroking/order/v1/getLtpData`,
    {
      exchange: 'NFO',
      tradingsymbol: leg.symbol,
      symboltoken: leg.token,
    },
    {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': publicIP,
        'X-MACAddress': '02:00:00:00:00:00',
        'X-PrivateKey': process.env.API_KEY || process.env.ANGEL_API_KEY,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      timeout: 10000,
    },
  );

  if (resp.data && resp.data.status === true && resp.data.data) {
    return parseFloat(resp.data.data.ltp);
  }
  throw new Error(resp.data?.message || `LTP fetch failed for ${leg.symbol}`);
}

// ---------- Formatting ----------
function fmt(n) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildReport(position, legDetails) {
  const baseline = position.baselineValue || 0;
  const pt = baseline * 0.015; // +1.5%
  const sl = baseline * 0.02; // -2.0% (loss threshold value)
  const totalMTM = legDetails.reduce((s, l) => s + l.mtm, 0);
  const pct = baseline > 0 ? (totalMTM / baseline) * 100 : 0;

  let status = 'Monitoring';
  if (totalMTM >= pt) status = 'Target Achieved 🚀';
  else if (totalMTM <= -sl) status = 'Stop Loss Hit 🛑';

  const lines = [];
  lines.push('┏━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  lines.push('   ⚡️ TRADE PERFORMANCE ⚡️');
  lines.push('┗━━━━━━━━━━━━━━━━━━━━━━━━━┛');
  lines.push('');
  lines.push(`💰 Total PnL:        ${totalMTM >= 0 ? '+' : ''}₹${fmt(totalMTM)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`);
  lines.push('');
  lines.push('─────────────────────────');
  lines.push(`🎯 PT (Target):       ₹${fmt(pt)} ${totalMTM >= pt ? '✅' : ''}`);
  lines.push(`🛑 SL (Stop Loss):    ₹${fmt(sl)} ${totalMTM <= -sl ? '✅' : ''}`);
  lines.push(`💼 Margin Utilized:   ₹${fmt(baseline)}`);
  lines.push('─────────────────────────');
  lines.push('');
  lines.push(`📌 Status: ${status}`);
  return lines.join('\n');
}

// ---------- Main ----------
async function main() {
  if (!isTradingTime()) {
    return; // silent outside market hours / weekends
  }

  if (!fs.existsSync(POSITION_FILE)) {
    console.log('⚠️ Position file not found:', POSITION_FILE);
    return;
  }

  const position = JSON.parse(fs.readFileSync(POSITION_FILE, 'utf-8'));
  const openLegs = position.legs.filter((l) => l.status === 'OPEN');
  if (openLegs.length === 0) {
    return; // no open legs — nothing to report
  }

  const { jwtToken, publicIP } = await login();
  const legDetails = [];
  for (const leg of openLegs) {
    const ltp = await fetchLTP(jwtToken, publicIP, leg);
    const mtm =
      leg.side === 'BUY' ? (ltp - leg.entryPrice) * leg.qty : (leg.entryPrice - ltp) * leg.qty;
    legDetails.push({ symbol: leg.symbol, side: leg.side, qty: leg.qty, ltp, mtm });
  }

  console.log(buildReport(position, legDetails));
}

main().catch((err) => {
  console.log(`⚠️ PnL report failed: ${err.message}`);
});
