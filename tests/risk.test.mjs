import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointValue, unrealizedPnl, marginRequirement, classify, computeSummary, stressTest,
  tradeCost, closePosition, drawdown, upsertEquity, byDate, STATUS,
} from '../js/risk.js';
import { defaultState, defaultSettings } from '../js/store.js';

const pos = (o) => ({ id: 'p1', contract: 'TX', side: 'long', qty: 1, entry: 22000, price: 22000, ...o });
const mkState = (balance, positions, settingsOverride = {}) => ({
  ...defaultState(),
  account: { balance },
  positions,
  settings: { ...defaultSettings(), ...settingsOverride },
});
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('STATUS / byDate', () => {
  test('STATUS 常數值', () => {
    assert.deepEqual(STATUS, { FLAT: 'flat', OK: 'ok', MARGIN_CALL: 'marginCall', LIQUIDATION: 'liquidation' });
  });
  test('byDate 依日期字串排序', () => {
    const arr = [{ date: '2026-03-01' }, { date: '2025-12-31' }, { date: '2026-01-15' }];
    assert.deepEqual(arr.sort(byDate).map((x) => x.date), ['2025-12-31', '2026-01-15', '2026-03-01']);
  });
});

describe('pointValue / unrealizedPnl', () => {
  test('多單 pointValue = 口數×乘數', () => {
    assert.equal(pointValue(pos({ qty: 2 })), 400);
    assert.equal(pointValue(pos({ contract: 'MTX', qty: 3 })), 150);
    assert.equal(pointValue(pos({ contract: 'TMF', qty: 1 })), 10);
  });
  test('空單 pointValue 為負', () => {
    assert.equal(pointValue(pos({ side: 'short', qty: 2 })), -400);
  });
  test('未實現 = (price−entry)×乘數×口數×方向', () => {
    assert.equal(unrealizedPnl(pos({ price: 22100 })), 20000);
    assert.equal(unrealizedPnl(pos({ side: 'short', price: 22100 })), -20000);
    assert.equal(unrealizedPnl(pos({ contract: 'MTX', side: 'short', qty: 2, price: 21900 })), 10000);
    assert.equal(unrealizedPnl(pos({ price: 22000 })), 0);
  });
});

describe('marginRequirement', () => {
  const m = defaultSettings().margins;
  test('空部位為 0', () => {
    assert.deepEqual(marginRequirement([], m), { initial: 0, maintenance: 0 });
  });
  test('多商品加總，空單也計保證金', () => {
    const r = marginRequirement([pos({ qty: 2 }), pos({ contract: 'MTX', side: 'short', qty: 1 }), pos({ contract: 'TMF', qty: 3 })], m);
    assert.equal(r.initial, 2 * 701000 + 175250 + 3 * 35050);
    assert.equal(r.maintenance, 2 * 538000 + 134500 + 3 * 26900);
  });
});

describe('classify', () => {
  test('initial 0 → flat', () => assert.equal(classify(100, 0, 0, 0.25), 'flat'));
  test('ok', () => assert.equal(classify(701000, 701000, 538000, 0.25), 'ok'));
  test('權益 = 維持保證金 → ok（嚴格小於才追繳）', () => assert.equal(classify(538000, 701000, 538000, 0.25), 'ok'));
  test('權益 < 維持 → marginCall', () => assert.equal(classify(537999, 701000, 538000, 0.25), 'marginCall'));
  test('風險指標 = liquidationRatio → liquidation（≤）', () => assert.equal(classify(175250, 701000, 538000, 0.25), 'liquidation'));
  test('風險指標略高於門檻 → marginCall', () => assert.equal(classify(175251, 701000, 538000, 0.25), 'marginCall'));
  test('權益為負 → liquidation', () => assert.equal(classify(-1, 701000, 538000, 0.25), 'liquidation'));
  test('liquidation 優先於 marginCall（維持保證金異常高）', () => assert.equal(classify(100, 701000, 10_000_000, 0.25), 'liquidation'));
  test('liquidationRatio 0、權益 0 → liquidation', () => assert.equal(classify(0, 701000, 538000, 0), 'liquidation'));
});

describe('computeSummary', () => {
  test('已知數值案例：TX 多 1 口 22000→22100、餘額 1,000,000', () => {
    const s = computeSummary(mkState(1_000_000, [pos({ price: 22100 })]));
    assert.equal(s.unrealized, 20000);
    assert.equal(s.equity, 1_020_000);
    assert.equal(s.initialMargin, 701000);
    assert.equal(s.maintenanceMargin, 538000);
    close(s.riskRatio, 1_020_000 / 701000);
    assert.equal(s.excessMargin, 1_020_000 - 701000);
    assert.equal(s.perPoint, 200);
    assert.equal(s.pointsToMarginCall, -2410);
    assert.equal(s.pointsToLiquidation, -4223.75);
    assert.equal(s.netTxEquivalent, 1);
    assert.equal(s.grossNotional, 4_420_000);
    assert.equal(s.netNotional, 4_420_000);
    close(s.grossLeverage, 4_420_000 / 1_020_000);
    close(s.netLeverage, 4_420_000 / 1_020_000);
    assert.equal(s.status, 'ok');
  });

  test('驗證：沿 pointsToMarginCall/Liquidation 移動後剛好到門檻', () => {
    const st = mkState(1_000_000, [pos({ price: 22100 })]);
    const s = computeSummary(st);
    const atMc = computeSummary(mkState(1_000_000, [pos({ price: 22100 + s.pointsToMarginCall })]));
    assert.equal(atMc.equity, 538000);
    const atLq = computeSummary(mkState(1_000_000, [pos({ price: 22100 + s.pointsToLiquidation })]));
    assert.equal(atLq.equity, 175250);
    assert.equal(atLq.status, 'liquidation');
  });

  test('空單：pointsTo* 為正（上漲）', () => {
    const s = computeSummary(mkState(1_000_000, [pos({ side: 'short', price: 22000 })]));
    assert.equal(s.pointsToMarginCall, (1_000_000 - 538000) / 200);
    assert.ok(s.pointsToMarginCall > 0);
    assert.ok(s.pointsToLiquidation > 0);
    assert.equal(s.netTxEquivalent, -1);
    assert.equal(s.netNotional, -4_400_000);
    close(s.netLeverage, 4_400_000 / 1_000_000);
  });

  test('無部位：riskRatio null、status flat、pointsTo* null', () => {
    const s = computeSummary(mkState(500000, []));
    assert.equal(s.equity, 500000);
    assert.equal(s.riskRatio, null);
    assert.equal(s.status, 'flat');
    assert.equal(s.pointsToMarginCall, null);
    assert.equal(s.pointsToLiquidation, null);
    assert.equal(s.netTxEquivalent, 0);
    assert.equal(s.grossNotional, 0);
    assert.equal(s.grossLeverage, 0);
  });

  test('權益數 = 餘額 + Σ未實現（多部位）', () => {
    const s = computeSummary(mkState(2_000_000, [
      pos({ id: 'a', price: 22100 }),
      pos({ id: 'b', contract: 'MTX', side: 'short', qty: 2, entry: 22000, price: 22100 }),
      pos({ id: 'c', contract: 'TMF', qty: 5, entry: 21000, price: 22100 }),
    ]));
    assert.equal(s.unrealized, 20000 - 10000 + 55000);
    assert.equal(s.equity, 2_065_000);
  });

  test('netTxEquivalent = Σ方向×口數×乘數 ÷ 200', () => {
    const s = computeSummary(mkState(5_000_000, [
      pos({ id: 'a', qty: 1 }),
      pos({ id: 'b', contract: 'MTX', side: 'short', qty: 2 }),
      pos({ id: 'c', contract: 'TMF', qty: 5 }),
    ]));
    assert.equal(s.netTxEquivalent, (200 - 100 + 50) / 200);
  });

  test('完全對沖且高於門檻：pointsTo* 為 null，netTxEquivalent 0', () => {
    const s = computeSummary(mkState(2_000_000, [pos({ id: 'a' }), pos({ id: 'b', side: 'short' })]));
    assert.equal(s.perPoint, 0);
    assert.equal(s.netTxEquivalent, 0);
    assert.equal(s.pointsToMarginCall, null);
    assert.equal(s.pointsToLiquidation, null);
    assert.equal(s.netNotional, 0);
    assert.equal(s.netLeverage, 0);
    assert.equal(s.grossNotional, 8_800_000);
  });

  test('完全對沖但已低於門檻：pointsTo* 回傳 0', () => {
    const s = computeSummary(mkState(100_000, [pos({ id: 'a' }), pos({ id: 'b', side: 'short' })]));
    assert.equal(s.pointsToMarginCall, 0);
    assert.equal(s.pointsToLiquidation, 0);
    assert.equal(s.status, 'liquidation');
  });

  test('已低於維持保證金但高於代沖銷：MC 為 0、Liq 為負', () => {
    const s = computeSummary(mkState(500_000, [pos()]));
    assert.equal(s.status, 'marginCall');
    assert.equal(s.pointsToMarginCall, 0);
    assert.equal(s.pointsToLiquidation, (175250 - 500000) / 200);
  });

  test('權益剛好等於維持保證金 → pointsToMarginCall 0', () => {
    const s = computeSummary(mkState(538000, [pos()]));
    assert.equal(s.pointsToMarginCall, 0);
  });

  test('代沖銷門檻使用自訂 liquidationRatio', () => {
    const s = computeSummary(mkState(1_000_000, [pos()], { liquidationRatio: 0.5 }));
    assert.equal(s.pointsToLiquidation, (701000 * 0.5 - 1_000_000) / 200);
  });

  test('權益 ≤ 0：槓桿為 null，status liquidation', () => {
    const s0 = computeSummary(mkState(0, [pos()]));
    assert.equal(s0.grossLeverage, null);
    assert.equal(s0.netLeverage, null);
    const sNeg = computeSummary(mkState(-100, [pos()]));
    assert.equal(sNeg.grossLeverage, null);
    assert.equal(sNeg.status, 'liquidation');
  });

  test('使用自訂保證金', () => {
    const margins = { ...defaultSettings().margins, TX: { initial: 800000, maintenance: 600000 } };
    const s = computeSummary(mkState(1_000_000, [pos({ qty: 1 })], { margins }));
    assert.equal(s.initialMargin, 800000);
    assert.equal(s.maintenanceMargin, 600000);
  });
});

describe('stressTest', () => {
  test('預設 10 個 shocks，pnl = Σ pointValue×price×shock，保證金不變', () => {
    const st = mkState(1_000_000, [pos({ price: 22100 })]);
    const r = stressTest(st);
    assert.equal(r.length, 10);
    for (const row of r) {
      close(row.pnl, 200 * 22100 * row.shock, 1e-6);
      close(row.equity, 1_020_000 + row.pnl, 1e-6);
      close(row.riskRatio, row.equity / 701000, 1e-12);
    }
    const down10 = r.find((x) => x.shock === -0.10);
    close(down10.pnl, -442000, 1e-6);
    assert.equal(down10.status, 'ok');
  });
  test('多空混合與狀態判斷', () => {
    const st = mkState(600_000, [pos({ id: 'a', qty: 1, price: 20000, entry: 20000 })]);
    const r = stressTest(st, [-0.10, 0, 0.05]);
    assert.deepEqual(r.map((x) => x.shock), [-0.10, 0, 0.05]);
    close(r[0].pnl, -400000, 1e-6);
    assert.equal(r[0].status, 'marginCall'); // 200000 > 175250
    assert.equal(r[1].pnl, 0);
    assert.equal(r[1].status, 'ok');
    const r2 = stressTest(mkState(400_000, [pos({ price: 20000, entry: 20000 })]), [-0.10]);
    assert.equal(r2[0].status, 'liquidation'); // equity 0
  });
  test('空單在下跌情境獲利', () => {
    const r = stressTest(mkState(1_000_000, [pos({ side: 'short', price: 20000, entry: 20000 })]), [-0.05]);
    close(r[0].pnl, 200000, 1e-6);
  });
  test('無部位：pnl 0、riskRatio null、flat', () => {
    const r = stressTest(mkState(100, []));
    for (const row of r) {
      assert.equal(row.pnl, 0);
      assert.equal(row.equity, 100);
      assert.equal(row.riskRatio, null);
      assert.equal(row.status, 'flat');
    }
  });
});

describe('tradeCost', () => {
  test('手續費×口數 + round(價格×乘數×口數×稅率)', () => {
    const settings = { ...defaultSettings(), feePerSide: { TX: 60, MTX: 25, TMF: 10 } };
    // 22000*200*0.00002 = 88
    assert.equal(tradeCost('TX', 1, 22000, settings), 60 + 88);
    assert.equal(tradeCost('TX', 3, 22000, settings), 180 + 264);
    // 22123*50*2*0.00002 = 44.246 → 44
    assert.equal(tradeCost('MTX', 2, 22123, settings), 50 + 44);
    // 22125*10*0.00002 = 4.425 → 4 ; 22175*10*0.00002=4.435 → 4
    assert.equal(tradeCost('TMF', 1, 22250, settings), 10 + Math.round(4.45));
  });
  test('四捨五入（.5 進位）', () => {
    const settings = { ...defaultSettings(), feePerSide: { TX: 0, MTX: 0, TMF: 0 } };
    // 12500*10*0.00002 = 2.5 → 3（浮點可能略差，以 Math.round 同式為準）
    assert.equal(tradeCost('TMF', 1, 12500, settings), Math.round(12500 * 10 * 1 * 0.00002));
    assert.equal(tradeCost('TX', 1, 22000, settings), 88);
  });
  test('稅率 0 只剩手續費', () => {
    const settings = { ...defaultSettings(), taxRate: 0, feePerSide: { TX: 50, MTX: 0, TMF: 0 } };
    assert.equal(tradeCost('TX', 2, 22000, settings), 100);
  });
});

describe('closePosition', () => {
  const settings = { ...defaultSettings(), feePerSide: { TX: 60, MTX: 25, TMF: 10 } };
  const base = () => ({
    ...defaultState(),
    account: { balance: 1_000_000 },
    settings,
    positions: [pos({ id: 'a', qty: 3, entry: 22000, price: 22050 }), pos({ id: 'b', contract: 'MTX', side: 'short', qty: 1, entry: 22000, price: 22050 })],
    trades: [],
  });

  test('全平：移除部位、餘額加淨損益、新增 trade', () => {
    const s = base();
    const n = closePosition(s, 'a', 3, 22100, '2026-10-16');
    assert.equal(n.positions.length, 1);
    assert.equal(n.positions[0].id, 'b');
    const gross = 100 * 200 * 3;
    const cost = 60 * 3 + Math.round(22100 * 200 * 3 * 0.00002);
    assert.equal(n.account.balance, 1_000_000 + gross - cost);
    assert.equal(n.trades.length, 1);
    assert.deepEqual(n.trades[0], {
      date: '2026-10-16', contract: 'TX', side: 'long', qty: 3, entry: 22000, exit: 22100, gross, cost, net: gross - cost,
    });
  });

  test('部分平倉：減口數、保留 id', () => {
    const n = closePosition(base(), 'a', 1, 21900, '2026-10-16');
    const a = n.positions.find((p) => p.id === 'a');
    assert.equal(a.qty, 2);
    assert.equal(n.positions.length, 2);
    const gross = -100 * 200;
    const cost = 60 + Math.round(21900 * 200 * 0.00002);
    assert.equal(n.trades[0].net, gross - cost);
    assert.equal(n.account.balance, 1_000_000 + gross - cost);
  });

  test('空單平倉損益方向正確', () => {
    const n = closePosition(base(), 'b', 1, 21800, '2026-10-16');
    assert.equal(n.trades[0].gross, 200 * 50);
    assert.equal(n.trades[0].side, 'short');
  });

  test('只扣平倉邊成本（非來回）', () => {
    const n = closePosition(base(), 'a', 1, 22000, '2026-10-16');
    assert.equal(n.trades[0].cost, tradeCost('TX', 1, 22000, settings));
    assert.equal(n.account.balance, 1_000_000 - tradeCost('TX', 1, 22000, settings));
  });

  test('immutability：不修改原 state', () => {
    const s = base();
    const snapshot = structuredClone(s);
    const n = closePosition(s, 'a', 1, 22100, '2026-10-16');
    assert.deepEqual(s, snapshot);
    assert.notEqual(n, s);
    assert.notEqual(n.positions, s.positions);
    assert.notEqual(n.trades, s.trades);
    assert.notEqual(n.account, s.account);
  });

  test('保留既有 trades', () => {
    const s = { ...base(), trades: [{ date: '2026-01-01', contract: 'TX', side: 'long', qty: 1, entry: 1, exit: 2, gross: 0, cost: 0, net: 0 }] };
    const n = closePosition(s, 'a', 1, 22100, '2026-10-16');
    assert.equal(n.trades.length, 2);
    assert.equal(n.trades[0].date, '2026-01-01');
  });

  test('錯誤輸入丟例外', () => {
    const s = base();
    assert.throws(() => closePosition(s, 'nope', 1, 22000, 'd'), /找不到部位/);
    assert.throws(() => closePosition(s, 'a', 1.5, 22000, 'd'), /口數/);
    assert.throws(() => closePosition(s, 'a', 0, 22000, 'd'), /口數/);
    assert.throws(() => closePosition(s, 'a', -1, 22000, 'd'), /口數/);
    assert.throws(() => closePosition(s, 'a', 4, 22000, 'd'), /口數/);
    assert.throws(() => closePosition(s, 'a', '1', 22000, 'd'), /口數/);
    assert.throws(() => closePosition(s, 'a', NaN, 22000, 'd'), /口數/);
    assert.throws(() => closePosition(s, 'a', 1, 0, 'd'), /價格/);
    assert.throws(() => closePosition(s, 'a', 1, -100, 'd'), /價格/);
    assert.throws(() => closePosition(s, 'a', 1, NaN, 'd'), /價格/);
    assert.throws(() => closePosition(s, 'a', 1, undefined, 'd'), /價格/);
  });
});

describe('drawdown', () => {
  test('空陣列：全 0/null', () => {
    assert.deepEqual(drawdown([]), {
      maxDrawdown: 0, maxDrawdownPct: 0, peakDate: null, troughDate: null, currentDrawdown: 0, currentDrawdownPct: 0,
    });
  });
  test('單筆：全 0', () => {
    const r = drawdown([{ date: '2026-01-01', equity: 1000 }]);
    assert.equal(r.maxDrawdown, 0);
    assert.equal(r.maxDrawdownPct, 0);
    assert.equal(r.currentDrawdown, 0);
    assert.equal(r.currentDrawdownPct, 0);
    assert.equal(r.peakDate, null);
    assert.equal(r.troughDate, null);
  });
  const series = [
    { date: '2026-01-01', equity: 100 },
    { date: '2026-01-02', equity: 120 },
    { date: '2026-01-03', equity: 90 },
    { date: '2026-01-04', equity: 130 },
    { date: '2026-01-05', equity: 110 },
  ];
  test('最大回撤與目前回撤', () => {
    const r = drawdown(series);
    assert.equal(r.maxDrawdown, 30);
    close(r.maxDrawdownPct, 30 / 120);
    assert.equal(r.peakDate, '2026-01-02');
    assert.equal(r.troughDate, '2026-01-03');
    assert.equal(r.currentDrawdown, 20);
    close(r.currentDrawdownPct, 20 / 130);
  });
  test('亂序輸入結果相同且不修改原陣列', () => {
    const shuffled = [series[3], series[0], series[4], series[2], series[1]];
    const copy = structuredClone(shuffled);
    assert.deepEqual(drawdown(shuffled), drawdown(series));
    assert.deepEqual(shuffled, copy);
  });
  test('單調上升：無回撤', () => {
    const r = drawdown([{ date: '2026-01-01', equity: 1 }, { date: '2026-01-02', equity: 2 }]);
    assert.equal(r.maxDrawdown, 0);
    assert.equal(r.currentDrawdown, 0);
    assert.equal(r.peakDate, null);
  });
  test('peak ≤ 0 時百分比為 0', () => {
    const r = drawdown([{ date: '2026-01-01', equity: 0 }, { date: '2026-01-02', equity: -50 }]);
    assert.equal(r.maxDrawdown, 50);
    assert.equal(r.maxDrawdownPct, 0);
    assert.equal(r.currentDrawdown, 50);
    assert.equal(r.currentDrawdownPct, 0);
    const r2 = drawdown([{ date: '2026-01-01', equity: -10 }, { date: '2026-01-02', equity: -50 }]);
    assert.equal(r2.maxDrawdownPct, 0);
    assert.equal(r2.currentDrawdownPct, 0);
  });
  test('跌破 0 的回撤百分比可超過 100%', () => {
    const r = drawdown([{ date: '2026-01-01', equity: 100 }, { date: '2026-01-02', equity: -50 }]);
    assert.equal(r.maxDrawdown, 150);
    close(r.maxDrawdownPct, 1.5);
  });
});

describe('upsertEquity', () => {
  test('新增並依日期排序', () => {
    const h = [{ date: '2026-01-03', equity: 3 }, { date: '2026-01-01', equity: 1 }];
    const r = upsertEquity(h, '2026-01-02', 2);
    assert.deepEqual(r.map((x) => x.date), ['2026-01-01', '2026-01-02', '2026-01-03']);
  });
  test('同日覆蓋', () => {
    const h = [{ date: '2026-01-01', equity: 1 }, { date: '2026-01-02', equity: 2 }];
    const r = upsertEquity(h, '2026-01-01', 99);
    assert.equal(r.length, 2);
    assert.deepEqual(r[0], { date: '2026-01-01', equity: 99 });
  });
  test('不修改原陣列', () => {
    const h = [{ date: '2026-01-01', equity: 1 }];
    const copy = structuredClone(h);
    const r = upsertEquity(h, '2026-01-01', 5);
    assert.deepEqual(h, copy);
    assert.notEqual(r, h);
  });
  test('空陣列', () => {
    assert.deepEqual(upsertEquity([], '2026-01-01', 7), [{ date: '2026-01-01', equity: 7 }]);
  });
});
