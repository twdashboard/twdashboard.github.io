# twdashboard

台指期（TX／MTX／TMF）單一部位爆倉價格試算器，手機 App 風格。輸入商品、方向、開倉價、存入保證金與口數，立即得到槓桿、斷頭價、追繳價與「要扛多大波動需存多少保證金」。

- 線上使用：https://twdashboard.github.io/
- 支援商品：大台 TX（每點 200 元）、小台 MTX（每點 50 元）、微台 TMF（每點 10 元）
- 純靜態 HTML/CSS/JS（ES modules），零相依、不用建置；行情由 GitHub Actions 抓取（外部 cron 每 10 分鐘觸發），瀏覽器不對外連線

## 設計理念

不是先決定開幾口，再看風險指標有沒有掉到 25%，而是反過來：先決定能扛多大的波動（例如 10%），再反推該存多少保證金。

- 原始保證金與維持保證金之間的空間很薄，只看「有沒有被追繳」會低估風險。
- 風險指標 25% 是期貨商風控／後台代沖銷的門檻，不是交易者該拿來管理部位的指標。
- 因此本工具以「距斷頭還有幾 % 的反向波動」為核心，並依此分區與畫儀表。

## 功能

三個分頁（網址 hash：`#calc`、`#grid`、`#rules`）。手機為底部分頁、單欄；螢幕 ≥ 900px 時分頁移到頁首、左右兩欄，≥ 1100px 時結果區再分兩欄。

### ① 爆倉價格計算

- 輸入：商品、做多／做空、開倉價（±10 點、可抓取行情）、存入保證金（1／3／5 倍原始保證金快捷鈕）、口數（±、1／2／5／10 口快捷鈕）。
- 槓桿半圓儀表：上限為當下最大槓桿（開倉價 × 乘數 ÷ 原始保證金），不是固定 18 倍。
- 分區（依距斷頭緩衝）：≥ 20% 保守、≥ 10% 穩健、≥ 5% 積極、< 5% 危險。
- 斷頭價、距斷頭 % 與點數、盤後追繳價、開倉風險指標量表。
- 「要扛多大的波動」：5／10／15／20% 反推所需保證金（不被斷頭、不被追繳）與差額。
- 契約與部位明細。

### ② 網格倉位階梯

- 輸入：起始價、間距、每格口數、格數（≤ 50）、保證金。做多每跌一格加碼，做空每漲一格加碼。
- 逐格顯示均價、累計口數、槓桿、風險指標、追繳價、斷頭價、距斷頭。
- 遇到下列任一情況即停止並說明原因：價格 ≤ 0、先被斷頭、保證金不足（權益 < 加碼後全部口數的原始保證金）。

### ③ 風控法規公式

- 說明為什麼不看 25%、計算公式、期交所與期貨商規則。
- 保證金設定：可改原始／維持保證金、資料日期、代沖銷門檻；頁面上的門檻與範例數字隨設定即時更新。

### 其他

- 紅漲／綠漲配色可切換；斷頭相關數字固定用危險色，不隨漲跌配色。
- 深淺色跟隨系統；淺色模式文字對比皆達 WCAG 4.5:1。

## 計算方式

權益數 X 滿足：`X = 存入保證金 + 方向 × (X − 均價) × 乘數 × 口數`（以下 X 指指數價位）。

| 項目 | 規則 |
| --- | --- |
| 斷頭 | 權益數 ≤ 原始保證金 × 口數 × 代沖銷比例（預設 25%，盤中風險指標） |
| 追繳 | 權益數 < 維持保證金 × 口數（盤後） |
| 風險指標（開倉） | 存入保證金 ÷（原始保證金 × 口數） |
| 槓桿 | 契約價值（開倉價 × 乘數 × 口數）÷ 存入保證金 |
| 距斷頭緩衝 | 斷頭價相對開倉價的不利點數 ÷ 開倉價 |
| 扛 N% 波動所需保證金 | 開倉價 × N% × 乘數 × 口數 + 斷頭線（或維持保證金），且不低於原始保證金 |

驗證範例（與參考網站截圖一致）：TMF 做多 1 口、開倉價 47,100、存入 75,000 → 槓桿 6.28、斷頭價 40,476、距斷頭 −14.06%（6,624 點）、追繳價 42,290、風險指標 214%、最大可承受虧損 66,238、扛 15% 需 79,413。

保證金預設值取自[期交所保證金一覽表](https://www.taifex.com.tw/cht/5/indexMarging)（2026/08/12）：

| 契約 | 原始保證金 | 維持保證金 |
| --- | ---: | ---: |
| TX | 701,000 | 538,000 |
| MTX | 175,250 | 134,500 |
| TMF | 35,050 | 26,900 |

保證金會自動跟隨期交所：部署時從期交所開放資料 API 抓取寫成 `margins.json`（`scripts/fetch-margins.mjs`，不 commit），前端預設跟隨官方值，變動時自動套用並提示一次，日期顯示的是官方資料發布日。你也可以在「③ 風控法規公式」頁自行修改，改成自訂後官方值變動只會提示，可選「套用官方值」或「保留我的設定」；「還原預設值」會套用官方值。`margins.json` 抓不到或內容異常（不是三檔都合法、數值偏離內建值 0.3–3 倍）時沿用已存值或內建值。上表為內建備援值，官方值與之不同時由 CI warning 提醒手動更新。

## 行情

- 期交所 MIS API 不允許瀏覽器跨域，所以由 GitHub Actions（`deploy.yml`）執行 `scripts/fetch-quote.mjs`，抓三商品近月報價寫成 `quote.json`，連同網站部署到 GitHub Pages（不 commit 回 repo）。
- 更新機制：外部 cron-job.org 每 10 分鐘呼叫 GitHub API `workflow_dispatch` 觸發 `deploy.yml`；GitHub 內建 `schedule` 在低活動 repo 會被嚴重節流，僅保留作備援。
- 夜盤跨午夜的成交時間已修正為隔天日期（MIS 夜盤 `CDate` 是開盤日）。
- 近月由月份碼（A–L）加年份末碼自行換算到期年月後排序，不依賴 API 回傳順序。
- 單一商品失敗仍會寫入其他商品；全部失敗時沿用線上舊的 `quote.json` 並輸出 warning。
- 前端顯示資料時間，超過 30 分鐘標示「N 分鐘前」。

限制：

- 行情約延遲 10–15 分鐘（觸發後抓取加部署約 1–2 分鐘），不是即時報價，請以看盤軟體為準。
- 依賴外部 cron 服務與有期限的 GitHub token；token 失效則行情停止更新（僅剩 GitHub 排程備援）。
- GitHub runner 在海外，期交所可能擋海外 IP（尚待實際驗證）。
- 公開 repo 連續 60 天沒有 commit，排程會被 GitHub 自動停用。

## 已知限制與免責聲明

- 不計手續費、期交稅、跨月價差保證金減收。
- 期貨商可能收取高於期交所的保證金，風險指標算法也可能不同；實際追繳與代沖銷以你的期貨商為準。
- 內建保證金預設值可能落後於期交所最新公告；自動更新依賴 `margins.json`，抓取失敗時不會更新。
- 本工具僅為試算輔助，不構成投資建議；使用者須自行承擔交易與依賴試算結果的風險。

## 隱私

設定與輸入只存在你瀏覽器的 localStorage（key：`twdashboard.state.v2`），不會上傳。唯一的對外請求是讀取同網站的 `quote.json` 與 `margins.json`（CSP `connect-src 'self'`）。v0.1.0 使用的 `v1` 資料格式不相容，舊資料不會遷移。

## 本機開發與測試

```bash
python3 -m http.server                  # 然後開 http://localhost:8000
node scripts/fetch-quote.mjs quote.json # 要測行情時先產生（已 gitignore）
node --test 'tests/**/*.test.mjs'
```

- 不可用 `file://` 開啟，ES modules 會被 CORS 擋住。
- 測試使用 Node 內建 test runner（Node 22）；`node --test tests/` 在 Node 22 無法執行，請用上述 glob 寫法。
- 目前 195 個案例（calc 55、store 38、validate 7、quote 19、fetch-quote 20、margins 39、fetch-margins 17）。`app.js`、`gauge.js` 涉及 DOM，以 headless Chromium 手動 smoke test 驗證。
- 慣例與架構細節見 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，變更紀錄見 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

## 專案結構

```
index.html                頁面骨架與 CSP
css/style.css             樣式（CSS token、分區色、深淺色、響應式）
js/contracts.js           契約規格、保證金預設值、分區定義
js/calc.js                風控計算（純函式）
js/validate.js            共用輸入驗證
js/store.js               狀態預設值、normalize、localStorage
js/quote.js               讀取 quote.json、行情說明文字
js/margins.js             讀取 margins.json、官方保證金對帳與套用（純函式）
js/gauge.js               槓桿半圓儀表（SVG）
js/app.js                 UI 與事件處理
scripts/fetch-quote.mjs   抓期交所行情寫成 quote.json
scripts/fetch-margins.mjs 抓期交所保證金寫成 margins.json
tests/*.test.mjs          單元測試
.github/workflows/        deploy.yml（測試、抓行情與保證金、部署）、test.yml（PR 測試）
.github/dependabot.yml    每月升級釘 SHA 的 actions
docs/                     DEVELOPMENT.md、CHANGELOG.md
```

## 授權

[MIT](LICENSE)
