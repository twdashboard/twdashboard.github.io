import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { expiryKey, pickNearMonth, sessionOrder, toIsoTime } from '../scripts/fetch-quote.mjs';

const d = (s) => new Date(`${s}T00:00:00Z`);

describe('expiryKey', () => {
  test('TXFJ6-F 在 2026 → 202610', () => assert.equal(expiryKey('TXFJ6-F', d('2026-10-16')), 202610));
  test('夜盤代號 TMFJ6-M 同樣解析為 202610', () => assert.equal(expiryKey('TMFJ6-M', d('2026-10-16')), 202610));
  test('月份碼 A=1、L=12', () => {
    assert.equal(expiryKey('TMFA6-F', d('2026-01-05')), 202601);
    assert.equal(expiryKey('MXFL6-F', d('2026-01-05')), 202612);
  });
  test('跨年：2026-12-20 TXFL6-F → 202612、TXFA7-F → 202701', () => {
    assert.equal(expiryKey('TXFL6-F', d('2026-12-20')), 202612);
    assert.equal(expiryKey('TXFA7-F', d('2026-12-20')), 202701);
  });
  test('跨十年：2029-12-20 TXFA0-F → 203001', () => {
    assert.equal(expiryKey('TXFA0-F', d('2029-12-20')), 203001);
    assert.equal(expiryKey('TXFL9-F', d('2029-12-20')), 202912);
  });
  test('剛跨年：2027-01-05 時去年 12 月契約 TXFL6-F → 202612', () => {
    assert.equal(expiryKey('TXFL6-F', d('2027-01-05')), 202612);
    assert.equal(expiryKey('TXFA7-F', d('2027-01-05')), 202701);
  });
  test('跨十年後：2030-01-05 時 TXFL9-F → 202912', () => {
    assert.equal(expiryKey('TXFL9-F', d('2030-01-05')), 202912);
  });
  test('非月契約 → null', () => {
    for (const s of ['MX4J6-F', 'TXF-S', 'garbage', '', 'TXFM6-F', 'TXFJ6-S', 'txfj6-f', 'TXFJ66-F', ' TXFJ6-F']) {
      assert.equal(expiryKey(s, d('2026-10-16')), null, s);
    }
  });
  test('非字串輸入不爆 → null', () => {
    assert.equal(expiryKey(undefined, d('2026-10-16')), null);
    assert.equal(expiryKey(null, d('2026-10-16')), null);
  });
});

describe('pickNearMonth', () => {
  const now = d('2026-10-16');
  const list = [
    { SymbolID: 'TXFL6-F', n: 'dec' },
    { SymbolID: 'MX4J6-F', n: 'weekly' },
    { SymbolID: 'TXFJ6-F', n: 'oct' },
    { SymbolID: 'TXF-S', n: 'spot' },
    { SymbolID: 'TXFC7-F', n: 'mar' },
    { SymbolID: 'TXFK6-F', n: 'nov' },
  ];
  test('取到期年月最小的月契約', () => assert.equal(pickNearMonth(list, now).n, 'oct'));
  test('不依賴輸入順序', () => {
    assert.equal(pickNearMonth([...list].reverse(), now).n, 'oct');
    for (let i = 0; i < list.length; i += 1) {
      const rotated = [...list.slice(i), ...list.slice(0, i)];
      assert.equal(pickNearMonth(rotated, now).n, 'oct');
    }
  });
  test('跨年：12 月時 1 月契約不會排在 12 月前', () => {
    const l = [{ SymbolID: 'TXFA7-F', n: 'jan' }, { SymbolID: 'TXFL6-F', n: 'dec' }];
    assert.equal(pickNearMonth(l, d('2026-12-01')).n, 'dec');
  });
  test('無月契約 → null', () => {
    assert.equal(pickNearMonth([{ SymbolID: 'MX4J6-F' }, { SymbolID: 'TXF-S' }], now), null);
    assert.equal(pickNearMonth([], now), null);
  });
  test('不修改輸入陣列', () => {
    const copy = list.map((x) => x.n);
    pickNearMonth(list, now);
    assert.deepEqual(list.map((x) => x.n), copy);
  });
});

describe('sessionOrder', () => {
  // 參數為臺灣時間
  const tw = (hm) => new Date(`2026-10-16T${hm}:00+08:00`);
  test('08:45–14:59 先日盤', () => {
    for (const hm of ['08:45', '12:00', '13:45', '14:59']) assert.deepEqual(sessionOrder(tw(hm)), ['0', '1'], hm);
  });
  test('15:00 起到隔日 08:44 先夜盤', () => {
    for (const hm of ['15:00', '16:15', '23:59', '00:00', '04:59', '05:00', '08:44']) {
      assert.deepEqual(sessionOrder(tw(hm)), ['1', '0'], hm);
    }
  });
});

describe('toIsoTime', () => {
  test('日盤直接用 CDate', () => {
    assert.equal(toIsoTime('20261019', '093937', '0'), '2026-10-19T09:39:37+08:00');
  });

  test('夜盤跨午夜的成交日期加一天（含跨月）', () => {
    assert.equal(toIsoTime('20261016', '045959', '1'), '2026-10-17T04:59:59+08:00');
    assert.equal(toIsoTime('20261031', '000000', '1'), '2026-11-01T00:00:00+08:00');
  });

  test('夜盤午夜前不調整', () => {
    assert.equal(toIsoTime('20261016', '150000', '1'), '2026-10-16T15:00:00+08:00');
    assert.equal(toIsoTime('20261016', '235959', '1'), '2026-10-16T23:59:59+08:00');
  });

  test('格式不符回 null', () => {
    assert.equal(toIsoTime('', '093937', '0'), null);
    assert.equal(toIsoTime('20261019', '', '1'), null);
  });
});
