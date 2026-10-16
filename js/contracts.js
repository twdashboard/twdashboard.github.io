// 臺股指數期貨契約規格與保證金預設值。
// 保證金來源：臺灣期貨交易所「股價指數類保證金一覽表」，期交所會不定期調整，使用者可於設定中修改。

export const CONTRACTS = {
  TX: { code: 'TX', name: '臺股期貨（大台）', multiplier: 200 },
  MTX: { code: 'MTX', name: '小型臺指（小台）', multiplier: 50 },
  TMF: { code: 'TMF', name: '微型臺指（微台）', multiplier: 10 },
};

export const CONTRACT_CODES = Object.keys(CONTRACTS);

// 換算「大台口數」時的基準乘數
export const TX_MULTIPLIER = CONTRACTS.TX.multiplier;

export const DEFAULT_MARGINS = {
  TX: { initial: 701000, maintenance: 538000 },
  MTX: { initial: 175250, maintenance: 134500 },
  TMF: { initial: 35050, maintenance: 26900 },
};

export const DEFAULT_MARGIN_DATE = '2026-08-12';

// 期貨交易稅：契約金額 × 十萬分之 2（每邊）
export const DEFAULT_TAX_RATE = 0.00002;

// 盤中風險指標低於此比例時，期貨商得代為沖銷
export const DEFAULT_LIQUIDATION_RATIO = 0.25;

// 壓力測試的指數變動幅度；±10% 為臺股期貨漲跌停
export const STRESS_SHOCKS = [-0.10, -0.07, -0.05, -0.03, -0.01, 0.01, 0.03, 0.05, 0.07, 0.10];
