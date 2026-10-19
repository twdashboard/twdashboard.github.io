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
| `js/margins.js` | `sanitizeOfficial`／`loadOfficialMargins`（視 `margins.json` 為不可信）、`reconcileMargins`、`followOfficial`、`sourceAfterEdit`（純函式） |
| `js/gauge.js` | 手寫 SVG 槓桿半圓儀表 |
| `js/app.js` | 只負責 DOM 與事件 |
| `scripts/fetch-quote.mjs` | 抓期交所近月報價寫成 `quote.json` |
| `scripts/fetch-margins.mjs` | 抓期交所開放資料保證金寫成 `margins.json` |

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
              marginsSource: 'official'|'custom', dismissedOfficial: 三檔表|null,
              liquidationRatio, colorScheme: 'redUp'|'greenUp' }
}
```

- `marginsSource` 為 `official` 時自動跟隨 `margins.json`；`custom` 時官方值變動只提示。`dismissedOfficial` 記「保留我的設定」的那組官方值，同一組不再提示。兩欄不升 schema；舊資料缺 `marginsSource` 時，`margins` 等於 `DEFAULT_MARGINS` 視為 `official`，否則 `custom`。

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
- `margins.json` 同樣不可信：`sanitizeOfficial` 要求三檔都合法且各值落在 `DEFAULT_MARGINS` 的 0.3–3 倍，否則整份丟棄，不混用來源。
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
- 主要觸發：外部 cron-job.org 每 10 分鐘 `POST https://api.github.com/repos/twdashboard/twdashboard.github.io/actions/workflows/deploy.yml/dispatches`，body `{"ref":"main"}`。使用 fine-grained PAT（僅此 repo、Actions: Read and write、設到期日），存在 cron-job.org，不進 repo；到期前須重新產生並更新 cron-job.org 的 header。PAT 失效則行情停更，只剩 GitHub schedule 備援。
- 備援排程 UTC cron：`*/10 0-5`、`*/10 7-20`、`0 21`（週一至五）；push main 與 `workflow_dispatch` 也會跑。
- 夜盤 `CDate` 是開盤日：`toIsoTime(date, time, marketType)` 對夜盤 `CTime` < 150000 的時間，日期 +1 天（含跨月），否則跨午夜成交會少算一天。例：`TMFJ6-M` `CDate=20261016`、`CTime=045959` → 2026-10-17 04:59:59。
- 近月以月份碼 A–L 加年份末碼自行算到期年月排序，不依賴 API 順序（注意跨十年）。
- 日夜盤：MIS `MarketType '0'` 為日盤、`'1'` 為夜盤（代號尾碼 `-M`，如 `TMFJ6-M`；月契約正規式 `-[FM]$`）。`sessionOrder(now)` 依臺灣時間決定順序：08:45–14:59 先抓日盤，其餘先抓夜盤；優先盤別失敗（無價格、找不到近月等）改抓另一盤別並輸出 warning。
- 單一商品失敗仍寫其他商品；全部失敗時沿用線上舊 `quote.json` 並輸出 warning。
- `margins.json` 與 `quote.json` 同一個 workflow 產生：`deploy.yml` 每次部署（含外部 cron 觸發）執行 `scripts/fetch-margins.mjs _site/margins.json`，不 commit（已 gitignore）。失敗不寫檔，workflow 沿用線上舊檔。
- 限制：外部觸發後行情延遲約 10–15 分鐘（抓取加部署約 1–2 分鐘）；runner 在海外，可能被期交所擋（尚待驗證）；公開 repo 60 天無 commit 排程會被停用。
- 限制：GitHub schedule 在低活動 repo 嚴重節流（2026-10-16 實測：新 repo 推上後約 4 小時沒觸發；週五間隔 1–3 小時；週六 07:11 台灣時間後到週一 09:39 一次都沒跑），因此只當備援，必要時手動 `gh workflow run deploy.yml`。
- 決策：不做瀏覽器即時抓取。MIS 對跨域 preflight 回 403、`text/plain` 回 415；Yahoo 台灣股市內部 API 無 CORS 標頭且有條款與非公開介面問題；即時需 Cloudflare Worker 代理，不採用。

## 測試

```bash
node --test 'tests/**/*.test.mjs'
```

- Node 22 內建 test runner；`node --test tests/` 在 Node 22 無法執行。
- 129 個案例：calc 55、store 28、validate 7、quote 19、fetch-quote 20。
- `app.js`、`gauge.js` 以 headless Chromium 手動 smoke test。
- CI：`deploy.yml`（push main／排程／手動，測試通過才部署）、`test.yml`（PR）。

## 保證金更新流程

以自動抓取為主：`scripts/fetch-margins.mjs` 讀期交所開放資料 API `https://openapi.taifex.com.tw/v1/IndexFuturesAndOptionsMargining`，商品名稱完全相符對應 臺股期貨→TX、小型臺指→MTX、微型臺指期貨→TMF（排除「客製化小型臺指期貨」），欄位須為字串。`margins.json` 格式：`{fetchedAt, source:'TAIFEX OpenAPI', date:'YYYY-MM-DD', margins:{TX|MTX|TMF:{initial,maintenance}}}`。API 的 `Date` 是資料發布日，不是生效日，不推算生效日。

- `official` 使用者：官方值變動自動套用並提示一次，日期欄位停用、顯示官方資料日。
- `custom` 使用者：只提示，可「套用官方值」或「保留我的設定」；保留後同一組官方值不再提示。
- `margins.json` 載入失敗時，`official` 使用者沿用已存值，不退回內建值。
- 「還原預設值」等同套用官方值。

`DEFAULT_MARGINS` 為備援（新使用者、`margins.json` 不可用時），也是範圍檢查與 CI 比對基準。官方值與內建值不同時 CI 輸出 `::warning::`，此時手動：

1. 改 `js/contracts.js` 的 `DEFAULT_MARGINS` 與 `DEFAULT_MARGIN_DATE`（來源：https://www.taifex.com.tw/cht/5/indexMarging）。
2. 同步測試與 `README.md` 保證金表，並在 `docs/CHANGELOG.md` 記一筆。

已存在使用者瀏覽器的合法設定不會被覆寫（`official` 依官方值更新除外）。

## 部署與提交

- Pages 來源為 GitHub Actions；本機預覽 `python3 -m http.server`（不可用 `file://`），要測行情先 `node scripts/fetch-quote.mjs quote.json`（已 gitignore）。
- commit 一律用 repo 層級匿名身分 `twdashboard <twdashboard@users.noreply.github.com>`。
