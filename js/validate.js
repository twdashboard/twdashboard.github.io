// 共用的輸入驗證：store（localStorage）、quote（quote.json）與設定表單都用同一套規則。

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isPos = (v) => isNum(v) && v > 0;
export const isPosInt = (v, max = Infinity) => Number.isInteger(v) && v > 0 && v <= max;
export const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 保證金需為正數，且原始保證金不低於維持保證金 */
export const isValidMargin = (m) => Boolean(m) && isPos(m.maintenance) && isNum(m.initial) && m.initial >= m.maintenance;

/** 代沖銷門檻：介於 0 與 1 之間（不含端點） */
export const isValidRatio = (v) => isNum(v) && v > 0 && v < 1;

export const LIMITS = {
  maxQty: 999,
  maxLevels: 50,
};
