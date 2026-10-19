// 期交所公告保證金：讀取隨網站部署的 margins.json（GitHub Actions 從期交所開放資料抓取），
// 並決定使用者的保證金設定要自動跟上官方值，還是保留自訂值並提示差異。

import { CONTRACT_CODES, DEFAULT_MARGINS } from './contracts.js';
import { isDate, isValidMargin } from './validate.js';

// 官方值相對內建值的合理範圍；超出視為資料異常，避免 API 回錯資料直接改掉所有人的爆倉價
const MIN_FACTOR = 0.3;
const MAX_FACTOR = 3;

/** 三檔商品都有合法保證金的完整表格 */
export function isMarginTable(t) {
  return Boolean(t) && typeof t === 'object' && CONTRACT_CODES.every((code) => isValidMargin(t[code]));
}

export function cloneMargins(t) {
  return Object.fromEntries(CONTRACT_CODES.map((code) => [code, { initial: t[code].initial, maintenance: t[code].maintenance }]));
}

export function sameMargins(a, b) {
  return CONTRACT_CODES.every((code) =>
    a?.[code]?.initial === b?.[code]?.initial && a?.[code]?.maintenance === b?.[code]?.maintenance);
}

const inRange = (v, base) => v >= base * MIN_FACTOR && v <= base * MAX_FACTOR;

/**
 * margins.json 視為不可信：三檔都合法且落在內建值合理範圍內才採用，否則整份丟棄回傳 null
 * （不混用不同來源的保證金）。回傳 { date, margins }。
 */
export function sanitizeOfficial(raw) {
  if (!isDate(raw?.date) || !isMarginTable(raw?.margins)) return null;
  const ok = CONTRACT_CODES.every((code) => {
    const m = raw.margins[code];
    const base = DEFAULT_MARGINS[code];
    return inRange(m.initial, base.initial) && inRange(m.maintenance, base.maintenance);
  });
  return ok ? { date: raw.date, margins: cloneMargins(raw.margins) } : null;
}

export async function loadOfficialMargins() {
  try {
    const res = await fetch(`margins.json?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? sanitizeOfficial(await res.json()) : null;
  } catch {
    return null;
  }
}

/** reconcileMargins 的結果狀態 */
export const MARGIN_STATUS = {
  UNAVAILABLE: 'unavailable', // 沒有可用的官方值，維持原設定
  CURRENT: 'current', // 設定已與官方值相同
  APPLIED: 'applied', // 跟隨官方模式，官方值有變，已自動套用
  DIFFERS: 'differs', // 自訂模式，與官方值不同，應提示
  DISMISSED: 'dismissed', // 自訂模式，這組官方值已選擇保留自訂
};

/** 依官方值調整設定；回傳 { settings, status }，settings 未變動時回傳原物件 */
export function reconcileMargins(settings, official) {
  if (!official) return { settings, status: MARGIN_STATUS.UNAVAILABLE };
  const following = settings.marginsSource === 'official';
  if (sameMargins(settings.margins, official.margins)) {
    const next = following && settings.marginDate !== official.date ? { ...settings, marginDate: official.date } : settings;
    return { settings: next, status: MARGIN_STATUS.CURRENT };
  }
  if (following) {
    return {
      settings: { ...settings, margins: cloneMargins(official.margins), marginDate: official.date, dismissedOfficial: null },
      status: MARGIN_STATUS.APPLIED,
    };
  }
  const dismissed = sameMargins(settings.dismissedOfficial, official.margins);
  return { settings, status: dismissed ? MARGIN_STATUS.DISMISSED : MARGIN_STATUS.DIFFERS };
}

/** 套用官方值（或官方不可用時的內建值），改為跟隨官方模式 */
export function followOfficial(settings, official, fallbackDate) {
  return {
    ...settings,
    margins: cloneMargins(official?.margins ?? DEFAULT_MARGINS),
    marginDate: official?.date ?? fallbackDate,
    marginsSource: 'official',
    dismissedOfficial: null,
  };
}

/**
 * 儲存設定表單時判斷保證金來源：數字沒改就沿用原來源；
 * 有改則與官方值（不可用時與內建值）相同才算跟隨官方，否則為自訂。
 */
export function sourceAfterEdit(prev, margins, official) {
  if (sameMargins(margins, prev.margins)) return prev.marginsSource;
  return sameMargins(margins, official?.margins ?? DEFAULT_MARGINS) ? 'official' : 'custom';
}
