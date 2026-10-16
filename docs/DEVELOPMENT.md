# 開發慣例

台指期風控儀表盤。純靜態、零相依、不用建置工具；變更紀錄見 `docs/CHANGELOG.md`。

## 架構與模組職責

| 檔案 | 職責 |
| --- | --- |
| `js/contracts.js` | 契約規格（乘數）、`DEFAULT_MARGINS`、`DEFAULT_MARGIN_DATE`、稅率、代沖銷比例、壓力測試幅度 |
| `js/risk.js` | 風控計算，純函式：不碰 DOM、不碰儲存、不修改輸入（回傳新物件） |
| `js/store.js` | 預設 state、`normalize` 驗證、localStorage 讀寫、JSON 匯出入 |
| `js/chart.js` | 權益曲線，手寫 SVG |
| `js/app.js` | UI 渲染與事件；不放計算邏輯 |

計算一律寫在 `risk.js` 並補測試，不要寫進 `app.js`。

## 資料模型

localStorage key：`twdashboard.state.v1`，`version: 1`。

```
{
  version, account: { balance },
  settings: { margins: {TX|MTX|TMF: {initial, maintenance}}, marginDate,
              feePerSide: {code: 元/口/邊}, taxRate, liquidationRatio },
  positions: [{ id, contract, side: 'long'|'short', qty, entry, price }],
  equityHistory: [{ date: 'YYYY-MM-DD', equity }],   // 同日唯一、依日期排序
  trades: [{ date, contract, side, qty, entry, exit, gross, cost, net }]
}
```

## 計算規則

- 權益數 = 帳戶餘額 + 未實現損益；風險指標 = 權益數 ÷ 原始保證金。
- 狀態：風險指標 ≤ `liquidationRatio`（預設 25%）→ 代沖銷；權益數 < 維持保證金 → 追繳（代沖銷優先判斷）。
- 距門檻點數 = (門檻 − 權益) ÷ 每點損益；已低於門檻回傳 0，無部位或淨部位為零回傳 null。
- 壓力測試：損益 = 每點損益 × 現價 × 幅度，保證金不隨價格變動。
- 平倉：只扣平倉邊手續費 + 期交稅（契約金額 × `taxRate`，四捨五入）；建倉成本視為已反映在餘額。
- 不計跨月價差保證金減收。

## 資安規則

- `index.html` 的 CSP：`default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`。禁止 inline script/style、`style=` 屬性、外部資源；確實需要時須同步修改 CSP。
- `store.normalize` 是唯一的資料入口（載入與匯入皆經過），做白名單驗證：`side` 限 long/short、`contract` 限已知代碼、date 符合 `YYYY-MM-DD`、`qty` 正整數、價格為有限正數、原始 ≥ 維持保證金，不合法的列直接丟棄。新增欄位必須同步補驗證。
- 插入 `innerHTML` 的字串一律用 `esc()` 跳脫；`side` 等會進 class 的值在渲染時再走白名單。新增模板時不得直接插值未跳脫字串。
- 不接任何券商 API、不放金鑰、不發對外請求。

## UI 慣例

- 紅漲綠跌（台股慣例）：`--up` 紅、`--down` 綠；同時以 +／− 號與文字標示，不只靠顏色。
- 顏色與尺寸用 `css/style.css` 的 CSS token（`:root` 變數），深色在 `@media (prefers-color-scheme: dark)` 覆寫同名 token，不寫死色碼。
- 手機版輸入框 font-size 須 16px，避免 iOS 自動放大。
- 無障礙：可操作元素須能用鍵盤操作；持倉列按鈕的 aria-label 要含契約、方向、口數與成本以區分各列。
- 重繪：`commit(next)` 只重繪資料區；設定表單只在整份取代 state 時（儲存設定、還原、匯入、清除）經 `replaceState` 重繪，避免蓋掉輸入中的內容。

## 測試

```bash
node --test 'tests/**/*.test.mjs'
```

- Node 內建 test runner（Node 22）；`node --test tests/` 在 Node 22 無法執行。
- 目前 104 個案例，涵蓋 `contracts`、`risk`、`store`。
- `app.js`、`chart.js` 無自動化測試；改動後以 headless Chromium 做手動 smoke test。
- CI：`.github/workflows/test.yml`（push main 與 PR）。

## 保證金更新流程

期交所（https://www.taifex.com.tw/cht/5/indexMarging）調整保證金時：

1. 修改 `js/contracts.js` 的 `DEFAULT_MARGINS` 與 `DEFAULT_MARGIN_DATE`。
2. 同步更新測試中引用預設值的斷言，跑全部測試。
3. 更新 `README.md` 的保證金表，並在 `docs/CHANGELOG.md` 記一筆。

已存入使用者瀏覽器的設定不會被覆寫，使用者須到設定按「還原預設」或手動修改。

## 部署

GitHub Pages 從 `twdashboard/twdashboard.github.io` 的 `main` 分支根目錄部署，網址 https://twdashboard.github.io/ 。無建置步驟，push main 即上線。

本機預覽：`python3 -m http.server` 後開 http://localhost:8000 ，不可用 `file://`。
