// 風控計算核心：純函式，不碰 DOM 與儲存，方便單元測試。
// 金額單位一律為新臺幣元，價格單位為指數點。

import { CONTRACTS, TX_MULTIPLIER, STRESS_SHOCKS } from './contracts.js';

export const STATUS = {
  FLAT: 'flat',
  OK: 'ok',
  MARGIN_CALL: 'marginCall',
  LIQUIDATION: 'liquidation',
};

const direction = (side) => (side === 'short' ? -1 : 1);
const multiplierOf = (contract) => CONTRACTS[contract].multiplier;
const ratio = (equity, initial) => (initial > 0 ? equity / initial : null);

/** 依日期字串（YYYY-MM-DD）排序的比較器 */
export const byDate = (a, b) => a.date.localeCompare(b.date);

/** 部位每變動 1 點的損益（含方向） */
export function pointValue(pos) {
  return direction(pos.side) * pos.qty * multiplierOf(pos.contract);
}

/** 單一部位的未實現損益 */
export function unrealizedPnl(pos) {
  return (pos.price - pos.entry) * pointValue(pos);
}

/** 部位所需保證金 */
export function marginRequirement(positions, margins) {
  let initial = 0;
  let maintenance = 0;
  for (const pos of positions) {
    initial += pos.qty * margins[pos.contract].initial;
    maintenance += pos.qty * margins[pos.contract].maintenance;
  }
  return { initial, maintenance };
}

/**
 * 依權益數與保證金判斷帳戶狀態。
 * 盤中風險指標 ≤ 代沖銷比例 → 代沖銷；權益數 < 維持保證金 → 追繳。
 */
export function classify(equity, initial, maintenance, liquidationRatio) {
  if (initial === 0) return STATUS.FLAT;
  if (ratio(equity, initial) <= liquidationRatio) return STATUS.LIQUIDATION;
  if (equity < maintenance) return STATUS.MARGIN_CALL;
  return STATUS.OK;
}

/**
 * 指數需同向變動多少點，權益數才會到達 target。
 * 回傳帶正負號的點數（負數代表指數下跌）；淨部位為零時回傳 null。
 * 無部位或淨部位為零（到不了 target）時回傳 null；已低於 target 時回傳 0。
 */
function pointsToThreshold(equity, target, perPoint, initial) {
  if (initial === 0) return null;
  if (equity <= target) return 0;
  if (perPoint === 0) return null;
  return (target - equity) / perPoint;
}

/** 帳戶整體風控摘要 */
export function computeSummary(state) {
  const { positions, settings } = state;
  const unrealized = positions.reduce((sum, p) => sum + unrealizedPnl(p), 0);
  const equity = state.account.balance + unrealized;
  const { initial, maintenance } = marginRequirement(positions, settings.margins);
  const perPoint = positions.reduce((sum, p) => sum + pointValue(p), 0);
  const liquidationLevel = initial * settings.liquidationRatio;

  let grossNotional = 0;
  let netNotional = 0;
  for (const p of positions) {
    const notional = p.qty * multiplierOf(p.contract) * p.price;
    grossNotional += notional;
    netNotional += direction(p.side) * notional;
  }

  return {
    unrealized,
    equity,
    initialMargin: initial,
    maintenanceMargin: maintenance,
    riskRatio: ratio(equity, initial),
    excessMargin: equity - initial,
    perPoint,
    pointsToMarginCall: pointsToThreshold(equity, maintenance, perPoint, initial),
    pointsToLiquidation: pointsToThreshold(equity, liquidationLevel, perPoint, initial),
    grossNotional,
    netNotional,
    netTxEquivalent: perPoint / TX_MULTIPLIER,
    grossLeverage: equity > 0 ? grossNotional / equity : null,
    netLeverage: equity > 0 ? Math.abs(netNotional) / equity : null,
    status: classify(equity, initial, maintenance, settings.liquidationRatio),
  };
}

/** 指數同步變動各百分比時的情境結果（保證金依口數計，不隨價格變動） */
export function stressTest(state, shocks = STRESS_SHOCKS) {
  const base = computeSummary(state);
  return shocks.map((shock) => {
    const pnl = state.positions.reduce((sum, p) => sum + pointValue(p) * p.price * shock, 0);
    const equity = base.equity + pnl;
    return {
      shock,
      pnl,
      equity,
      riskRatio: ratio(equity, base.initialMargin),
      status: classify(equity, base.initialMargin, base.maintenanceMargin, state.settings.liquidationRatio),
    };
  });
}

/** 單邊交易成本：手續費 + 期交稅（四捨五入至元） */
export function tradeCost(contract, qty, price, settings) {
  const fee = settings.feePerSide[contract] * qty;
  const tax = Math.round(price * multiplierOf(contract) * qty * settings.taxRate);
  return fee + tax;
}

/**
 * 平倉部分或全部口數，回傳新的 state（不修改原物件）。
 * 只扣平倉這一邊的手續費與期交稅；建倉成本視為已反映在帳戶餘額。
 */
export function closePosition(state, positionId, qty, exitPrice, date) {
  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos) throw new Error('找不到部位');
  if (!Number.isInteger(qty) || qty <= 0 || qty > pos.qty) throw new Error('平倉口數不正確');
  if (!(exitPrice > 0)) throw new Error('平倉價格不正確');

  const gross = (exitPrice - pos.entry) * pointValue({ ...pos, qty });
  const cost = tradeCost(pos.contract, qty, exitPrice, state.settings);
  const net = gross - cost;

  const positions = qty === pos.qty
    ? state.positions.filter((p) => p.id !== positionId)
    : state.positions.map((p) => (p.id === positionId ? { ...p, qty: p.qty - qty } : p));

  const trade = {
    date,
    contract: pos.contract,
    side: pos.side,
    qty,
    entry: pos.entry,
    exit: exitPrice,
    gross,
    cost,
    net,
  };

  return {
    ...state,
    account: { ...state.account, balance: state.account.balance + net },
    positions,
    trades: [...state.trades, trade],
  };
}

/** 依權益紀錄計算最大回撤與目前回撤 */
export function drawdown(history) {
  const sorted = [...history].sort(byDate);
  const result = {
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    peakDate: null,
    troughDate: null,
    currentDrawdown: 0,
    currentDrawdownPct: 0,
  };
  if (sorted.length === 0) return result;

  let peak = sorted[0];
  for (const point of sorted) {
    if (point.equity > peak.equity) peak = point;
    const dd = peak.equity - point.equity;
    if (dd > result.maxDrawdown) {
      result.maxDrawdown = dd;
      result.maxDrawdownPct = peak.equity > 0 ? dd / peak.equity : 0;
      result.peakDate = peak.date;
      result.troughDate = point.date;
    }
  }
  const last = sorted[sorted.length - 1];
  result.currentDrawdown = peak.equity - last.equity;
  result.currentDrawdownPct = peak.equity > 0 ? result.currentDrawdown / peak.equity : 0;
  return result;
}

/** 新增或覆蓋同一天的權益紀錄，依日期排序 */
export function upsertEquity(history, date, equity) {
  return [...history.filter((h) => h.date !== date), { date, equity }]
    .sort(byDate);
}
