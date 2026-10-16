import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNum, isPos, isPosInt, isDate, isValidMargin, isValidRatio, LIMITS } from '../js/validate.js';

test('LIMITS', () => assert.deepEqual(LIMITS, { maxQty: 999, maxLevels: 50 }));

test('isNum：有限數字', () => {
  for (const v of [0, -1, 1.5, Number.MAX_VALUE]) assert.equal(isNum(v), true, String(v));
  for (const v of [NaN, Infinity, -Infinity, '1', null, undefined, {}, [], true]) assert.equal(isNum(v), false, String(v));
});

test('isPos：正有限數', () => {
  assert.equal(isPos(0.0001), true);
  assert.equal(isPos(1), true);
  for (const v of [0, -0, -1, NaN, Infinity, '5', null]) assert.equal(isPos(v), false, String(v));
});

test('isPosInt：正整數且 ≤ max', () => {
  assert.equal(isPosInt(1), true);
  assert.equal(isPosInt(1e9), true);
  assert.equal(isPosInt(999, 999), true);
  assert.equal(isPosInt(1000, 999), false);
  assert.equal(isPosInt(50, LIMITS.maxLevels), true);
  assert.equal(isPosInt(51, LIMITS.maxLevels), false);
  for (const v of [0, -1, 1.5, NaN, Infinity, '3', null]) assert.equal(isPosInt(v), false, String(v));
});

test('isDate：YYYY-MM-DD 字串', () => {
  assert.equal(isDate('2026-08-12'), true);
  for (const v of ['2026-8-12', '20260812', '2026-08-12 ', ' 2026-08-12', '2026/08/12', 20260812, null, '2026-08-12T00:00']) {
    assert.equal(isDate(v), false, String(v));
  }
});

test('isValidMargin', () => {
  assert.equal(isValidMargin({ initial: 2, maintenance: 1 }), true);
  assert.equal(isValidMargin({ initial: 1, maintenance: 1 }), true);
  for (const m of [
    null, undefined, {}, 'x', { initial: 1, maintenance: 2 }, { initial: 1, maintenance: 0 },
    { initial: 1, maintenance: -1 }, { initial: '2', maintenance: 1 }, { initial: Infinity, maintenance: 1 },
    { initial: NaN, maintenance: 1 }, { maintenance: 1 },
  ]) {
    assert.equal(isValidMargin(m), false, JSON.stringify(m));
  }
});

test('isValidRatio：0 < x < 1', () => {
  for (const v of [0.0001, 0.25, 0.9999]) assert.equal(isValidRatio(v), true, String(v));
  for (const v of [0, 1, -0.5, 1.5, NaN, '0.25', null]) assert.equal(isValidRatio(v), false, String(v));
});
