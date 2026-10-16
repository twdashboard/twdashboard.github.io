import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, defaultSettings, normalize, importJson, exportJson, load, save, newId,
} from '../js/store.js';
import { DEFAULT_MARGINS } from '../js/contracts.js';

const goodPos = (o) => ({ id: 'p1', contract: 'TX', side: 'long', qty: 1, entry: 22000, price: 22100, ...o });
const goodTrade = (o) => ({ date: '2026-10-01', contract: 'TX', side: 'long', qty: 1, entry: 22000, exit: 22100, gross: 20000, cost: 148, net: 19852, ...o });
const XSS = '"><img src=x onerror=alert(1)>';

describe('defaultState / defaultSettings', () => {
  test('預設值', () => {
    const s = defaultState();
    assert.equal(s.version, 1);
    assert.deepEqual(s.account, { balance: 0 });
    assert.deepEqual(s.positions, []);
    assert.deepEqual(s.equityHistory, []);
    assert.deepEqual(s.trades, []);
    assert.deepEqual(s.settings, defaultSettings());
    const st = defaultSettings();
    assert.deepEqual(st.margins, DEFAULT_MARGINS);
    assert.deepEqual(st.feePerSide, { TX: 0, MTX: 0, TMF: 0 });
    assert.equal(st.taxRate, 0.00002);
    assert.equal(st.liquidationRatio, 0.25);
  });
  test('每次回傳獨立物件，修改不污染常數', () => {
    const a = defaultSettings();
    a.margins.TX.initial = 1;
    assert.equal(defaultSettings().margins.TX.initial, 701000);
    assert.equal(DEFAULT_MARGINS.TX.initial, 701000);
    assert.notEqual(defaultState(), defaultState());
  });
});

describe('normalize：基本', () => {
  for (const v of [null, undefined, 0, 1, 'str', true, NaN]) {
    test(`非物件 ${String(v)} → 預設`, () => assert.deepEqual(normalize(v), defaultState()));
  }
  test('空物件 → 預設', () => assert.deepEqual(normalize({}), defaultState()));
  test('合法完整 state 原樣保留', () => {
    const raw = {
      version: 1,
      account: { balance: 1234567 },
      settings: {
        margins: { TX: { initial: 800000, maintenance: 600000 }, MTX: { initial: 200000, maintenance: 150000 }, TMF: { initial: 40000, maintenance: 30000 } },
        marginDate: '2026-09-01',
        feePerSide: { TX: 60, MTX: 25, TMF: 10 },
        taxRate: 0.00002,
        liquidationRatio: 0.3,
      },
      positions: [goodPos(), goodPos({ id: 'p2', contract: 'TMF', side: 'short', qty: 3 })],
      equityHistory: [{ date: '2026-10-01', equity: 1 }, { date: '2026-10-02', equity: 2 }],
      trades: [goodTrade()],
    };
    assert.deepEqual(normalize(raw), raw);
  });
  test('balance 非有限數 → 0', () => {
    assert.equal(normalize({ account: { balance: 'abc' } }).account.balance, 0);
    assert.equal(normalize({ account: { balance: Infinity } }).account.balance, 0);
    assert.equal(normalize({ account: null }).account.balance, 0);
    assert.equal(normalize({ account: { balance: -5000 } }).account.balance, -5000);
  });
  test('陣列欄位非陣列 → 空陣列', () => {
    const r = normalize({ positions: 'x', equityHistory: {}, trades: 3 });
    assert.deepEqual(r.positions, []);
    assert.deepEqual(r.equityHistory, []);
    assert.deepEqual(r.trades, []);
  });
});

describe('normalize：positions（XSS 防線）', () => {
  test('side 非 long/short 丟棄（含 XSS payload）', () => {
    const r = normalize({ positions: [goodPos({ side: XSS }), goodPos({ id: 'ok' }), goodPos({ side: 'LONG' }), goodPos({ side: undefined }), goodPos({ side: ['long'] })] });
    assert.deepEqual(r.positions.map((p) => p.id), ['ok']);
  });
  test('contract 不在白名單丟棄', () => {
    const r = normalize({ positions: [goodPos({ contract: 'XX' }), goodPos({ contract: '__proto__' }), goodPos({ contract: XSS }), goodPos({ contract: 'tx' })] });
    assert.deepEqual(r.positions, []);
  });
  test('qty 非正整數丟棄', () => {
    for (const qty of [0, -1, 1.5, '1', NaN, Infinity, null]) {
      assert.deepEqual(normalize({ positions: [goodPos({ qty })] }).positions, [], `qty=${qty}`);
    }
  });
  test('entry/price 非正數丟棄', () => {
    for (const k of ['entry', 'price']) {
      for (const v of [0, -1, '22000', NaN, Infinity]) {
        assert.deepEqual(normalize({ positions: [goodPos({ [k]: v })] }).positions, [], `${k}=${v}`);
      }
    }
  });
  test('id 非字串丟棄；null 元素丟棄', () => {
    assert.deepEqual(normalize({ positions: [goodPos({ id: 1 }), null, 'x'] }).positions, []);
  });
});

describe('normalize：trades', () => {
  test('side 非 long/short 丟棄（XSS）', () => {
    const r = normalize({ trades: [goodTrade({ side: XSS }), goodTrade()] });
    assert.equal(r.trades.length, 1);
    assert.equal(r.trades[0].side, 'long');
  });
  test('contract 不在白名單丟棄', () => {
    assert.deepEqual(normalize({ trades: [goodTrade({ contract: 'ZZ' })] }).trades, []);
  });
  test('date 非 YYYY-MM-DD 丟棄', () => {
    for (const date of ['2026/10/01', '20261001', '2026-1-1', XSS, 20261001, null, '2026-10-01T00:00:00Z']) {
      assert.deepEqual(normalize({ trades: [goodTrade({ date })] }).trades, [], `date=${date}`);
    }
  });
  test('數值欄位非有限數丟棄', () => {
    for (const k of ['qty', 'entry', 'exit', 'gross', 'cost', 'net']) {
      assert.deepEqual(normalize({ trades: [goodTrade({ [k]: 'x' })] }).trades, [], k);
    }
  });
  test('qty 非正整數丟棄', () => {
    for (const qty of [0, -1, 1.5]) {
      assert.deepEqual(normalize({ trades: [goodTrade({ qty })] }).trades, [], `qty=${qty}`);
    }
  });
});

describe('normalize：equityHistory', () => {
  test('同日去重保留最後一筆並依日期排序', () => {
    const r = normalize({ equityHistory: [
      { date: '2026-10-03', equity: 3 },
      { date: '2026-10-01', equity: 1 },
      { date: '2026-10-03', equity: 33 },
      { date: '2026-10-02', equity: 2 },
    ] });
    assert.deepEqual(r.equityHistory, [
      { date: '2026-10-01', equity: 1 },
      { date: '2026-10-02', equity: 2 },
      { date: '2026-10-03', equity: 33 },
    ]);
  });
  test('date 不合法或 equity 非數字丟棄，多餘欄位剔除', () => {
    const r = normalize({ equityHistory: [
      { date: 'bad', equity: 1 }, { date: '2026-10-01', equity: '1' }, null,
      { date: '2026-10-02', equity: 5, evil: XSS },
    ] });
    assert.deepEqual(r.equityHistory, [{ date: '2026-10-02', equity: 5 }]);
  });
});

describe('normalize：settings', () => {
  test('margins initial < maintenance 用預設值', () => {
    const r = normalize({ settings: { margins: { TX: { initial: 100, maintenance: 200 } } } });
    assert.deepEqual(r.settings.margins.TX, DEFAULT_MARGINS.TX);
  });
  test('margins initial = maintenance 可接受', () => {
    const r = normalize({ settings: { margins: { MTX: { initial: 1000, maintenance: 1000 } } } });
    assert.deepEqual(r.settings.margins.MTX, { initial: 1000, maintenance: 1000 });
  });
  test('margins 非數字或 maintenance ≤ 0 用預設值', () => {
    const r = normalize({ settings: { margins: {
      TX: { initial: '9', maintenance: 1 }, MTX: { initial: 10, maintenance: 0 }, TMF: { initial: 10, maintenance: -1 },
    } } });
    assert.deepEqual(r.settings.margins, DEFAULT_MARGINS);
  });
  test('部分 margins 合法只更新該商品', () => {
    const r = normalize({ settings: { margins: { TMF: { initial: 40000, maintenance: 30000 } } } });
    assert.deepEqual(r.settings.margins.TMF, { initial: 40000, maintenance: 30000 });
    assert.deepEqual(r.settings.margins.TX, DEFAULT_MARGINS.TX);
  });
  test('liquidationRatio 需 0 ≤ x < 1', () => {
    const lr = (v) => normalize({ settings: { liquidationRatio: v } }).settings.liquidationRatio;
    assert.equal(lr(0), 0);
    assert.equal(lr(0.5), 0.5);
    assert.equal(lr(0.999), 0.999);
    assert.equal(lr(1), 0.25);
    assert.equal(lr(1.5), 0.25);
    assert.equal(lr(-0.1), 0.25);
    assert.equal(lr('0.3'), 0.25);
    assert.equal(lr(NaN), 0.25);
  });
  test('taxRate、feePerSide 需非負數', () => {
    const r = normalize({ settings: { taxRate: -1, feePerSide: { TX: -5, MTX: 'x', TMF: 12 } } });
    assert.equal(r.settings.taxRate, 0.00002);
    assert.deepEqual(r.settings.feePerSide, { TX: 0, MTX: 0, TMF: 12 });
    assert.equal(normalize({ settings: { taxRate: 0 } }).settings.taxRate, 0);
  });
  test('marginDate 格式不合法用預設值', () => {
    assert.equal(normalize({ settings: { marginDate: XSS } }).settings.marginDate, defaultSettings().marginDate);
    assert.equal(normalize({ settings: { marginDate: '2026-01-02' } }).settings.marginDate, '2026-01-02');
  });
  test('settings 為 null 不炸', () => {
    assert.deepEqual(normalize({ settings: null }).settings, defaultSettings());
  });
  test('未知欄位不會帶入輸出', () => {
    const r = normalize({ evil: 1, settings: { evil: 2 } });
    assert.equal('evil' in r, false);
    assert.equal('evil' in r.settings, false);
  });
});

describe('importJson / exportJson', () => {
  test('壞 JSON 丟例外', () => {
    assert.throws(() => importJson('{bad'), SyntaxError);
    assert.throws(() => importJson(''), SyntaxError);
  });
  test('round-trip', () => {
    const s = normalize({ account: { balance: 10 }, positions: [goodPos()], trades: [goodTrade()], equityHistory: [{ date: '2026-10-01', equity: 10 }] });
    const text = exportJson(s);
    assert.equal(typeof text, 'string');
    assert.ok(text.includes('\n  '), '應為 2 空白縮排');
    assert.deepEqual(importJson(text), s);
  });
  test('import 會經過 normalize 清洗', () => {
    const r = importJson(JSON.stringify({ positions: [goodPos({ side: XSS })] }));
    assert.deepEqual(r.positions, []);
  });
  test('合法 JSON 但非物件 → 預設', () => {
    assert.deepEqual(importJson('null'), defaultState());
    assert.deepEqual(importJson('42'), defaultState());
  });
});

describe('load / save（localStorage stub）', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const setStorage = (obj) => Object.defineProperty(globalThis, 'localStorage', { value: obj, configurable: true, writable: true });
  const memStorage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
  };
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });

  test('無資料 → 預設', () => {
    setStorage(memStorage());
    assert.deepEqual(load(), defaultState());
  });
  test('save 後 load 取回且經 normalize', () => {
    const st = memStorage();
    setStorage(st);
    const s = normalize({ account: { balance: 99 }, positions: [goodPos()] });
    assert.equal(save(s), true);
    assert.equal(st._m.size, 1);
    assert.deepEqual(load(), s);
  });
  test('儲存內容為壞 JSON → 預設', () => {
    setStorage({ getItem: () => '{oops', setItem() {} });
    assert.deepEqual(load(), defaultState());
  });
  test('儲存內容含 XSS side → 被清掉', () => {
    setStorage({ getItem: () => JSON.stringify({ positions: [goodPos({ side: XSS })] }), setItem() {} });
    assert.deepEqual(load().positions, []);
  });
  test('getItem 丟例外 → load 回傳預設', () => {
    setStorage({ getItem: () => { throw new Error('SecurityError'); }, setItem() {} });
    assert.deepEqual(load(), defaultState());
  });
  test('setItem 丟例外 → save 回傳 false', () => {
    setStorage({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } });
    assert.equal(save(defaultState()), false);
  });
  test('localStorage 不存在 → load 預設、save false', () => {
    setStorage(undefined);
    assert.deepEqual(load(), defaultState());
    assert.equal(save(defaultState()), false);
  });
});

test('newId 回傳 UUID 且不重複', () => {
  const a = newId();
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.notEqual(a, newId());
});
