import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMarginTable,
  cloneMargins,
  sameMargins,
  sanitizeOfficial,
  reconcileMargins,
  followOfficial,
  sourceAfterEdit,
  MARGIN_STATUS,
} from '../js/margins.js';
import { DEFAULT_MARGINS } from '../js/contracts.js';

const CODES = ['TX', 'MTX', 'TMF'];
const copy = (t) => structuredClone(t);
// 官方調升後的一組合法值（皆在 [0.3x, 3x] 內）
const RAISED = {
  TX: { initial: 800000, maintenance: 614000 },
  MTX: { initial: 200000, maintenance: 153500 },
  TMF: { initial: 40000, maintenance: 30700 },
};
const official = (margins = RAISED, date = '2026-10-16') => ({ date, margins: copy(margins) });
const settings = (over = {}) => ({
  margins: copy(DEFAULT_MARGINS),
  marginDate: '2026-08-12',
  marginsSource: 'official',
  dismissedOfficial: null,
  liquidationRatio: 0.25,
  colorScheme: 'redUp',
  ...over,
});
const scale = (k) => Object.fromEntries(CODES.map((c) => [c, {
  initial: DEFAULT_MARGINS[c].initial * k, maintenance: DEFAULT_MARGINS[c].maintenance * k,
}]));

describe('isMarginTable', () => {
  test('三檔都合法 → true', () => {
    assert.equal(isMarginTable(DEFAULT_MARGINS), true);
    assert.equal(isMarginTable(RAISED), true);
  });
  test('非物件或空值 → false', () => {
    for (const v of [null, undefined, 0, 'x', true, [], {}]) assert.equal(isMarginTable(v), false, String(v));
  });
  test('缺任一檔 → false', () => {
    for (const c of CODES) {
      const t = copy(DEFAULT_MARGINS);
      delete t[c];
      assert.equal(isMarginTable(t), false, c);
    }
  });
  test('任一檔不合法（initial < maintenance、maintenance ≤ 0、字串）→ false', () => {
    for (const bad of [{ initial: 1, maintenance: 2 }, { initial: 1, maintenance: 0 }, { initial: '2', maintenance: 1 }, null]) {
      const t = copy(DEFAULT_MARGINS);
      t.MTX = bad;
      assert.equal(isMarginTable(t), false, JSON.stringify(bad));
    }
  });
  test('initial 等於 maintenance 合法', () => {
    const t = copy(DEFAULT_MARGINS);
    t.TMF = { initial: 100, maintenance: 100 };
    assert.equal(isMarginTable(t), true);
  });
});

describe('cloneMargins', () => {
  test('深拷貝且只保留三檔的 initial/maintenance', () => {
    const src = { ...copy(RAISED), ZZ: { initial: 2, maintenance: 1 } };
    src.TX.evil = 'x';
    const c = cloneMargins(src);
    assert.deepEqual(c, RAISED);
    assert.notEqual(c, src);
    for (const code of CODES) assert.notEqual(c[code], src[code]);
    src.TX.initial = 1;
    assert.equal(c.TX.initial, 800000);
  });
});

describe('sameMargins', () => {
  test('數值相同（不同物件）→ true', () => {
    assert.equal(sameMargins(copy(DEFAULT_MARGINS), DEFAULT_MARGINS), true);
  });
  test('任一數值不同 → false', () => {
    for (const c of CODES) {
      for (const k of ['initial', 'maintenance']) {
        const t = copy(DEFAULT_MARGINS);
        t[c][k] += 1;
        assert.equal(sameMargins(t, DEFAULT_MARGINS), false, `${c}.${k}`);
      }
    }
  });
  test('型別不同（字串 vs 數字）→ false', () => {
    const t = copy(DEFAULT_MARGINS);
    t.TX.initial = '701000';
    assert.equal(sameMargins(t, DEFAULT_MARGINS), false);
  });
  test('null / undefined 不丟例外', () => {
    assert.equal(sameMargins(null, DEFAULT_MARGINS), false);
    assert.equal(sameMargins(DEFAULT_MARGINS, undefined), false);
    assert.equal(sameMargins({}, DEFAULT_MARGINS), false);
  });
  test('多餘欄位不影響比較', () => {
    const t = { ...copy(DEFAULT_MARGINS), ZZ: 1 };
    assert.equal(sameMargins(t, DEFAULT_MARGINS), true);
  });
});

describe('sanitizeOfficial', () => {
  test('合法資料 → { date, margins }', () => {
    assert.deepEqual(sanitizeOfficial({ date: '2026-10-16', margins: RAISED }), { date: '2026-10-16', margins: RAISED });
  });
  test('與內建值相同也合法', () => {
    assert.deepEqual(sanitizeOfficial({ date: '2026-08-12', margins: DEFAULT_MARGINS }), { date: '2026-08-12', margins: DEFAULT_MARGINS });
  });
  test('回傳深拷貝且丟棄多餘欄位', () => {
    const raw = { date: '2026-10-16', margins: { ...copy(RAISED), ZZ: { initial: 2, maintenance: 1 } }, fetchedAt: 'x', source: 'y', evil: 1 };
    raw.margins.TX.evil = '<img>';
    const r = sanitizeOfficial(raw);
    assert.deepEqual(Object.keys(r).sort(), ['date', 'margins']);
    assert.deepEqual(Object.keys(r.margins).sort(), ['MTX', 'TMF', 'TX']);
    assert.deepEqual(r.margins.TX, { initial: 800000, maintenance: 614000 });
    assert.notEqual(r.margins, raw.margins);
    raw.margins.TX.initial = 1;
    assert.equal(r.margins.TX.initial, 800000);
  });
  test('非物件輸入 → null', () => {
    for (const v of [null, undefined, 0, 'x', [], {}]) assert.equal(sanitizeOfficial(v), null, String(v));
  });
  test('date 格式不合法 → null', () => {
    for (const date of [undefined, null, '', '2026-1-1', '20261016', '2026/10/16', '2026-10-16T00:00', 20261016]) {
      assert.equal(sanitizeOfficial({ date, margins: RAISED }), null, String(date));
    }
  });
  test('缺任一檔 → 整份 null', () => {
    for (const c of CODES) {
      const m = copy(RAISED);
      delete m[c];
      assert.equal(sanitizeOfficial({ date: '2026-10-16', margins: m }), null, c);
    }
  });
  test('任一檔 isValidMargin 不通過 → 整份 null', () => {
    const bads = [
      { initial: 500000, maintenance: 600000 }, // initial < maintenance
      { initial: 701000, maintenance: 0 },
      { initial: '701000', maintenance: 538000 },
      { initial: NaN, maintenance: 538000 },
      { initial: 701000 },
    ];
    for (const bad of bads) {
      const m = copy(RAISED);
      m.TX = bad;
      assert.equal(sanitizeOfficial({ date: '2026-10-16', margins: m }), null, JSON.stringify(bad));
    }
  });
  test('範圍端點 0.3x 與 3x 含端點', () => {
    for (const k of [0.3, 3]) {
      const m = scale(k);
      assert.deepEqual(sanitizeOfficial({ date: '2026-10-16', margins: m }), { date: '2026-10-16', margins: m }, String(k));
    }
  });
  test('任一檔任一欄超出 [0.3x, 3x] → 整份 null', () => {
    for (const c of CODES) {
      for (const k of ['initial', 'maintenance']) {
        const base = DEFAULT_MARGINS[c][k];
        // 低於 0.3x：只動 maintenance 時同步維持 initial ≥ maintenance
        const low = copy(DEFAULT_MARGINS);
        low[c][k] = base * 0.3 - 1;
        if (k === 'initial') low[c].maintenance = Math.min(low[c].maintenance, low[c].initial);
        // 若為了維持合法性把 maintenance 一起拉低，也一定超出下界
        assert.equal(sanitizeOfficial({ date: '2026-10-16', margins: low }), null, `${c}.${k} low`);
        const high = copy(DEFAULT_MARGINS);
        high[c][k] = base * 3 + 1;
        if (k === 'maintenance') high[c].initial = Math.max(high[c].initial, high[c].maintenance);
        assert.equal(sanitizeOfficial({ date: '2026-10-16', margins: high }), null, `${c}.${k} high`);
      }
    }
  });
  test('只有一檔異常其他正常也整份丟棄', () => {
    const m = copy(RAISED);
    m.TMF = { initial: 3505000, maintenance: 2690000 }; // 100 倍
    assert.equal(sanitizeOfficial({ date: '2026-10-16', margins: m }), null);
  });
});

describe('reconcileMargins', () => {
  test('MARGIN_STATUS 值', () => {
    assert.deepEqual(MARGIN_STATUS, {
      UNAVAILABLE: 'unavailable', CURRENT: 'current', APPLIED: 'applied', DIFFERS: 'differs', DISMISSED: 'dismissed',
    });
  });
  test('official 為 null → unavailable，settings 為同一物件', () => {
    for (const src of ['official', 'custom']) {
      const s = settings({ marginsSource: src });
      const r = reconcileMargins(s, null);
      assert.equal(r.status, 'unavailable');
      assert.equal(r.settings, s);
    }
  });
  test('official 模式、margins 相同、日期不同 → current，只更新 marginDate', () => {
    const s = settings();
    const before = copy(s);
    const r = reconcileMargins(s, official(DEFAULT_MARGINS, '2026-10-16'));
    assert.equal(r.status, 'current');
    assert.notEqual(r.settings, s);
    assert.deepEqual(r.settings, { ...before, marginDate: '2026-10-16' });
    assert.deepEqual(s, before, '不改動原物件');
  });
  test('official 模式、margins 與日期都相同 → current，回原物件', () => {
    const s = settings();
    const r = reconcileMargins(s, official(DEFAULT_MARGINS, '2026-08-12'));
    assert.equal(r.status, 'current');
    assert.equal(r.settings, s);
  });
  test('custom 模式、margins 相同 → current，回原物件（不改 marginDate）', () => {
    const s = settings({ marginsSource: 'custom', margins: copy(RAISED), marginDate: '2026-09-01' });
    const r = reconcileMargins(s, official(RAISED, '2026-10-16'));
    assert.equal(r.status, 'current');
    assert.equal(r.settings, s);
    assert.equal(r.settings.marginDate, '2026-09-01');
  });
  test('official 模式、margins 不同 → applied，套用官方深拷貝、清除 dismissedOfficial', () => {
    const s = settings({ dismissedOfficial: copy(RAISED) });
    const before = copy(s);
    const o = official();
    const r = reconcileMargins(s, o);
    assert.equal(r.status, 'applied');
    assert.deepEqual(r.settings, { ...before, margins: RAISED, marginDate: '2026-10-16', dismissedOfficial: null });
    assert.notEqual(r.settings.margins, o.margins);
    o.margins.TX.initial = 1;
    assert.equal(r.settings.margins.TX.initial, 800000);
    assert.deepEqual(s, before, '不改動原物件');
  });
  test('applied 保留其他欄位', () => {
    const s = settings({ liquidationRatio: 0.4, colorScheme: 'greenUp' });
    const r = reconcileMargins(s, official());
    assert.equal(r.settings.liquidationRatio, 0.4);
    assert.equal(r.settings.colorScheme, 'greenUp');
    assert.equal(r.settings.marginsSource, 'official');
  });
  test('custom 模式、margins 不同、未略過 → differs，settings 不變', () => {
    const custom = scale(1.1);
    const s = settings({ marginsSource: 'custom', margins: custom });
    const r = reconcileMargins(s, official());
    assert.equal(r.status, 'differs');
    assert.equal(r.settings, s);
    assert.deepEqual(r.settings.margins, custom);
  });
  test('custom 模式、dismissedOfficial 與官方相同 → dismissed，settings 不變', () => {
    const s = settings({ marginsSource: 'custom', margins: scale(1.1), dismissedOfficial: copy(RAISED) });
    const r = reconcileMargins(s, official());
    assert.equal(r.status, 'dismissed');
    assert.equal(r.settings, s);
  });
  test('custom 模式、dismissedOfficial 為舊的另一組官方值 → differs', () => {
    const s = settings({ marginsSource: 'custom', margins: scale(1.1), dismissedOfficial: copy(DEFAULT_MARGINS) });
    const r = reconcileMargins(s, official());
    assert.equal(r.status, 'differs');
    assert.equal(r.settings, s);
  });
  test('marginsSource 非 official（未知值）視同不跟隨', () => {
    const s = settings({ marginsSource: undefined });
    const r = reconcileMargins(s, official());
    assert.equal(r.status, 'differs');
    assert.equal(r.settings, s);
  });
});

describe('followOfficial', () => {
  test('套用官方值，改為 official 並清除 dismissedOfficial，保留其他欄位', () => {
    const s = settings({ marginsSource: 'custom', margins: scale(1.1), dismissedOfficial: copy(RAISED), liquidationRatio: 0.3, colorScheme: 'greenUp' });
    const before = copy(s);
    const o = official();
    const r = followOfficial(s, o, '2026-08-12');
    assert.deepEqual(r, {
      ...before, margins: RAISED, marginDate: '2026-10-16', marginsSource: 'official', dismissedOfficial: null,
    });
    assert.notEqual(r.margins, o.margins);
    o.margins.TX.initial = 1;
    assert.equal(r.margins.TX.initial, 800000);
    assert.deepEqual(s, before, '不改動原物件');
  });
  test('official 為 null → 用 DEFAULT_MARGINS（深拷貝）與 fallbackDate', () => {
    const s = settings({ marginsSource: 'custom', margins: scale(1.1), dismissedOfficial: copy(RAISED) });
    const r = followOfficial(s, null, '2026-08-12');
    assert.deepEqual(r.margins, DEFAULT_MARGINS);
    assert.notEqual(r.margins, DEFAULT_MARGINS);
    assert.notEqual(r.margins.TX, DEFAULT_MARGINS.TX);
    assert.equal(r.marginDate, '2026-08-12');
    assert.equal(r.marginsSource, 'official');
    assert.equal(r.dismissedOfficial, null);
    r.margins.TX.initial = 1;
    assert.equal(DEFAULT_MARGINS.TX.initial, 701000);
  });
});

describe('sourceAfterEdit', () => {
  test('margins 沒改 → 沿用原來源', () => {
    for (const src of ['official', 'custom']) {
      const prev = settings({ marginsSource: src, margins: scale(1.1) });
      assert.equal(sourceAfterEdit(prev, scale(1.1), official()), src);
      assert.equal(sourceAfterEdit(prev, scale(1.1), null), src);
    }
  });
  test('改成與官方相同 → official', () => {
    const prev = settings({ marginsSource: 'custom', margins: scale(1.1) });
    assert.equal(sourceAfterEdit(prev, copy(RAISED), official()), 'official');
  });
  test('改成與官方不同 → custom（即使等於內建值）', () => {
    const prev = settings({ marginsSource: 'official', margins: copy(RAISED) });
    assert.equal(sourceAfterEdit(prev, scale(1.2), official()), 'custom');
    assert.equal(sourceAfterEdit(prev, copy(DEFAULT_MARGINS), official()), 'custom');
  });
  test('official 為 null：改成內建值 → official，否則 custom', () => {
    const prev = settings({ marginsSource: 'custom', margins: scale(1.1) });
    assert.equal(sourceAfterEdit(prev, copy(DEFAULT_MARGINS), null), 'official');
    assert.equal(sourceAfterEdit(prev, scale(1.2), null), 'custom');
  });
  test('只改一個欄位也視為有改', () => {
    const prev = settings({ marginsSource: 'official', margins: copy(DEFAULT_MARGINS) });
    const m = copy(DEFAULT_MARGINS);
    m.TMF.maintenance = 26000;
    assert.equal(sourceAfterEdit(prev, m, null), 'custom');
  });
});
