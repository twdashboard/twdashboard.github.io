// 單一部位與網格加碼的風控計算：純函式，不碰 DOM 與儲存，方便單元測試。
// 金額單位為新臺幣元，價格單位為指數點；不計手續費與期交稅。
//
// 核心關係：權益數(X) = 存入保證金 + 方向 × (X − 均價) × 乘數 × 口數
// 斷頭：權益數 ≤ 原始保證金 × 口數 × 代沖銷比例（盤中風險指標）
// 追繳：權益數 < 維持保證金 × 口數（盤後）

import { CONTRACTS, BUFFER_ZONES } from './contracts.js';

const direction = (side) => (side === 'short' ? -1 : 1);

/** 從 from 到 to 是不是朝部位不利的方向，回傳不利方向的點數（負數代表有利） */
const adverse = (side, from, to) => direction(side) * (from - to);

/** 某商品、某口數下的保證金門檻 */
function thresholds(contract, qty, settings) {
  const { initial, maintenance } = settings.margins[contract];
  return {
    multiplier: CONTRACTS[contract].multiplier,
    initial: initial * qty,
    maintenance: maintenance * qty,
    liquidation: initial * qty * settings.liquidationRatio,
  };
}

/** 權益數到達 targetEquity 時的指數價位 */
function priceAtEquity({ side, avg, qty, deposit, multiplier }, targetEquity) {
  return avg + direction(side) * (targetEquity - deposit) / (multiplier * qty);
}

/** 依距斷頭緩衝決定分區 */
export function zoneOf(buffer) {
  return BUFFER_ZONES.find((z) => buffer >= z.min);
}

/** 距斷頭緩衝 b 對應的槓桿倍數：b = 1/槓桿 − 代沖銷比例/最大槓桿 */
export function leverageForBuffer(buffer, maxLeverage, liquidationRatio) {
  return 1 / (buffer + liquidationRatio / maxLeverage);
}

/**
 * 單一部位風控指標
 * @param {{contract: string, side: 'long'|'short', entry: number, deposit: number, qty: number}} input
 * @param {{margins: object, liquidationRatio: number}} settings
 */
export function positionMetrics(input, settings) {
  const { contract, side, entry, deposit, qty } = input;
  const t = thresholds(contract, qty, settings);
  const pos = { side, avg: entry, qty, deposit, multiplier: t.multiplier };

  const liquidationPrice = priceAtEquity(pos, t.liquidation);
  const marginCallPrice = priceAtEquity(pos, t.maintenance);
  const liquidationPoints = adverse(side, entry, liquidationPrice);
  const buffer = liquidationPoints / entry;
  const notional = entry * t.multiplier * qty;

  return {
    multiplier: t.multiplier,
    notional,
    initialMargin: t.initial,
    maintenanceMargin: t.maintenance,
    liquidationEquity: t.liquidation,
    leverage: notional / deposit,
    maxLeverage: (entry * t.multiplier) / settings.margins[contract].initial,
    riskRatio: deposit / t.initial,
    canOpen: deposit >= t.initial,
    belowMaintenance: deposit < t.maintenance,
    liquidated: buffer <= 0,
    // 做多且保證金夠多時，指數跌到 0 也不會斷頭
    neverLiquidates: liquidationPrice <= 0,
    liquidationPrice,
    liquidationPoints,
    buffer,
    marginCallPrice,
    marginCallPoints: adverse(side, entry, marginCallPrice),
    maxLoss: deposit - t.liquidation,
    zone: zoneOf(buffer),
  };
}

/**
 * 要扛住 shock（例如 0.1 = 10%）的反向波動，至少需要存入多少保證金（不低於開倉所需的原始保證金）
 * - avoidLiquidation：波動後仍高於斷頭線
 * - avoidMarginCall：波動後仍不低於維持保證金
 * - gap：距離 avoidLiquidation 還差多少（≤ 0 表示已足夠）
 */
export function requiredDeposit(input, settings, shock) {
  const { contract, entry, qty, deposit } = input;
  const t = thresholds(contract, qty, settings);
  const loss = entry * shock * t.multiplier * qty;
  const avoidLiquidation = Math.max(loss + t.liquidation, t.initial);
  return {
    loss,
    avoidLiquidation,
    avoidMarginCall: Math.max(loss + t.maintenance, t.initial),
    gap: avoidLiquidation - deposit,
  };
}

export const GRID_STATUS = {
  OK: 'ok',
  NO_MARGIN: 'noMargin',
  LIQUIDATED: 'liquidated',
  INVALID_PRICE: 'invalidPrice',
};

/**
 * 網格加碼階梯：做多時每跌 spacing 點加碼 qtyPerLevel 口，做空時每漲 spacing 點加碼。
 * 第一格即起始價開倉。遇到價格 ≤ 0、先被斷頭或保證金不足無法加碼時，推入一列停止原因後結束。
 */
export function gridLadder(input, settings) {
  const { contract, side, start, spacing, qtyPerLevel, levels, deposit } = input;
  const { multiplier } = CONTRACTS[contract];

  const rows = [];
  let qty = 0;
  let cost = 0; // Σ 價格 × 口數
  for (let i = 0; i < levels; i += 1) {
    const level = i + 1;
    const price = start - direction(side) * spacing * i;
    if (!(price > 0)) {
      rows.push({ level, price, status: GRID_STATUS.INVALID_PRICE });
      break;
    }

    const avgBefore = qty > 0 ? cost / qty : price;
    const equity = deposit - adverse(side, avgBefore, price) * multiplier * qty;

    if (qty > 0) {
      const t = thresholds(contract, qty, settings);
      const liqBefore = priceAtEquity({ side, avg: avgBefore, qty, deposit, multiplier }, t.liquidation);
      if (adverse(side, liqBefore, price) >= 0) {
        rows.push({ level, price, status: GRID_STATUS.LIQUIDATED, liquidationPrice: liqBefore });
        break;
      }
    }

    const next = thresholds(contract, qty + qtyPerLevel, settings);
    if (equity < next.initial) {
      rows.push({ level, price, equity, status: GRID_STATUS.NO_MARGIN, required: next.initial });
      break;
    }

    qty += qtyPerLevel;
    cost += price * qtyPerLevel;
    const avg = cost / qty;
    const pos = { side, avg, qty, deposit, multiplier };
    const liquidationPrice = priceAtEquity(pos, next.liquidation);
    const buffer = adverse(side, price, liquidationPrice) / price;
    rows.push({
      level,
      price,
      status: GRID_STATUS.OK,
      qty,
      avg,
      equity,
      leverage: (price * multiplier * qty) / equity,
      riskRatio: equity / next.initial,
      marginCallPrice: priceAtEquity(pos, next.maintenance),
      liquidationPrice,
      buffer,
      zone: zoneOf(buffer),
    });
  }
  return rows;
}
