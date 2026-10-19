import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMargins } from '../scripts/fetch-margins.mjs';

const row = (Contract, InitialMargin, MaintenanceMargin, Date = '20261016', ClearingMargin = '1') =>
  ({ Contract, ClearingMargin, MaintenanceMargin, InitialMargin, Date });

// 仿期交所 IndexFuturesAndOptionsMargining 回傳：含選擇權、其他期貨與相似名稱
const apiList = () => [
  row('臺股期貨', '701000', '538000'),
  row('電子期貨', '300000', '230000'),
  row('臺指選擇權風險保證金(A)值', '120000', '92000'),
  row('小型臺指', '175250', '134500'),
  row('客製化小型臺指期貨', '999999', '888888'),
  row('中型100', '80000', '61000'),
  row('微型臺指期貨', '35050', '26900'),
];
const EXPECTED = {
  date: '2026-10-16',
  margins: {
    TX: { initial: 701000, maintenance: 538000 },
    MTX: { initial: 175250, maintenance: 134500 },
    TMF: { initial: 35050, maintenance: 26900 },
  },
};
const replace = (list, contract, patch) => list.map((r) => (r.Contract === contract ? { ...r, ...patch } : r));

describe('parseMargins', () => {
  test('實際 API 格式解析出三檔與日期', () => {
    assert.deepEqual(parseMargins(apiList()), EXPECTED);
  });
  test('只回傳 date 與 margins', () => {
    const r = parseMargins(apiList());
    assert.deepEqual(Object.keys(r).sort(), ['date', 'margins']);
    assert.deepEqual(Object.keys(r.margins).sort(), ['MTX', 'TMF', 'TX']);
  });
  test('「客製化小型臺指期貨」排在小型臺指之後且數值不同也不影響 MTX', () => {
    const list = [...apiList(), row('客製化小型臺指期貨', '200000', '150000')];
    assert.deepEqual(parseMargins(list).margins.MTX, EXPECTED.margins.MTX);
  });
  test('只有「客製化小型臺指期貨」沒有「小型臺指」→ null', () => {
    const list = apiList().filter((r) => r.Contract !== '小型臺指');
    assert.equal(parseMargins(list), null);
  });
  test('名稱需完全相符（前後空白、相似名稱不採用）', () => {
    assert.equal(parseMargins(replace(apiList(), '臺股期貨', { Contract: ' 臺股期貨' })), null);
    assert.equal(parseMargins(replace(apiList(), '微型臺指期貨', { Contract: '微型臺指' })), null);
    assert.equal(parseMargins(replace(apiList(), '臺股期貨', { Contract: '台股期貨' })), null);
  });
  test('清單順序不影響結果', () => {
    assert.deepEqual(parseMargins(apiList().reverse()), EXPECTED);
  });
  test('缺任一商品 → null', () => {
    for (const c of ['臺股期貨', '小型臺指', '微型臺指期貨']) {
      assert.equal(parseMargins(apiList().filter((r) => r.Contract !== c)), null, c);
    }
  });
  test('非陣列 → null', () => {
    for (const v of [null, undefined, {}, 'x', 0, { data: apiList() }]) assert.equal(parseMargins(v), null, String(v));
  });
  test('空陣列 → null', () => {
    assert.equal(parseMargins([]), null);
  });
  test('清單含 null／非物件列不丟例外', () => {
    assert.deepEqual(parseMargins([null, 1, 'x', ...apiList(), undefined]), EXPECTED);
  });
  test('保證金非純數字字串 → null', () => {
    for (const v of ['', '701,000', '701000.5', '-701000', ' 701000', 'abc', null, undefined]) {
      assert.equal(parseMargins(replace(apiList(), '臺股期貨', { InitialMargin: v })), null, `Initial ${String(v)}`);
      assert.equal(parseMargins(replace(apiList(), '微型臺指期貨', { MaintenanceMargin: v })), null, `Maintenance ${String(v)}`);
    }
  });
  test('Date YYYYMMDD → YYYY-MM-DD', () => {
    const list = apiList().map((r) => ({ ...r, Date: '20270105' }));
    assert.equal(parseMargins(list).date, '2027-01-05');
  });
  test('所有列 Date 缺漏或格式錯誤 → null', () => {
    for (const d of [undefined, null, '', '2026-10-16', '2026101', '202610160']) {
      const list = apiList().map((r) => ({ ...r, Date: d }));
      assert.equal(parseMargins(list), null, String(d));
    }
  });
  test('Date 為數字型別（非字串）→ null，不丟例外', () => {
    const list = apiList().map((r) => ({ ...r, Date: 20261016 }));
    assert.doesNotThrow(() => parseMargins(list));
    assert.equal(parseMargins(list), null);
  });
  test('數值超出合理範圍（交由 sanitizeOfficial）→ null', () => {
    assert.equal(parseMargins(replace(apiList(), '臺股期貨', { InitialMargin: '70100000', MaintenanceMargin: '53800000' })), null);
  });
  test('initial < maintenance → null', () => {
    assert.equal(parseMargins(replace(apiList(), '小型臺指', { InitialMargin: '134500', MaintenanceMargin: '175250' })), null);
  });
  test('官方調整後的新值可解析', () => {
    const list = replace(apiList(), '臺股期貨', { InitialMargin: '800000', MaintenanceMargin: '614000' });
    assert.deepEqual(parseMargins(list).margins.TX, { initial: 800000, maintenance: 614000 });
  });
});
