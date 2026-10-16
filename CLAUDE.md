# twdashboard

台指期（TX/MTX/TMF）爆倉價格與網格加碼試算器，純靜態 HTML/CSS/JS（ES modules、零相依），由 GitHub Actions 部署到 GitHub Pages：https://twdashboard.github.io/

@docs/DEVELOPMENT.md

- 變更紀錄：`docs/CHANGELOG.md`
- 測試：`node --test 'tests/**/*.test.mjs'`（Node 22；`node --test tests/` 在 Node 22 無法執行）
- 本機預覽：`python3 -m http.server`，不可用 `file://` 直接開（ES modules 會被 CORS 擋）；要測行情可先跑 `node scripts/fetch-quote.mjs quote.json`（已 gitignore）
- 公開 repo，commit 一律用 repo 層級的匿名身分 `twdashboard <twdashboard@users.noreply.github.com>`
