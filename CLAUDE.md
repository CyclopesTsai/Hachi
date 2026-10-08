# Hachi — 給 Claude Code 的工作說明

Hachi 是類似 Postman / Bruno 的桌面 API 測試工具（HTTP + WebSocket），Electron + electron-vite + React + TypeScript（strict）+ Tailwind + shadcn/ui + Zustand。原規格的 Phase 0–6 已完成，目前版本見 `README.md` / `docs/progress.md`（macOS、Windows）。原始規格全文在 git 歷史中（`git show 1c7c257:CLAUDE.md`），之後的設計決策優先於原規格。

## 開始工作前

- 先讀 **`docs/progress.md`**：目前狀態、已確認的設計決策（編號 1 起，程式註解中的「decision N」指的就是它）、Roadmap、開發環境注意事項。
- 再讀 `README.md`（指令、打包、發佈）與需要的 `docs/ipc.md`、`docs/schema.md`。

## 工作流程

- 新功能或新階段：先說明規劃、把不確定的設計決策問清楚，**等使用者確認再實作**；不要自行假設。
- 完成後實際執行驗證（`npm run verify`、`npm run test:e2e`），簡述做了什麼與如何驗證，等使用者確認。
- 做出新決策或完成工作時更新 `docs/progress.md`，與程式碼一起 commit。
- IPC 或 JSON 格式有變動時同步更新 `docs/ipc.md` 與 `docs/schema.md`。
- 改動已推送的 tag、強制推送等不可逆的 git 操作前，先問使用者。
- 跑 E2E 前先告訴使用者：會跳出 Hachi 視窗、可能搶焦點。
- App 介面用繁體中文，原生選單用英文（決策 10）。

## 硬性規則

- main / preload / renderer 分離；`contextIsolation`、`sandbox` 開啟，`nodeIntegration` 關閉。renderer 只能用 preload 的 `window.hachi` 白名單 API；IPC 輸入一律以 zod 驗證（`src/shared/ipc/contract.ts`）。
- HTTP、WebSocket、腳本（QuickJS，在 utilityProcess）都在 main 端執行。
- 無登入、無資料庫：資料都是 JSON 檔，每個檔案都有 `version` 欄位；寫檔一律原子寫入（暫存檔 → rename，`src/main/services/fs/atomic-write.ts`）。
- 跨平台：路徑用 `path`、快捷鍵用 `CmdOrCtrl`、設定放 `app.getPath('userData')`；平台專屬程式碼集中在 `src/main/platform/`。
- App 識別（名稱、Bundle ID）集中在 `src/shared/app-info.json`。
- 授權 AGPL-3.0-or-later；隨 App 發佈的相依套件只能是寬鬆授權（`npm run check:licenses`）；複製進來的第三方程式碼記錄在 `THIRD_PARTY_NOTICES.md`。
- 快捷鍵刻意很少（決策 21、43、48–51、96）：新增任何快捷鍵都要先經使用者同意，E2E 會檢查選單只剩允許的快捷鍵。
- 重要模組要有單元測試；程式碼風格 ESLint + Prettier。

## 常用指令

```bash
npm install          # postinstall 會下載 Electron 執行檔（Electron 44 起需要 install-electron）
npm run dev          # 開發模式
npm run verify       # 型別檢查、ESLint、Prettier、單元測試、授權檢查
npm run test:e2e     # 建置後以 Playwright 跑冒煙測試（SMOKE_APP_PATH=打包後的 App、SMOKE_COLOR_SCHEME=dark）
npm run dist:mac     # 打包 arm64 與 x64 dmg（未簽章）
npm run dist:win     # 打包 Windows 安裝程式與免安裝版（x64，在 Windows 上；平常交給 GitHub Actions）
```

發佈：改 `package.json` 版本 → commit → 推 `v<版本>` tag，GitHub Actions（`.github/workflows/release.yml`）會打包、測試並發佈 Release。

## 容易踩到的地方

- 系統 Node 需要 22.19+（undici 8）。
- Zustand selector 不能每次回傳新物件（例如 `new Set(...)`），否則會無限重繪；需要時用 `useMemo`。
- 顏色一律用 `src/renderer/src/styles.css` 的 token（Nord 配色，淺色 / 深色兩組），包含 CodeMirror 語法顏色（`--code-*`）與圖表色（`--chart-*`）；改完要用深色跑一次 E2E 截圖檢查。
- GitHub Actions 的 macOS 機器螢幕只有 1024×768、速度也比本機慢；E2E / 單元測試不要寫死超過螢幕的大小或太緊的時間。
- E2E 不讀寫系統剪貼簿、不使用系統垃圾桶（已在測試中替換）。
