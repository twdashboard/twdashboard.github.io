// 狀態持久化：只存在使用者瀏覽器的 localStorage，不會上傳到任何地方。
// 載入的資料一律經過 normalize 白名單驗證，不合法的欄位以預設值取代。

import {
  CONTRACT_CODES,
  DEFAULT_MARGINS,
  DEFAULT_MARGIN_DATE,
  DEFAULT_LIQUIDATION_RATIO,
  SHOCK_OPTIONS,
  DEFAULT_SHOCK,
} from './contracts.js';
import { isPos, isPosInt, isDate, isValidMargin, isValidRatio, LIMITS } from './validate.js';

const SCHEMA_VERSION = 2;
const STORAGE_KEY = `twdashboard.state.v${SCHEMA_VERSION}`;

export function defaultSettings() {
  return {
    margins: structuredClone(DEFAULT_MARGINS),
    marginDate: DEFAULT_MARGIN_DATE,
    liquidationRatio: DEFAULT_LIQUIDATION_RATIO,
    colorScheme: 'redUp',
  };
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    calc: { contract: 'TMF', side: 'long', entry: 47100, deposit: 75000, qty: 1, shock: DEFAULT_SHOCK },
    grid: { contract: 'TMF', side: 'long', start: 47100, spacing: 500, qtyPerLevel: 1, levels: 6, deposit: 150000 },
    settings: defaultSettings(),
  };
}

const isSide = (v) => v === 'long' || v === 'short';
const isContract = (v) => CONTRACT_CODES.includes(v);

/** 依規則逐欄挑選合法值，其餘沿用預設 */
function pick(raw, base, rules) {
  const out = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, valid] of Object.entries(rules)) {
    if (valid(raw[key])) out[key] = raw[key];
  }
  return out;
}

/** 把任意輸入整理成合法 state */
export function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const calc = pick(raw.calc, base.calc, {
    contract: isContract,
    side: isSide,
    entry: isPos,
    deposit: isPos,
    qty: (v) => isPosInt(v, LIMITS.maxQty),
    shock: (v) => SHOCK_OPTIONS.includes(v),
  });

  const grid = pick(raw.grid, base.grid, {
    contract: isContract,
    side: isSide,
    start: isPos,
    spacing: isPos,
    qtyPerLevel: (v) => isPosInt(v, LIMITS.maxQty),
    levels: (v) => isPosInt(v, LIMITS.maxLevels),
    deposit: isPos,
  });

  const settings = pick(raw.settings, base.settings, {
    marginDate: isDate,
    liquidationRatio: isValidRatio,
    colorScheme: (v) => v === 'redUp' || v === 'greenUp',
  });
  settings.margins = structuredClone(DEFAULT_MARGINS);
  for (const code of CONTRACT_CODES) {
    const m = raw.settings?.margins?.[code];
    if (isValidMargin(m)) settings.margins[code] = { initial: m.initial, maintenance: m.maintenance };
  }

  return { version: SCHEMA_VERSION, calc, grid, settings };
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
