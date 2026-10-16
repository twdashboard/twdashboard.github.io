# twdashboard

台指期（TX/MTX/TMF）風控儀表盤，純靜態 HTML/CSS/JS（ES modules、零相依），部署於 GitHub Pages：https://twdashboard.github.io/

@docs/DEVELOPMENT.md

- 變更紀錄：`docs/CHANGELOG.md`
- 測試：`node --test 'tests/**/*.test.mjs'`（Node 22；`node --test tests/` 在 Node 22 無法執行）
- 本機預覽：`python3 -m http.server`，不可用 `file://` 直接開（ES modules 會被 CORS 擋）
