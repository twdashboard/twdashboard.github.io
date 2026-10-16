# 開發慣例

台指期單一部位爆倉價格試算器。純靜態、零相依、不用建置工具；變更紀錄見 `docs/CHANGELOG.md`。

## 架構與模組職責

| 檔案 | 職責 |
| --- | --- |
| `js/contracts.js` | 契約規格（乘數）、`DEFAULT_MARGINS`、`DEFAULT_MARGIN_DATE`、代沖銷比例、`SHOCK_OPTIONS`、`BUFFER_ZONES` |
| `js/calc.js` | 純函式：`positionMetrics`、`requiredDeposit`、`gridLadder`、`zoneOf`、`leverageForBuffer`、`GRID_STATUS` |
| `js/validate.js` | 共用驗證：`isNum`／`isPos`／`isPosInt`／`isDate`／`isValidMargin`／`isValidRatio`、`LIMITS`（`maxQty` 999、`maxLevels` 50） |
| `js/store.js` | 預設 state、`normalize` 白名單、localStorage 讀寫 |
| `js/quote.js` | `loadQuote`（視 `quote.json` 為不可信）、`quoteHintText`（純函式） |
| `js/gauge.js` | 手寫 SVG 槓桿半圓儀表 |
| `js/app.js` | 只負責 DOM 與事件 |
| `scripts/fetch-quote.mjs` | 抓期交所近月報價寫成 `quote.json` |

- 所有風控判斷（`canOpen`、`belowMaintenance`、`liquidated`、`neverLiquidates`、`gap`）寫在 `calc.js` 並補測試，不要寫進 `app.js`。
- `app.js` 以 `FORMS` 設定驅動 calc／grid 共用的 `syncForm`／`bindForm`／`update`；新增表單欄位改設定，不複製邏輯。
- `renderAll` 只在整份取代設定時呼叫，避免覆寫輸入中的設定表單。
- 只用 `textContent`／DOM API，不使用 `innerHTML`。

## 資料模型

localStorage key `twdashboard.state.v2`（`version: 2`）。v1 不相容、不遷移。

```
{
  version: 2,
  calc: { contract, side: 'long'|'short', entry, deposit, qty, shock },
  grid: { contract, side, start, spacing, qtyPerLevel, levels, deposit },
  settings: { margins: {TX|MTX|TMF: {initial, maintenance}}, marginDate,
              liquidationRatio, colorScheme: 'redUp'|'greenUp' }
}
```

`normalize` 逐欄白名單挑選，非法欄位回預設值；新增欄位須同步補規則與測試。

## 計算規則

- 權益數 X 滿足 `X = 存入保證金 + 方向 × (X − 均價) × 乘數 × 口數`。
- 斷頭：權益 ≤ 原始保證金 × 口數 × `liquidationRatio`（預設 25%）；追繳：權益 < 維持保證金 × 口數。
- 距斷頭緩衝 = 不利點數 ÷ 開倉價；分區 ≥ 20% 保守、≥ 10% 穩健、≥ 5% 積極、其餘危險。
- 扛 shock 所需保證金 = 開倉價 × shock × 乘數 × 口數 + 斷頭線（或維持保證金），不低於原始保證金。
- 網格：價格 ≤ 0、先被斷頭、權益 < 加碼後原始保證金即停止，並回傳原因。
- 不計手續費、期交稅、跨月價差減收。

## 資安規則

- CSP：`default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'`。JS 以 CSSOM 設定 `element.style` 不受影響，但不可加 inline `style` 屬性、inline script 或外部資源；確實需要時須同步修改 CSP。
- `quote.json` 視為不可信，`loadQuote` 只保留通過驗證的欄位。
- Workflow：workflow 層級只有 `contents: read`，`pages`／`id-token` 只給 deploy job；actions 釘 commit SHA（checkout v4.4.0、setup-node v4.4.0、upload-pages-artifact v3.0.1、deploy-pages v4.0.5），dependabot 每月升版；checkout `persist-credentials: false`；找不到測試檔時 CI 失敗。
- 不接券商 API、不放金鑰。

## UI 與 CSS 慣例

- 分區色每區只定義一次 `--zc`（`.zone-safe` 等），`.zone-text`／`.zone-pill`／`.zone-bg`／`.gauge-zone`／圖例／表格共用。
- 斷頭相關數字固定用 `--zone-danger`，不跟漲跌配色（綠色看起來像安全）。
- 配色切換鈕刻意用固定 `--red`／`--green`；深色模式紅綠底上用深色字 `--on-signal`。
- 顏色用 CSS token，深色在 `@media (prefers-color-scheme: dark)` 覆寫；淺色文字色須維持 WCAG 4.5:1。
- 手機輸入框 font-size 16px（避免 iOS 放大）；注意橫向安全區（`viewport-fit=cover`）。
- 輸入錯誤除紅框外要有文字說明。

## 行情抓取

- 期交所 MIS API（`mis.taifex.com.tw/futures/api/getQuoteList`）不允許瀏覽器跨域，由 `deploy.yml` 排程執行 `scripts/fetch-quote.mjs _site/quote.json`，隨網站部署，不 commit 回 repo。
- 排程 UTC cron：`*/10 0-5`、`*/10 7-20`、`0 21`（週一至五）；push main 與 `workflow_dispatch` 也會跑。
- 近月以月份碼 A–L 加年份末碼自行算到期年月排序，不依賴 API 順序（注意跨十年）。
- 日夜盤：MIS `MarketType '0'` 為日盤、`'1'` 為夜盤（代號尾碼 `-M`，如 `TMFJ6-M`；月契約正規式 `-[FM]$`）。`sessionOrder(now)` 依臺灣時間決定順序：08:45–14:59 先抓日盤，其餘先抓夜盤；優先盤別失敗（無價格、找不到近月等）改抓另一盤別並輸出 warning。
- 單一商品失敗仍寫其他商品；全部失敗時沿用線上舊 `quote.json` 並輸出 warning。
- 限制：排程延遲 10–30 分鐘；runner 在海外，可能被期交所擋（尚待驗證）；公開 repo 60 天無 commit 排程會被停用。
- 限制：新 repo 推上 workflow 後約 4 小時內排程一次都沒觸發（2026-10-16 實測，僅 push 那次有跑）；GitHub schedule 在新 repo／低活動 repo 可能延遲很久或被略過，必要時手動 `gh workflow run deploy.yml`。

## 測試

```bash
node --test 'tests/**/*.test.mjs'
```

- Node 22 內建 test runner；`node --test tests/` 在 Node 22 無法執行。
- 125 個案例：calc 55、store 28、validate 7、quote 19、fetch-quote 16。
- `app.js`、`gauge.js` 以 headless Chromium 手動 smoke test。
- CI：`deploy.yml`（push main／排程／手動，測試通過才部署）、`test.yml`（PR）。

## 保證金更新流程

期交所（https://www.taifex.com.tw/cht/5/indexMarging）調整時：

1. 改 `js/contracts.js` 的 `DEFAULT_MARGINS` 與 `DEFAULT_MARGIN_DATE`。
2. 同步測試與 `README.md` 保證金表，並在 `docs/CHANGELOG.md` 記一筆。

已存在使用者瀏覽器的合法設定不會被覆寫。

## 部署與提交

- Pages 來源為 GitHub Actions；本機預覽 `python3 -m http.server`（不可用 `file://`），要測行情先 `node scripts/fetch-quote.mjs quote.json`（已 gitignore）。
- commit 一律用 repo 層級匿名身分 `twdashboard <twdashboard@users.noreply.github.com>`。
