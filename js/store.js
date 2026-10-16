// 狀態持久化：只存在使用者瀏覽器的 localStorage，不會上傳到任何地方。

import {
  CONTRACT_CODES,
  DEFAULT_MARGINS,
  DEFAULT_MARGIN_DATE,
  DEFAULT_TAX_RATE,
  DEFAULT_LIQUIDATION_RATIO,
} from './contracts.js';
import { byDate } from './risk.js';

const STORAGE_KEY = 'twdashboard.state.v1';
const SCHEMA_VERSION = 1;

export function defaultSettings() {
  return {
    margins: structuredClone(DEFAULT_MARGINS),
    marginDate: DEFAULT_MARGIN_DATE,
    feePerSide: Object.fromEntries(CONTRACT_CODES.map((c) => [c, 0])),
    taxRate: DEFAULT_TAX_RATE,
    liquidationRatio: DEFAULT_LIQUIDATION_RATIO,
  };
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    account: { balance: 0 },
    settings: defaultSettings(),
    positions: [],
    equityHistory: [],
    trades: [],
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const nonNeg = (v) => isNum(v) && v >= 0;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
// side 會被插進 HTML class，必須白名單驗證
const isSide = (v) => v === 'long' || v === 'short';

function validPosition(p) {
  return p && typeof p.id === 'string' && CONTRACT_CODES.includes(p.contract)
    && isSide(p.side)
    && Number.isInteger(p.qty) && p.qty > 0
    && isNum(p.entry) && p.entry > 0 && isNum(p.price) && p.price > 0;
}

function validTrade(t) {
  return t && isDate(t.date) && CONTRACT_CODES.includes(t.contract) && isSide(t.side)
    && Number.isInteger(t.qty) && t.qty > 0
    && ['entry', 'exit', 'gross', 'cost', 'net'].every((k) => isNum(t[k]));
}

/** 同一天保留最後一筆，依日期排序 */
function dedupeByDate(history) {
  const map = new Map(history.map((h) => [h.date, { date: h.date, equity: h.equity }]));
  return [...map.values()].sort(byDate);
}

/** 把任意輸入整理成合法 state；不合法的欄位以預設值補上，不合法的列直接丟棄 */
export function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const s = raw.settings ?? {};
  const settings = base.settings;
  for (const code of CONTRACT_CODES) {
    const m = s.margins?.[code];
    if (m && isNum(m.initial) && isNum(m.maintenance) && m.maintenance > 0 && m.initial >= m.maintenance) {
      settings.margins[code] = { initial: m.initial, maintenance: m.maintenance };
    }
    if (nonNeg(s.feePerSide?.[code])) settings.feePerSide[code] = s.feePerSide[code];
  }
  if (isDate(s.marginDate)) settings.marginDate = s.marginDate;
  if (nonNeg(s.taxRate)) settings.taxRate = s.taxRate;
  if (nonNeg(s.liquidationRatio) && s.liquidationRatio < 1) {
    settings.liquidationRatio = s.liquidationRatio;
  }

  return {
    version: SCHEMA_VERSION,
    account: { balance: isNum(raw.account?.balance) ? raw.account.balance : 0 },
    settings,
    positions: Array.isArray(raw.positions) ? raw.positions.filter(validPosition) : [],
    equityHistory: Array.isArray(raw.equityHistory)
      ? dedupeByDate(raw.equityHistory.filter((h) => h && isDate(h.date) && isNum(h.equity)))
      : [],
    trades: Array.isArray(raw.trades) ? raw.trades.filter(validTrade) : [],
  };
}

export function load() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? normalize(JSON.parse(text)) : defaultState();
  } catch {
    return defaultState();
  }
}

/** 回傳是否寫入成功（隱私模式或停用儲存時會失敗） */
export function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function exportJson(state) {
  return JSON.stringify(state, null, 2);
}

/** 解析匯入檔；JSON 格式錯誤時丟出例外 */
export function importJson(text) {
  return normalize(JSON.parse(text));
}

export function newId() {
  return crypto.randomUUID();
}
