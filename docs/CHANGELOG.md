# Changelog

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

## [0.2.2] - 2026-10-19

修正夜盤行情時間少算一天，並改以外部 cron 觸發行情更新（GitHub schedule 嚴重節流）。

### 修正

- `scripts/fetch-quote.mjs` 的 `toIsoTime(date, time, marketType)`：MIS 夜盤的 `CDate` 是開盤日，跨午夜（`CTime` < 150000）的成交實際發生在隔天，原本直接拼接導致時間少一天。例：週五夜盤於週六 04:59:59 收盤，被顯示成週五 04:59，網頁顯示「3 天前」而非「2 天前」。現在夜盤 15:00 前的時間日期 +1 天（含跨月）。2026-10-19 直接查 MIS 確認 `TMFJ6-M` 的 `CDate=20261016`、`CTime=045959`。`toIsoTime` 改為 export 以便測試。

### 變更

- 行情更新改由外部 cron-job.org 每 10 分鐘呼叫 GitHub API `workflow_dispatch` 觸發 `deploy.yml`（`POST /repos/twdashboard/twdashboard.github.io/actions/workflows/deploy.yml/dispatches`，body `{"ref":"main"}`）。使用 fine-grained PAT：僅限此 repo、Actions: Read and write、設有到期日，存在 cron-job.org，須定期更換。GitHub `schedule` 保留作備援。預期延遲約 10–15 分鐘（觸發後抓取加部署約 1–2 分鐘）。
- `index.html` 頁尾改為「行情每 10 分鐘自動抓取一次，約延遲 10–15 分鐘，不是即時報價，請以看盤軟體為準。」；`deploy.yml` 註解同步。
- 測試新增 4 個 `toIsoTime` 案例，總數 125 → 129，fetch-quote 16 → 20（calc 55、store 28、validate 7、quote 19）。
- 修改檔案：`scripts/fetch-quote.mjs`、`tests/fetch-quote.test.mjs`、`index.html`、`.github/workflows/deploy.yml`、`README.md`、`docs/DEVELOPMENT.md`。

### 關鍵決策與原因

1. 外部觸發取代 GitHub schedule：低活動 repo 的 schedule 被嚴重節流。2026-10-16（週五）排程間隔 1–3 小時；週六 07:11（台灣）後到週一 09:39 一次都沒跑，網頁行情停在三天前。
2. 不做瀏覽器即時抓取：實測 MIS 對跨域 preflight 回 403、`text/plain` 請求回 415；Yahoo 台灣股市內部 API 無 `Access-Control-Allow-Origin`，也需代理，且有 Yahoo 服務條款與非公開介面的問題。即時行情需 Cloudflare Worker 代理；使用者接受 15 分鐘延遲故不採用，同時降低即時行情轉載的授權疑慮。

### 已知限制

- 依賴外部服務 cron-job.org 與 PAT；PAT 過期或被撤銷則行情停止更新（僅剩 GitHub schedule 備援），須在到期前更換。
- 行情仍是延遲約 10–15 分鐘的參考價，不是即時報價。

## [0.2.1] - 2026-10-16

修正夜盤時段行情停在日盤收盤價，以及試算頁快捷設定按鈕不顯示選中狀態的問題。

### 修正

- `scripts/fetch-quote.mjs` 寫死 MIS `MarketType: '0'`（日盤），夜盤時段（15:00–05:00）抓到的永遠是日盤 13:45 收盤價，網頁顯示的行情時間停在日盤。
- 試算頁「保證金快捷設定」（1／3／5 倍）與「口數快捷設定」（1／2／5／10 口）按鈕點了不會顯示選中狀態：CSS 已有 `.presets button[aria-pressed="true"]` 樣式，但 `js/app.js` 只對波動幅度按鈕設 `aria-pressed`。改在 `renderCalc` 依目前數值推得選中狀態：口數等於按鈕值即亮；存入保證金等於 N × 原始保證金 × 口數即亮。因此手動輸入剛好相符時也會亮，改了口數而保證金沒跟著改時倍數鈕會熄滅（表示保證金已不是該倍數）。修改檔案：`js/app.js`。以 headless Chromium 驗證。

### 變更

- MIS `MarketType '1'` 為夜盤，代號尾碼為 `-M`（如 `TMFJ6-M`）。月契約正規式由 `-F$` 改為 `-[FM]$`。
- 新增純函式 `sessionOrder(now)`：依臺灣時間 08:45–14:59 先抓日盤、其餘先抓夜盤。優先盤別失敗（無價格、找不到近月等）時改抓另一盤別並輸出 warning。
- 測試新增 3 個案例（`-M` 代號解析、`sessionOrder` 日盤時段、夜盤時段），總數 122 → 125，fetch-quote 13 → 16。
- 修改檔案：`scripts/fetch-quote.mjs`、`tests/fetch-quote.test.mjs`。

### 已知限制

- 新 repo 推上 workflow 後約 4 小時內 GitHub 排程一次都沒觸發（2026-10-16 實測，僅 push 那次有跑）。GitHub schedule 在新 repo／低活動 repo 可能延遲很久或被略過；必要時手動 `gh workflow run deploy.yml`。

## [0.2.0] - 2026-10-16

改版為單一部位爆倉價格試算器。v0.1.0 做成多部位帳戶管理儀表盤，不符合需求；本版以「從能扛多大的波動反推該存多少保證金」為核心，改為手機 App 風格。

### 新增

- 三個分頁（hash 路由 `#calc`／`#grid`／`#rules`）：手機底部分頁單欄；≥ 900px 分頁移到頁首、左右兩欄；≥ 1100px 結果區再分兩欄。
- ① 爆倉價格計算：商品（TX／MTX／TMF）、做多／做空、開倉價（±10 點、可抓行情）、存入保證金（1／3／5 倍原始保證金快捷鈕）、口數（±、1／2／5／10 口）。輸出槓桿半圓儀表（上限為當下最大槓桿，非固定 18 倍）、分區（距斷頭緩衝 ≥ 20% 保守、≥ 10% 穩健、≥ 5% 積極、< 5% 危險）、斷頭價、距斷頭 % 與點數、盤後追繳價、開倉風險指標量表、「要扛多大的波動」5／10／15／20% 反推保證金（不被斷頭／不被追繳）與差額、契約與部位明細。
- ② 網格倉位階梯：起始價、間距、每格口數、格數（≤ 50）、保證金；逐格均價、累計口數、槓桿、風險指標、追繳價、斷頭價、距斷頭。遇到價格 ≤ 0、先被斷頭、保證金不足（權益 < 加碼後全部口數原始保證金）即停止並說明。
- ③ 風控法規公式：為什麼不看 25%、公式、期交所與期貨商規則、保證金設定（可改原始／維持保證金、資料日期、代沖銷門檻），門檻與範例數字隨設定即時更新。
- 紅漲／綠漲配色切換；深淺色跟隨系統；淺色文字色皆達 WCAG 4.5:1。
- 行情：`.github/workflows/deploy.yml` 在交易時段每 10 分鐘（UTC cron `*/10 0-5`、`*/10 7-20`、`0 21`，週一至五）執行 `scripts/fetch-quote.mjs`，抓三商品近月報價寫成 `quote.json`，連同網站部署到 Pages。前端顯示資料時間，超過 30 分鐘標示「N 分鐘前」。
- `js/calc.js`、`js/validate.js`、`js/quote.js`、`js/gauge.js`、`scripts/fetch-quote.mjs`、`.github/workflows/deploy.yml`、`.github/dependabot.yml`。
- 測試 122 個案例（calc 55、store 28、validate 7、quote 19、fetch-quote 13）。
- 驗證：與參考網站截圖數字一致（TMF 多 1 口、47,100、存入 75,000 → 槓桿 6.28、斷頭價 40,476、距斷頭 −14.06%／6,624 點、追繳價 42,290、風險指標 214%、最大可承受虧損 66,238、扛 15% 需 79,413）。

### 變更

- 部署方式：Pages 來源改為 GitHub Actions（原為 main 分支根目錄），push main、排程、手動（`workflow_dispatch`）都會跑 `deploy.yml`；`test.yml` 改為只在 PR 執行。
- CSP `connect-src` 由 `'none'` 改為 `'self'`（讀取同站 `quote.json`）。
- 資料格式：localStorage key 改為 `twdashboard.state.v2`，與 v0.1.0 的 `v1` 不相容，舊資料不遷移。
- `store.normalize` 改為對 `calc`／`grid`／`settings` 逐欄白名單挑選，非法欄位回預設值。

### 移除

- v0.1.0 的多部位、情境壓力測試、權益曲線／回撤、平倉紀錄、JSON 匯出匯入、手續費與期交稅設定。
- `js/risk.js`、`js/chart.js` 刪除（由 `js/calc.js`、`js/gauge.js` 取代）。

### 關鍵決策與原因

1. 行情改由 Actions 抓取：期交所 MIS API（`mis.taifex.com.tw/futures/api/getQuoteList`）不允許瀏覽器跨域。Pages 部署 artifact，不 commit 回 repo，避免污染歷史與需要寫入權限。
2. 近月以月份碼 A–L 加年份末碼自行算到期年月排序，不依賴 API 回傳順序。單一商品失敗仍寫其他商品；全部失敗沿用線上舊 `quote.json` 並輸出 warning，避免行情失敗清掉可用的舊資料。
3. 風控判斷（`canOpen`、`belowMaintenance`、`liquidated`、`neverLiquidates`、`gap`）全放 `calc.js` 純函式，方便單元測試；`app.js` 只負責 DOM。
4. `app.js` 以 `FORMS` 設定驅動 calc／grid 共用的 `syncForm`／`bindForm`／`update`；`renderAll` 只在整份取代設定時呼叫，避免覆寫輸入中的設定表單；全部用 `textContent`／DOM API，不使用 `innerHTML`。
5. CSS：分區色每區只定義一次 `--zc`，各元件共用；斷頭相關數字固定用 `--zone-danger`，不跟漲跌配色（綠色看起來像安全）；配色切換鈕刻意用固定 `--red`／`--green`；深色模式紅綠底上用深色字 `--on-signal`。
6. Workflow 資安：workflow 層級只有 `contents: read`，`pages`／`id-token` 只給 deploy job；actions 釘 commit SHA（checkout v4.4.0、setup-node v4.4.0、upload-pages-artifact v3.0.1、deploy-pages v4.0.5）並由 dependabot 每月升版；checkout `persist-credentials: false`；找不到測試檔時 CI 失敗。
7. 保證金預設值維持期交所 2026/08/12：TX 701,000／538,000、MTX 175,250／134,500、TMF 35,050／26,900（原始／維持）。

### 修正（審查後）

- 網格價格 ≤ 0 時結論誤寫全部可執行。
- 法規頁的 25% 寫死，未隨設定更新。
- 行情抓取失敗會清掉線上舊行情。
- tests 目錄為空時 CI 假綠燈。
- 近月挑選依賴回傳順序，且跨十年年份推算錯誤。
- 存入保證金輸入的 step 錯誤。
- 淺色／深色模式對比不足。
- iOS 橫向時未處理安全區。
- 輸入錯誤只有紅框，無文字說明。
- 儀表刻度文字重疊。

### 已知限制

- 排程延遲 10–30 分鐘，行情只能當參考價。
- GitHub runner 在海外，期交所可能擋海外 IP（尚待實際驗證）。
- 公開 repo 連續 60 天無 commit，排程會被停用。
- 不計手續費、期交稅、跨月價差減收。
- 保證金預設值需手動更新。
- `app.js`、`gauge.js` 無自動化測試，以 headless Chromium 手動 smoke test 驗證。

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
