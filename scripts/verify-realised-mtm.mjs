// Proves the realised-aware MTM fix against the compiled build.
// Case: BANKNIFTY-style position where a LOSING long was closed earlier.
//   open legs: short 90 @1227.38 / short 90 @1052.71 / long 90 @410.45  (marks chosen so open MTM ≈ +20,029)
//   closed leg: long 90 @314.40 realised −23,643  (the 57,800 CE wing Kunal closed)
// Expected: totalMTM ≈ open + (−23,643), i.e. the loss is counted, NOT dropped.
import { calculateLegMTM, calculatePositionMTM, realisedPnlOf } from '../dist/helpers/mtm.js';

const qty = 90;
const pos = {
  positionId: 'synthetic',
  index: 'BANKNIFTY',
  status: 'OPEN',
  marginUtilized: 421744.79,
  ptAmount: 43200,
  slAmount: null,
  entryTimestamp: '2026-10-30T00:00:00.000Z',
  legs: [
    { legId: 'L1', symbol: 'BANKNIFTY23NOV2655500CE', token: 't1', expiry: '23NOV2026', optionType: 'CE', side: 'SELL', qty, lotSize: 30, entryPrice: 1227.38, status: 'OPEN' },
    { legId: 'L2', symbol: 'BANKNIFTY23NOV2655500PE', token: 't2', expiry: '23NOV2026', optionType: 'PE', side: 'SELL', qty, lotSize: 30, entryPrice: 1052.71, status: 'OPEN' },
    { legId: 'L3', symbol: 'BANKNIFTY23NOV2653200PE', token: 't3', expiry: '23NOV2026', optionType: 'PE', side: 'BUY', qty, lotSize: 30, entryPrice: 410.45, status: 'OPEN' },
    { legId: 'C1', symbol: 'BANKNIFTY23NOV2657800CE', token: 't4', expiry: '23NOV2026', optionType: 'CE', side: 'BUY', qty, lotSize: 30, entryPrice: 314.4, realisedPnl: -23643, status: 'CLOSED' },
  ],
};

// marks reproducing the REAL incident: open-leg MTM = +44,109.90 (the number the monitor saw at
// 10:52 on 30 Oct) with the −23,643 wing close sitting in the same position.
const cache = new Map([
  ['t1', 982.27],
  ['t2', 1052.71],
  ['t3', 655.45],
]);

const { totalMTM, hasAllLTPs } = calculatePositionMTM(pos, cache);
// Derive the open-only figure from the same marks instead of assuming it.
const openOnly = pos.legs
  .filter((l) => l.status === 'OPEN')
  .reduce((s, l) => s + calculateLegMTM(l, cache.get(l.token)), 0);
const realised = realisedPnlOf(pos);
const net = openOnly + realised;

console.log(`open-only MTM (old behaviour) : ${openOnly.toFixed(2)}   -> PT fired? ${openOnly >= pos.ptAmount ? 'YES (the bug)' : 'no'}`);
console.log(`realised on closed legs       : ${realised.toFixed(2)}`);
console.log(`MTM now used for thresholds   : ${totalMTM.toFixed(2)}  (hasAllLTPs=${hasAllLTPs})`);
console.log(`expected net                  : ${net.toFixed(2)}`);
console.log(`PT                            : ${pos.ptAmount}`);
console.log(`would fire PT?                : ${totalMTM >= pos.ptAmount ? 'YES  <-- STILL BROKEN' : 'NO   <-- fixed'}`);
const ok = Math.abs(totalMTM - net) < 1 && openOnly >= pos.ptAmount && totalMTM < pos.ptAmount;
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exitCode = ok ? 0 : 1;
