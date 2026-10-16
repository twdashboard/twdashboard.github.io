// 臺股指數期貨契約規格與保證金預設值。
// 保證金來源：臺灣期貨交易所「股價指數類保證金一覽表」，期交所會不定期調整，使用者可於設定中修改。

export const CONTRACTS = {
  TX: { code: 'TX', name: '臺股期貨（大台 TX）', short: '大台', multiplier: 200 },
  MTX: { code: 'MTX', name: '小型臺指（小台 MTX）', short: '小台', multiplier: 50 },
  TMF: { code: 'TMF', name: '微型臺指（微台 TMF）', short: '微台', multiplier: 10 },
};

export const CONTRACT_CODES = Object.keys(CONTRACTS);

export const DEFAULT_MARGINS = {
  TX: { initial: 701000, maintenance: 538000 },
  MTX: { initial: 175250, maintenance: 134500 },
  TMF: { initial: 35050, maintenance: 26900 },
};

export const DEFAULT_MARGIN_DATE = '2026-08-12';

// 盤中風險指標低於此比例時，期貨商得代為沖銷（斷頭）
export const DEFAULT_LIQUIDATION_RATIO = 0.25;

// 「要扛多大波動」反推保證金的選項；臺股期貨單日漲跌幅上限為 10%
export const SHOCK_OPTIONS = [0.05, 0.10, 0.15, 0.20];
export const DEFAULT_SHOCK = 0.10;

// 儀表盤分區：以「距斷頭還能扛幾 % 的反向波動」定義，與槓桿倍數一一對應
export const BUFFER_ZONES = [
  { min: 0.20, key: 'safe', label: '保守' },
  { min: 0.10, key: 'steady', label: '穩健' },
  { min: 0.05, key: 'aggressive', label: '積極' },
  { min: -Infinity, key: 'danger', label: '危險' },
];
