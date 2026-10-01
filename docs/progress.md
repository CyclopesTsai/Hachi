# Hachi 開發進度與決策紀錄

> **給接手的 Claude Code session**：開始工作前請先讀完本檔與 `CLAUDE.md`。
> 每完成一個 Phase（或做出新的設計決策）都要更新本檔，並與程式碼一起 commit。

## 目前狀態

- **目前階段**：Phase 0 已完成並經使用者確認，**下一步是 Phase 1**（尚未開始）
- **最後更新**：2026-10-01

## Phase 進度

| Phase | 內容                                                                                                | 狀態      |
| ----- | --------------------------------------------------------------------------------------------------- | --------- |
| 0     | 專案骨架、視窗、原生選單、安全設定、首次啟動引導、app-config.json、docs 初版                        | ✅ 完成   |
| 1     | Workspace 切換 + Collection / 資料夾 / 請求樹狀（新增、重新命名、複製、刪除、拖曳排序），含檔案監聽 | ⏳ 下一步 |
| 2     | HTTP 編輯器與回應檢視器                                                                             | —         |
| 3     | 環境變數、多分頁、歷史紀錄                                                                          | —         |
| 4     | WebSocket 完整功能                                                                                  | —         |
| 5     | 匯入匯出、程式碼產生、腳本與斷言、Collection Runner、全域搜尋                                       | —         |
| 6     | 視窗狀態記憶、深色模式、快捷鍵整理、打包 macOS dmg                                                  | —         |

### Phase 0 完成內容

- Electron 44 + electron-vite 5（Vite 7）+ React 19 + TypeScript 6.0 strict + Tailwind 4 + shadcn/ui + Zustand + zod
- 安全：`contextIsolation`、`sandbox`、無 `nodeIntegration`；`window.hachi` 白名單 API；IPC 檢查 sender 並以 zod 驗證輸入；CSP；禁止新視窗、外部導覽、`<webview>`，權限請求預設拒絕
- 原生選單（Hachi / File / Edit / View / Window），平台差異集中在 `src/main/platform/`
- `app-config.json`：有版本欄位與遷移機制、原子寫入、檔案損毀時自動備份並重建
- 首次啟動引導：建立或開啟 Workspace、最近開啟清單、啟動時自動開回上次的 Workspace
- 文件：`docs/ipc.md`、`docs/schema.md`、README、LICENSE、THIRD_PARTY_NOTICES.md

**驗證方式**：`npm run verify`（型別檢查、ESLint、Prettier、62 個單元測試、授權檢查）；`xvfb-run -a npm run test:e2e`（以 Playwright 實際啟動 App，跑 9 項冒煙檢查）。macOS 尚未實機測試。

## 決策紀錄（已與使用者確認）

| #   | 決策          | 內容                                                                                                                                            |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 機密變數存放  | 存在 `<workspace>/.hachi-secrets.json`（已列入 .gitignore）；環境檔中 secret 的 value 一律留空。之後若接 Keychain，會作為可切換的另一種存放後端 |
| 2   | 請求檔名      | 用名稱的 slug 當檔名（保留中文），檔案內另存 `id`；重新命名時一併改檔名                                                                         |
| 3   | history.json  | 預設加入 .gitignore；只存未替換變數的原始請求與回應摘要（狀態碼、耗時、大小），不存回應 Body                                                    |
| 4   | UI / 狀態管理 | shadcn/ui（Radix + Tailwind）、Zustand、CodeMirror 6（Phase 2 起）、lucide 圖示                                                                 |
| 5   | 授權          | 專案採 MIT。只能使用寬鬆授權的相依套件，以 `npm run check:licenses` 檢查。複製進專案的第三方程式碼需記錄在 THIRD_PARTY_NOTICES.md               |
| 6   | 版權人        | `Hachi contributors`（不要填 Cyclopes）                                                                                                         |
| 7   | Bundle ID     | 暫用 `tw.com.cyclopes.hachi`，集中在 `src/shared/app-info.json`，使用者之後會換成正式的                                                         |
| 8   | Git 流程      | 直接 commit 並 push 到 `main`，不另開分支                                                                                                       |
| 9   | 工作流程      | 每個 Phase 完成後先實際執行驗證，簡述做了什麼與如何驗證，**等使用者確認再進下一階段**；不確定的設計決策先問使用者                               |
| 10  | 語言          | App 介面用繁體中文；原生選單依規格用英文                                                                                                        |
| 11  | 套件版本      | TypeScript 用 6.0（typescript-eslint 尚未支援 7）；Vite 用 7（electron-vite 5 只支援到 7）                                                      |

## 下一步：Phase 1 待確認事項

開始實作前要先向使用者說明規劃並確認，包括：

- Collection、資料夾、請求的 JSON 格式（`docs/schema.md` 的草案）定案
- 複製時的命名規則（例如「xxx copy」）與同名衝突的處理方式
- 刪除時要移到系統垃圾桶（`shell.trashItem`）還是永久刪除
- 檔案監聽（chokidar）偵測到外部修改時，UI 如何同步

## 開發環境注意事項

- 雲端容器透過 proxy 連網時，Electron 的 postinstall 可能下載失敗。這時可以用 curl 下載 `electron-v<版本>-linux-x64.zip`，解壓到 `node_modules/electron/dist`，並寫入 `node_modules/electron/path.txt`（內容為 `electron`）
- 在 Linux 上以 root 執行 E2E 測試時需加 `--no-sandbox`（`scripts/smoke-e2e.mjs` 已自動處理）
