import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACTS, CONTRACT_CODES, TX_MULTIPLIER, DEFAULT_MARGINS,
  DEFAULT_TAX_RATE, DEFAULT_LIQUIDATION_RATIO, STRESS_SHOCKS, DEFAULT_MARGIN_DATE,
} from '../js/contracts.js';

test('乘數 TX 200、MTX 50、TMF 10', () => {
  assert.equal(CONTRACTS.TX.multiplier, 200);
  assert.equal(CONTRACTS.MTX.multiplier, 50);
  assert.equal(CONTRACTS.TMF.multiplier, 10);
  assert.equal(TX_MULTIPLIER, 200);
  assert.deepEqual(CONTRACT_CODES, ['TX', 'MTX', 'TMF']);
});

test('預設保證金', () => {
  assert.deepEqual(DEFAULT_MARGINS, {
    TX: { initial: 701000, maintenance: 538000 },
    MTX: { initial: 175250, maintenance: 134500 },
    TMF: { initial: 35050, maintenance: 26900 },
  });
  assert.match(DEFAULT_MARGIN_DATE, /^\d{4}-\d{2}-\d{2}$/);
});

test('稅率 0.00002、代沖銷比例 0.25', () => {
  assert.equal(DEFAULT_TAX_RATE, 0.00002);
  assert.equal(DEFAULT_LIQUIDATION_RATIO, 0.25);
});

test('壓力測試預設 shocks 為 ±1/3/5/7/10%', () => {
  const expected = [-0.10, -0.07, -0.05, -0.03, -0.01, 0.01, 0.03, 0.05, 0.07, 0.10];
  assert.deepEqual([...STRESS_SHOCKS].sort((a, b) => a - b), expected);
});
