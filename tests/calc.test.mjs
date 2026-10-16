import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  positionMetrics, zoneOf, leverageForBuffer, requiredDeposit, gridLadder, GRID_STATUS,
} from '../js/calc.js';
import { DEFAULT_MARGINS, DEFAULT_LIQUIDATION_RATIO, CONTRACTS } from '../js/contracts.js';

const settings = () => ({ margins: structuredClone(DEFAULT_MARGINS), liquidationRatio: DEFAULT_LIQUIDATION_RATIO });
const close = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} ≉ ${b}`);
const golden = { contract: 'TMF', side: 'long', entry: 47100, deposit: 75000, qty: 1 };

describe('contracts 預設值', () => {
  test('乘數 TX 200、MTX 50、TMF 10', () => {
    assert.equal(CONTRACTS.TX.multiplier, 200);
    assert.equal(CONTRACTS.MTX.multiplier, 50);
    assert.equal(CONTRACTS.TMF.multiplier, 10);
  });
  test('預設保證金與 liquidationRatio', () => {
    assert.deepEqual(DEFAULT_MARGINS, {
      TX: { initial: 701000, maintenance: 538000 },
      MTX: { initial: 175250, maintenance: 134500 },
      TMF: { initial: 35050, maintenance: 26900 },
    });
    assert.equal(DEFAULT_LIQUIDATION_RATIO, 0.25);
  });
});

describe('positionMetrics 黃金案例（TMF 多 1 口 47100 / 75000）', () => {
  const m = positionMetrics(golden, settings());
  test('leverage 6.28', () => close(m.leverage, 6.28));
  test('liquidationPrice 40476.25', () => close(m.liquidationPrice, 40476.25));
  test('liquidationPoints 6623.75', () => close(m.liquidationPoints, 6623.75));
  test('buffer ≈ 0.1406', () => close(m.buffer, 0.1406, 1e-4));
  test('marginCallPrice 42290、marginCallPoints 4810', () => {
    close(m.marginCallPrice, 42290);
    close(m.marginCallPoints, 4810);
  });
  test('riskRatio ≈ 2.14', () => close(m.riskRatio, 2.14, 0.005));
  test('maxLoss 66237.5', () => close(m.maxLoss, 66237.5));
  test('maxLeverage ≈ 13.44', () => close(m.maxLeverage, 13.44, 0.005));
  test('zone steady', () => assert.equal(m.zone.key, 'steady'));
  test('其他欄位', () => {
    assert.equal(m.multiplier, 10);
    assert.equal(m.notional, 471000);
    assert.equal(m.initialMargin, 35050);
    assert.equal(m.maintenanceMargin, 26900);
    close(m.liquidationEquity, 8762.5);
    assert.equal(m.canOpen, true);
    assert.equal(m.belowMaintenance, false);
    assert.equal(m.liquidated, false);
    assert.equal(m.neverLiquidates, false);
  });
  test('權益數公式：在 liquidationPrice 時權益 = 斷頭權益，在 marginCallPrice 時 = 追繳權益', () => {
    const eq = (x) => golden.deposit + (x - golden.entry) * 10 * 1;
    close(eq(m.liquidationPrice), m.liquidationEquity);
    close(eq(m.marginCallPrice), m.maintenanceMargin);
  });
});

describe('positionMetrics 做空與其他商品', () => {
  test('TMF 空 2 口 47100 / 75000 → liq 49973.75、mc 48160', () => {
    const m = positionMetrics({ ...golden, side: 'short', qty: 2 }, settings());
    close(m.liquidationPrice, 49973.75);
    close(m.marginCallPrice, 48160);
    close(m.liquidationPoints, 2873.75);
    close(m.marginCallPoints, 1060);
    assert.ok(m.liquidationPoints > 0);
    assert.equal(m.initialMargin, 70100);
    close(m.liquidationEquity, 17525);
    close(m.maxLoss, 75000 - 17525);
  });
  test('TX 乘數 200、MTX 乘數 50 套用正確', () => {
    const tx = positionMetrics({ contract: 'TX', side: 'long', entry: 20000, deposit: 1000000, qty: 1 }, settings());
    assert.equal(tx.notional, 4000000);
    close(tx.liquidationPrice, 20000 + (701000 * 0.25 - 1000000) / 200);
    const mtx = positionMetrics({ contract: 'MTX', side: 'short', entry: 20000, deposit: 200000, qty: 3 }, settings());
    assert.equal(mtx.notional, 3000000);
    close(mtx.liquidationPrice, 20000 - (175250 * 3 * 0.25 - 200000) / 150);
  });
  test('保證金不足開倉：canOpen=false、belowMaintenance=true', () => {
    const m = positionMetrics({ ...golden, deposit: 20000 }, settings());
    assert.equal(m.canOpen, false);
    assert.equal(m.belowMaintenance, true);
  });
  test('deposit 剛好等於原始保證金 → canOpen=true；等於維持保證金 → belowMaintenance=false', () => {
    assert.equal(positionMetrics({ ...golden, deposit: 35050 }, settings()).canOpen, true);
    const m = positionMetrics({ ...golden, deposit: 26900 }, settings());
    assert.equal(m.belowMaintenance, false);
    assert.equal(m.canOpen, false);
  });
  test('deposit 低於斷頭權益 → liquidated、zone danger', () => {
    const m = positionMetrics({ ...golden, deposit: 8000 }, settings());
    assert.ok(m.buffer < 0);
    assert.equal(m.liquidated, true);
    assert.equal(m.zone.key, 'danger');
  });
  test('deposit 剛好等於斷頭權益 → buffer 0、liquidated', () => {
    const m = positionMetrics({ ...golden, deposit: 8762.5 }, settings());
    close(m.buffer, 0);
    assert.equal(m.liquidated, true);
  });
  test('做多保證金足以扛到 0 → neverLiquidates', () => {
    const m = positionMetrics({ ...golden, deposit: 471000 + 8762.5 + 1 }, settings());
    assert.ok(m.liquidationPrice <= 0);
    assert.equal(m.neverLiquidates, true);
    assert.equal(m.zone.key, 'safe');
  });
  test('做空永不 neverLiquidates', () => {
    const m = positionMetrics({ ...golden, side: 'short', deposit: 1e9 }, settings());
    assert.equal(m.neverLiquidates, false);
  });
  test('自訂 settings（liquidationRatio、保證金）生效', () => {
    const s = { margins: { ...DEFAULT_MARGINS, TMF: { initial: 40000, maintenance: 30000 } }, liquidationRatio: 0.5 };
    const m = positionMetrics(golden, s);
    assert.equal(m.liquidationEquity, 20000);
    close(m.liquidationPrice, 47100 + (20000 - 75000) / 10);
    close(m.maxLeverage, 471000 / 40000);
  });
});

describe('zoneOf 邊界', () => {
  const cases = [
    [1, 'safe'], [0.20, 'safe'], [0.1999999, 'steady'], [0.10, 'steady'], [0.0999999, 'aggressive'],
    [0.05, 'aggressive'], [0.0499999, 'danger'], [0, 'danger'], [-5, 'danger'], [-Infinity, 'danger'],
  ];
  for (const [b, key] of cases) {
    test(`zoneOf(${b}) → ${key}`, () => assert.equal(zoneOf(b).key, key));
  }
});

describe('leverageForBuffer', () => {
  test('公式 1/(b + ratio/maxLev)', () => {
    close(leverageForBuffer(0.1, 13.44, 0.25), 1 / (0.1 + 0.25 / 13.44));
    close(leverageForBuffer(0, 10, 0.25), 40);
  });
  test('與 positionMetrics.buffer 互為反函數（黃金案例）', () => {
    const m = positionMetrics(golden, settings());
    close(leverageForBuffer(m.buffer, m.maxLeverage, 0.25), m.leverage, 1e-9);
  });
  test('多組 leverage 往返一致（多空、不同商品）', () => {
    for (const contract of ['TX', 'MTX', 'TMF']) {
      for (const side of ['long', 'short']) {
        for (const lev of [1, 3, 6.28, 10]) {
          const entry = 23456;
          const deposit = (entry * CONTRACTS[contract].multiplier * 2) / lev;
          const m = positionMetrics({ contract, side, entry, deposit, qty: 2 }, settings());
          close(m.leverage, lev, 1e-9);
          close(leverageForBuffer(m.buffer, m.maxLeverage, 0.25), lev, 1e-9, `${contract} ${side} ${lev}`);
        }
      }
    }
  });
});

describe('requiredDeposit', () => {
  test('黃金案例 shock 0.15 → avoidLiquidation 79412.5', () => {
    const r = requiredDeposit(golden, settings(), 0.15);
    close(r.loss, 70650);
    close(r.avoidLiquidation, 79412.5);
    close(r.gap, 4412.5);
  });
  test('黃金案例 shock 0.10 → 55862.5 / 74000 / gap −19137.5', () => {
    const r = requiredDeposit(golden, settings(), 0.10);
    close(r.loss, 47100);
    close(r.avoidLiquidation, 55862.5);
    close(r.avoidMarginCall, 74000);
    close(r.gap, -19137.5);
  });
  test('shock 很小時下限為原始保證金×口數', () => {
    const r = requiredDeposit(golden, settings(), 0.01);
    assert.equal(r.avoidLiquidation, 35050);
    assert.equal(r.avoidMarginCall, 35050);
    const r2 = requiredDeposit({ ...golden, qty: 3 }, settings(), 0);
    assert.equal(r2.avoidLiquidation, 105150);
    assert.equal(r2.avoidMarginCall, 105150);
  });
  test('多口數與做空結果相同（與方向無關）', () => {
    const a = requiredDeposit({ ...golden, qty: 2 }, settings(), 0.2);
    const b = requiredDeposit({ ...golden, qty: 2, side: 'short' }, settings(), 0.2);
    assert.deepEqual(a, b);
    close(a.loss, 47100 * 0.2 * 10 * 2);
    close(a.avoidLiquidation, a.loss + 17525);
  });
  test('以 avoidLiquidation 存入時，反向波動 shock 剛好到斷頭價', () => {
    const r = requiredDeposit(golden, settings(), 0.15);
    const m = positionMetrics({ ...golden, deposit: r.avoidLiquidation }, settings());
    close(m.buffer, 0.15, 1e-9);
  });
});

describe('gridLadder', () => {
  const base = { contract: 'TMF', side: 'long', start: 47100, spacing: 500, qtyPerLevel: 1, levels: 6, deposit: 150000 };

  test('GRID_STATUS 常數', () => {
    assert.deepEqual(GRID_STATUS, { OK: 'ok', NO_MARGIN: 'noMargin', LIQUIDATED: 'liquidated', INVALID_PRICE: 'invalidPrice' });
  });

  test('已知案例：3 列 ok + 第 4 列 noMargin', () => {
    const rows = gridLadder(base, settings());
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => r.status), ['ok', 'ok', 'ok', 'noMargin']);
    assert.deepEqual(rows.map((r) => r.price), [47100, 46600, 46100, 45600]);
    assert.deepEqual(rows.map((r) => r.level), [1, 2, 3, 4]);
    close(rows[0].avg, 47100);
    close(rows[1].avg, 46850);
    close(rows[2].avg, 46600);
    assert.deepEqual(rows.slice(0, 3).map((r) => r.qty), [1, 2, 3]);
    close(rows[2].liquidationPrice, 42476.25);
    close(rows[3].equity, 120000);
    assert.equal(rows[3].required, 140200);
  });

  test('ok 列欄位計算正確（第 3 列）', () => {
    const r = gridLadder(base, settings())[2];
    close(r.equity, 135000);
    close(r.leverage, (46100 * 10 * 3) / 135000);
    close(r.riskRatio, 135000 / 105150);
    close(r.marginCallPrice, 46600 + (26900 * 3 - 150000) / 30);
    close(r.buffer, (46100 - 42476.25) / 46100);
    assert.equal(r.zone, zoneOf(r.buffer));
  });

  test('第 1 列與 positionMetrics 一致', () => {
    const r = gridLadder(base, settings())[0];
    const m = positionMetrics({ contract: 'TMF', side: 'long', entry: 47100, deposit: 150000, qty: 1 }, settings());
    close(r.liquidationPrice, m.liquidationPrice);
    close(r.marginCallPrice, m.marginCallPrice);
    close(r.buffer, m.buffer);
    close(r.leverage, m.leverage);
    close(r.riskRatio, m.riskRatio);
  });

  test('做空案例：價格往上加碼，對稱於做多', () => {
    const rows = gridLadder({ ...base, side: 'short' }, settings());
    assert.deepEqual(rows.map((r) => r.status), ['ok', 'ok', 'ok', 'noMargin']);
    assert.deepEqual(rows.map((r) => r.price), [47100, 47600, 48100, 48600]);
    close(rows[1].avg, 47350);
    close(rows[2].avg, 47600);
    close(rows[2].liquidationPrice, 51723.75);
    assert.ok(rows[2].buffer > 0);
    close(rows[3].equity, 120000);
    assert.equal(rows[3].required, 140200);
  });

  test('liquidated：間距很大、保證金剛好夠開 1 口', () => {
    const rows = gridLadder({ ...base, spacing: 10000, levels: 3, deposit: 35050 }, settings());
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'ok');
    assert.equal(rows[1].status, 'liquidated');
    assert.equal(rows[1].price, 37100);
    close(rows[1].liquidationPrice, 44471.25);
  });

  test('liquidated：價格恰好等於前一狀態斷頭價也算斷頭', () => {
    const rows = gridLadder({ ...base, spacing: 2628.75, levels: 3, deposit: 35050 }, settings());
    assert.equal(rows[1].price, 44471.25);
    assert.equal(rows[1].status, 'liquidated');
    close(rows[1].liquidationPrice, 44471.25);
    assert.equal(rows.length, 2);
  });

  test('做空 liquidated', () => {
    const rows = gridLadder({ ...base, side: 'short', spacing: 10000, levels: 3, deposit: 35050 }, settings());
    assert.deepEqual(rows.map((r) => r.status), ['ok', 'liquidated']);
    close(rows[1].liquidationPrice, 47100 + 2628.75);
  });

  test('invalidPrice：spacing 20000 價格跌到負數即停止', () => {
    const rows = gridLadder({ ...base, spacing: 20000, levels: 6, deposit: 10_000_000 }, settings());
    assert.deepEqual(rows.map((r) => r.status), ['ok', 'ok', 'ok', 'invalidPrice']);
    assert.equal(rows[3].price, -12900);
    assert.equal(rows[3].level, 4);
  });

  test('invalidPrice：價格剛好為 0 也停止', () => {
    const rows = gridLadder({ ...base, start: 1000, spacing: 1000, levels: 3, deposit: 10_000_000 }, settings());
    assert.deepEqual(rows.map((r) => r.status), ['ok', 'invalidPrice']);
    assert.equal(rows[1].price, 0);
  });

  test('invalidPrice 優先於其他檢查（即使保證金不足）', () => {
    const rows = gridLadder({ ...base, start: 1000, spacing: 1000, levels: 3, deposit: 35050 }, settings());
    assert.equal(rows[1].status, 'invalidPrice');
  });

  test('第 1 格保證金不足 → 只有 1 列 noMargin', () => {
    const rows = gridLadder({ ...base, deposit: 35049 }, settings());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'noMargin');
    assert.equal(rows[0].equity, 35049);
    assert.equal(rows[0].required, 35050);
  });

  test('qtyPerLevel > 1：required 以加碼後全部口數計算', () => {
    const rows = gridLadder({ ...base, qtyPerLevel: 2, deposit: 100000 }, settings());
    assert.equal(rows[0].status, 'ok');
    assert.equal(rows[0].qty, 2);
    assert.equal(rows[1].status, 'noMargin');
    assert.equal(rows[1].required, 35050 * 4);
  });

  test('levels 全部可執行', () => {
    const rows = gridLadder({ ...base, levels: 5, deposit: 1_000_000 }, settings());
    assert.equal(rows.length, 5);
    assert.ok(rows.every((r) => r.status === 'ok'));
    assert.deepEqual(rows.map((r) => r.qty), [1, 2, 3, 4, 5]);
    close(rows[4].avg, 46100);
  });

  test('levels 1 → 只有 1 列', () => {
    assert.equal(gridLadder({ ...base, levels: 1 }, settings()).length, 1);
  });
});
