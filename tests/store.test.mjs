import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, defaultSettings, normalize, load, save } from '../js/store.js';
import { DEFAULT_MARGINS, SHOCK_OPTIONS } from '../js/contracts.js';

const KEY = 'twdashboard.state.v2';

describe('defaultState / defaultSettings', () => {
  test('每次回傳獨立物件（深層）', () => {
    const a = defaultState();
    const b = defaultState();
    assert.notEqual(a, b);
    assert.notEqual(a.calc, b.calc);
    assert.notEqual(a.settings.margins, b.settings.margins);
    a.calc.qty = 99;
    a.settings.margins.TMF.initial = 1;
    assert.equal(b.calc.qty, 1);
    assert.equal(defaultState().settings.margins.TMF.initial, 35050);
    assert.equal(DEFAULT_MARGINS.TMF.initial, 35050);
  });
  test('defaultSettings 獨立且內容正確', () => {
    const s = defaultSettings();
    s.margins.TX.initial = 0;
    assert.equal(defaultSettings().margins.TX.initial, 701000);
    assert.deepEqual(defaultSettings(), {
      margins: DEFAULT_MARGINS, marginDate: '2026-08-12', marginsSource: 'official', dismissedOfficial: null,
      liquidationRatio: 0.25, colorScheme: 'redUp',
    });
  });
  test('defaultState 內容', () => {
    const s = defaultState();
    assert.equal(s.version, 2);
    assert.deepEqual(s.calc, { contract: 'TMF', side: 'long', entry: 47100, deposit: 75000, qty: 1, shock: 0.1 });
    assert.deepEqual(s.grid, { contract: 'TMF', side: 'long', start: 47100, spacing: 500, qtyPerLevel: 1, levels: 6, deposit: 150000 });
  });
});

describe('normalize', () => {
  test('非物件輸入回傳預設', () => {
    for (const raw of [null, undefined, 0, 1, 'x', '', true, NaN]) {
      assert.deepEqual(normalize(raw), defaultState(), String(raw));
    }
  });
  test('空物件 → 預設', () => {
    assert.deepEqual(normalize({}), defaultState());
  });
  test('合法值保留', () => {
    const raw = {
      calc: { contract: 'TX', side: 'short', entry: 20000.5, deposit: 1e6, qty: 999, shock: 0.2 },
      grid: { contract: 'MTX', side: 'short', start: 21000, spacing: 100, qtyPerLevel: 3, levels: 50, deposit: 5e5 },
      settings: {
        marginDate: '2027-01-02', liquidationRatio: 0.5, colorScheme: 'greenUp',
        margins: { TX: { initial: 800000, maintenance: 600000 }, MTX: { initial: 100, maintenance: 100 } },
      },
    };
    const s = normalize(raw);
    assert.deepEqual(s.calc, raw.calc);
    assert.deepEqual(s.grid, raw.grid);
    assert.equal(s.settings.marginDate, '2027-01-02');
    assert.equal(s.settings.liquidationRatio, 0.5);
    assert.equal(s.settings.colorScheme, 'greenUp');
    assert.deepEqual(s.settings.margins.TX, { initial: 800000, maintenance: 600000 });
    assert.deepEqual(s.settings.margins.MTX, { initial: 100, maintenance: 100 });
    assert.deepEqual(s.settings.margins.TMF, DEFAULT_MARGINS.TMF);
  });
  test('每個 SHOCK_OPTIONS 都接受，其餘拒絕', () => {
    for (const v of SHOCK_OPTIONS) assert.equal(normalize({ calc: { shock: v } }).calc.shock, v);
    for (const v of [0.3, 0, -0.1, '0.1', 0.1000001]) assert.equal(normalize({ calc: { shock: v } }).calc.shock, 0.1);
  });
  test('contract / side 白名單', () => {
    const bad = ['tx', 'XX', '', null, 1, '__proto__', 'constructor', 'toString', '"><img src=x onerror=alert(1)>'];
    for (const v of bad) {
      const s = normalize({ calc: { contract: v, side: v }, grid: { contract: v, side: v } });
      assert.equal(s.calc.contract, 'TMF', String(v));
      assert.equal(s.calc.side, 'long');
      assert.equal(s.grid.contract, 'TMF');
      assert.equal(s.grid.side, 'long');
    }
  });
  test('價格與保證金需為正有限數', () => {
    for (const v of [0, -1, NaN, Infinity, '47100', null]) {
      const s = normalize({ calc: { entry: v, deposit: v }, grid: { start: v, spacing: v, deposit: v } });
      assert.equal(s.calc.entry, 47100, String(v));
      assert.equal(s.calc.deposit, 75000);
      assert.equal(s.grid.start, 47100);
      assert.equal(s.grid.spacing, 500);
      assert.equal(s.grid.deposit, 150000);
    }
  });
  test('qty / qtyPerLevel 為 1–999 整數（邊界）', () => {
    assert.equal(normalize({ calc: { qty: 1 } }).calc.qty, 1);
    assert.equal(normalize({ calc: { qty: 999 } }).calc.qty, 999);
    assert.equal(normalize({ grid: { qtyPerLevel: 999 } }).grid.qtyPerLevel, 999);
    for (const v of [0, 1000, 1.5, -1, '2']) {
      assert.equal(normalize({ calc: { qty: v } }).calc.qty, 1, String(v));
      assert.equal(normalize({ grid: { qtyPerLevel: v } }).grid.qtyPerLevel, 1, String(v));
    }
  });
  test('levels 為 1–50 整數（邊界）', () => {
    assert.equal(normalize({ grid: { levels: 1 } }).grid.levels, 1);
    assert.equal(normalize({ grid: { levels: 50 } }).grid.levels, 50);
    for (const v of [0, 51, 2.5, '6']) assert.equal(normalize({ grid: { levels: v } }).grid.levels, 6, String(v));
  });
  test('settings：marginDate 格式', () => {
    assert.equal(normalize({ settings: { marginDate: '2026-1-1' } }).settings.marginDate, '2026-08-12');
    assert.equal(normalize({ settings: { marginDate: '2026-01-01T00' } }).settings.marginDate, '2026-08-12');
    assert.equal(normalize({ settings: { marginDate: 20260101 } }).settings.marginDate, '2026-08-12');
  });
  test('settings：liquidationRatio 0<x<1', () => {
    for (const v of [0, 1, -0.1, 1.5, NaN, '0.3']) {
      assert.equal(normalize({ settings: { liquidationRatio: v } }).settings.liquidationRatio, 0.25, String(v));
    }
    assert.equal(normalize({ settings: { liquidationRatio: 0.0001 } }).settings.liquidationRatio, 0.0001);
    assert.equal(normalize({ settings: { liquidationRatio: 0.9999 } }).settings.liquidationRatio, 0.9999);
  });
  test('settings：colorScheme 只能 redUp/greenUp', () => {
    assert.equal(normalize({ settings: { colorScheme: 'greenUp' } }).settings.colorScheme, 'greenUp');
    for (const v of ['blue', '', 'REDUP', null]) {
      assert.equal(normalize({ settings: { colorScheme: v } }).settings.colorScheme, 'redUp');
    }
  });
  test('settings：不合法 margins 用預設', () => {
    const bad = [
      { initial: 100, maintenance: 200 }, // initial < maintenance
      { initial: 100, maintenance: 0 },
      { initial: 100, maintenance: -1 },
      { initial: '100', maintenance: 50 },
      { initial: 100 },
      null,
      'x',
      { initial: Infinity, maintenance: 1 },
    ];
    for (const m of bad) {
      const s = normalize({ settings: { margins: { TX: m, MTX: m, TMF: m } } });
      assert.deepEqual(s.settings.margins, DEFAULT_MARGINS, JSON.stringify(m));
    }
  });
  test('margins 只帶入 initial/maintenance，未知商品與多餘欄位丟棄', () => {
    const s = normalize({ settings: { margins: { TMF: { initial: 2, maintenance: 1, evil: 'x' }, ZZ: { initial: 2, maintenance: 1 } } } });
    assert.deepEqual(s.settings.margins.TMF, { initial: 2, maintenance: 1 });
    assert.deepEqual(Object.keys(s.settings.margins).sort(), ['MTX', 'TMF', 'TX']);
  });
  test('未知欄位不帶入', () => {
    const s = normalize({ evil: 1, version: 99, calc: { foo: 1 }, grid: { bar: 2 }, settings: { baz: 3 } });
    assert.deepEqual(Object.keys(s).sort(), ['calc', 'grid', 'settings', 'version']);
    assert.equal(s.version, 2);
    assert.equal('foo' in s.calc, false);
    assert.equal('bar' in s.grid, false);
    assert.equal('baz' in s.settings, false);
    assert.deepEqual(s, defaultState());
  });
  test('JSON 中的 __proto__ 不會污染原型', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":1},"calc":{"__proto__":{"polluted":2},"contract":"__proto__"},"settings":{"margins":{"__proto__":{"initial":2,"maintenance":1}}}}');
    const s = normalize(raw);
    assert.equal(({}).polluted, undefined);
    assert.equal(s.polluted, undefined);
    assert.equal(s.calc.polluted, undefined);
    assert.equal(s.calc.contract, 'TMF');
    assert.deepEqual(s.settings.margins, DEFAULT_MARGINS);
  });
  test('marginsSource：合法值 official/custom 保留', () => {
    for (const v of ['official', 'custom']) {
      assert.equal(normalize({ settings: { marginsSource: v } }).settings.marginsSource, v);
      const custom = { TX: { initial: 800000, maintenance: 600000 } };
      assert.equal(normalize({ settings: { marginsSource: v, margins: custom } }).settings.marginsSource, v);
    }
  });
  test('marginsSource：舊資料沒有此欄位，margins 等於內建值 → official', () => {
    assert.equal(normalize({ settings: {} }).settings.marginsSource, 'official');
    assert.equal(normalize({ settings: { margins: structuredClone(DEFAULT_MARGINS) } }).settings.marginsSource, 'official');
  });
  test('marginsSource：舊資料沒有此欄位，margins 與內建值不同 → custom', () => {
    const s = normalize({ settings: { margins: { TMF: { initial: 40000, maintenance: 30000 } } } });
    assert.equal(s.settings.marginsSource, 'custom');
  });
  test('marginsSource：不合法 margins 被換回內建值後推論為 official', () => {
    const s = normalize({ settings: { margins: { TX: { initial: 1, maintenance: 2 } } } });
    assert.deepEqual(s.settings.margins, DEFAULT_MARGINS);
    assert.equal(s.settings.marginsSource, 'official');
  });
  test('marginsSource：非法值同樣依 margins 推論', () => {
    const custom = { TX: { initial: 800000, maintenance: 600000 } };
    for (const v of ['OFFICIAL', 'auto', '', null, 1, true, {}, ['official'], '__proto__']) {
      assert.equal(normalize({ settings: { marginsSource: v } }).settings.marginsSource, 'official', String(v));
      assert.equal(normalize({ settings: { marginsSource: v, margins: custom } }).settings.marginsSource, 'custom', String(v));
    }
  });
  test('dismissedOfficial：完整合法表 → 深拷貝且只留三檔 initial/maintenance', () => {
    const table = {
      TX: { initial: 800000, maintenance: 614000, evil: 1 },
      MTX: { initial: 200000, maintenance: 153500 },
      TMF: { initial: 40000, maintenance: 30700 },
      ZZ: { initial: 2, maintenance: 1 },
    };
    const s = normalize({ settings: { dismissedOfficial: table } });
    assert.deepEqual(s.settings.dismissedOfficial, {
      TX: { initial: 800000, maintenance: 614000 },
      MTX: { initial: 200000, maintenance: 153500 },
      TMF: { initial: 40000, maintenance: 30700 },
    });
    assert.notEqual(s.settings.dismissedOfficial, table);
    assert.notEqual(s.settings.dismissedOfficial.TX, table.TX);
    table.TX.initial = 1;
    assert.equal(s.settings.dismissedOfficial.TX.initial, 800000);
  });
  test('dismissedOfficial：非完整或不合法 → null', () => {
    const ok = structuredClone(DEFAULT_MARGINS);
    const missing = structuredClone(DEFAULT_MARGINS);
    delete missing.TMF;
    const badOne = structuredClone(DEFAULT_MARGINS);
    badOne.MTX = { initial: 1, maintenance: 2 };
    const strOne = structuredClone(DEFAULT_MARGINS);
    strOne.TX = { initial: '701000', maintenance: 538000 };
    for (const v of [undefined, null, 0, 'x', true, [], {}, missing, badOne, strOne]) {
      assert.equal(normalize({ settings: { dismissedOfficial: v } }).settings.dismissedOfficial, null, JSON.stringify(v));
    }
    assert.deepEqual(normalize({ settings: { dismissedOfficial: ok } }).settings.dismissedOfficial, DEFAULT_MARGINS);
  });
  test('dismissedOfficial 的 __proto__ 不會污染原型', () => {
    const raw = JSON.parse('{"settings":{"dismissedOfficial":{"__proto__":{"polluted":1},"TX":{"initial":2,"maintenance":1},"MTX":{"initial":2,"maintenance":1},"TMF":{"initial":2,"maintenance":1}}}}');
    const s = normalize(raw);
    assert.equal(({}).polluted, undefined);
    assert.equal(s.settings.dismissedOfficial.polluted, undefined);
    assert.deepEqual(Object.keys(s.settings.dismissedOfficial).sort(), ['MTX', 'TMF', 'TX']);
  });
  test('settings 為非物件時 marginsSource/dismissedOfficial 用預設', () => {
    for (const v of [null, 'x', 5]) {
      const s = normalize({ settings: v });
      assert.equal(s.settings.marginsSource, 'official');
      assert.equal(s.settings.dismissedOfficial, null);
    }
  });
  test('calc/grid/settings 為非物件時用預設', () => {
    const s = normalize({ calc: 'x', grid: 5, settings: null });
    assert.deepEqual(s, defaultState());
  });
});

describe('load / save（localStorage stub）', () => {
  const had = Object.hasOwn(globalThis, 'localStorage');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stub = (impl) => Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true, writable: true });
  afterEach(() => {
    if (had && original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  const memory = () => {
    const map = new Map();
    return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
  };

  test('save 寫入 twdashboard.state.v2 並回傳 true；load 讀回', () => {
    const ls = memory();
    stub(ls);
    const s = defaultState();
    s.calc.contract = 'TX';
    s.settings.colorScheme = 'greenUp';
    assert.equal(save(s), true);
    assert.deepEqual([...ls.map.keys()], [KEY]);
    assert.deepEqual(JSON.parse(ls.map.get(KEY)), s);
    assert.deepEqual(load(), s);
  });
  test('沒有資料 → 預設', () => {
    stub(memory());
    assert.deepEqual(load(), defaultState());
  });
  test('load 讀的是 v2 key', () => {
    const ls = memory();
    ls.map.set('twdashboard.state.v1', JSON.stringify({ calc: { contract: 'TX' } }));
    stub(ls);
    assert.equal(load().calc.contract, 'TMF');
    ls.map.set(KEY, JSON.stringify({ calc: { contract: 'MTX' } }));
    assert.equal(load().calc.contract, 'MTX');
  });
  test('load 經過 normalize（不合法值被取代）', () => {
    const ls = memory();
    ls.map.set(KEY, JSON.stringify({ calc: { side: '"><img onerror=alert(1)>', qty: 5 }, extra: 1 }));
    stub(ls);
    const s = load();
    assert.equal(s.calc.side, 'long');
    assert.equal(s.calc.qty, 5);
    assert.equal('extra' in s, false);
  });
  test('壞 JSON → 預設', () => {
    const ls = memory();
    ls.map.set(KEY, '{not json');
    stub(ls);
    assert.deepEqual(load(), defaultState());
  });
  test('JSON 為 null / 數字 → 預設', () => {
    const ls = memory();
    stub(ls);
    ls.map.set(KEY, 'null');
    assert.deepEqual(load(), defaultState());
    ls.map.set(KEY, '42');
    assert.deepEqual(load(), defaultState());
  });
  test('getItem 丟例外 → 預設', () => {
    stub({ getItem() { throw new Error('SecurityError'); }, setItem() {} });
    assert.deepEqual(load(), defaultState());
  });
  test('localStorage 不存在 → load 預設、save false', () => {
    delete globalThis.localStorage;
    assert.deepEqual(load(), defaultState());
    assert.equal(save(defaultState()), false);
  });
  test('save/load 往返保留 marginsSource 與 dismissedOfficial', () => {
    stub(memory());
    const s = defaultState();
    s.settings.margins.TMF = { initial: 40000, maintenance: 30000 };
    s.settings.marginsSource = 'custom';
    s.settings.dismissedOfficial = structuredClone(DEFAULT_MARGINS);
    assert.equal(save(s), true);
    assert.deepEqual(load(), s);
  });
  test('setItem 丟例外 → save 回傳 false', () => {
    stub({ getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } });
    assert.equal(save(defaultState()), false);
  });
});
