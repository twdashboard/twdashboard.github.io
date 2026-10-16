# Changelog

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

## [0.1.0] - 2026-10-16

首次版本。

### 新增

- 台指期（TX 乘數 200、MTX 50、TMF 10）風控儀表盤，純靜態 HTML/CSS/JS（ES modules）。
- KPI：權益數、未實現損益、風險指標、原始／維持保證金、超額保證金、距追繳點數、距代沖銷點數、淨部位換算大台口數、淨／總槓桿。
- 持倉表（行內改現價、平倉 dialog、刪除）與一鍵套用現價。
- 情境壓力測試 ±1/3/5/7/10%（10% 為漲跌停）。
- 權益曲線（手寫 SVG）、最大回撤／目前回撤（需每日手動「記錄權益」）。
- 平倉紀錄。
- 設定：保證金、手續費、期交稅率、代沖銷門檻、還原預設。
- JSON 匯出／匯入備份；資料只存 localStorage（`twdashboard.state.v1`）。
- 深淺色主題自動跟隨系統、手機版排版。
- 保證金預設值取自期交所 2026/08/12 更新：TX 701,000／538,000；MTX 175,250／134,500；TMF 35,050／26,900（原始／維持）。
- 單元測試 104 個案例（Node 內建 test runner）與 GitHub Actions CI（push main、PR）。

### 關鍵決策與原因

1. 純手動、純靜態：GitHub Pages 無法保管 API 密鑰，開源專案不接券商 API，避免金鑰外洩風險，任何人 fork 即可使用。
2. 零相依、不用建置工具：降低維護與供應鏈風險；圖表手寫 SVG。
3. `risk.js` 為純函式（不碰 DOM 與儲存、回傳新物件），可直接用 Node 測試；`app.js` 只負責 UI。
4. 資安：`store.normalize` 對匯入／載入資料做白名單驗證（side、contract、date 格式、qty 正整數、原始 ≥ 維持保證金），因部分欄位會插入 innerHTML；`app.js` 渲染時 side 同樣用白名單；`index.html` 設 CSP（`default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'none'`…），不可加 inline script/style 或外部資源，否則須同步調整 CSP。
5. `commit` 只重繪資料區；設定表單僅在整份取代 state（儲存設定、還原、匯入、清除）時經 `replaceState` 重繪，避免蓋掉使用者輸入中的內容。
6. 計算取捨：不計跨月價差減收（保守高估）；建倉手續費不扣；平倉只扣平倉邊手續費 + 期交稅。

### 修正（審查後）

- XSS：`trade.side` 未驗證即插入 HTML。
- 淨部位為零且已跌破門檻時，距追繳點數顯示錯誤。
- 匯入權益紀錄未排序去重。
- 維持保證金大於原始保證金可經匯入繞過驗證。
- 匯入按鈕無法以鍵盤操作。
- iOS 輸入框自動放大。
- 持倉列 aria-label 無法區分各列。
- `trade.qty` 未驗證。

### 新增檔案

- `index.html`、`css/style.css`
- `js/contracts.js`、`js/risk.js`、`js/store.js`、`js/chart.js`、`js/app.js`
- `tests/contracts.test.mjs`、`tests/risk.test.mjs`、`tests/store.test.mjs`
- `.github/workflows/test.yml`
- `README.md`、`CLAUDE.md`、`LICENSE`（MIT）、`docs/CHANGELOG.md`、`docs/DEVELOPMENT.md`

### 已知限制

- DOM 相關的 `app.js`、`chart.js` 無自動化測試，以 headless Chromium 手動 smoke test 驗證。
- `node --test tests/` 在 Node 22 無法執行，須用 `node --test 'tests/**/*.test.mjs'`。
