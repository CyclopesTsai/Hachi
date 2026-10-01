# Hachi 開發進度與決策紀錄

> **給接手的 Claude Code session**：開始工作前請先讀完本檔與 `CLAUDE.md`。
> 每完成一個 Phase（或做出新的設計決策）都要更新本檔，並與程式碼一起 commit。

## 目前狀態

- **目前階段**：Phase 1 已實作並驗證，**等待使用者確認**；確認後進入 Phase 2（HTTP 編輯器與回應檢視器）
- **最後更新**：2026-10-01

## Phase 進度

| Phase | 內容                                                                                                | 狀態      |
| ----- | --------------------------------------------------------------------------------------------------- | --------- |
| 0     | 專案骨架、視窗、原生選單、安全設定、首次啟動引導、app-config.json、docs 初版                        | ✅ 完成   |
| 1     | Workspace 切換 + Collection / 資料夾 / 請求樹狀（新增、重新命名、複製、刪除、拖曳排序），含檔案監聽 | 🟡 待確認 |
| 2     | HTTP 編輯器與回應檢視器                                                                             | ⏳ 下一步 |
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

### Phase 1 完成內容

- Workspace：重新命名（只改顯示名稱）、刪除（整個資料夾移到垃圾桶，需二次確認），入口在標題列的 Workspace 選單與歡迎畫面的最近清單
- `CollectionService`（main）：掃描 `collections/` 建立樹狀資料與 id → 路徑對照表；新增 / 重新命名 / 複製 / 刪除 / 移動；所有操作依序執行並使用原子寫入
- 檔案監聽：`WorkspaceWatcher`（chokidar），忽略 `.git` 與暫存檔，事件累積 200ms 後重新掃描；樹沒有變化時不推送
- 掃描容錯：自動接管手動建立的資料夾、修正重複的 id、損毀檔案以錯誤圖示顯示（只能刪除）
- UI：左側樹狀清單（右鍵選單、雙擊或 F2 改名、Delete 刪除、方向鍵展開收合）、`@dnd-kit` 拖曳（同層排序、拖進資料夾、懸停自動展開）、右側項目資訊面板（編輯器留待 Phase 2 / 4）
- 新 IPC：`tree:get`、`item:create|rename|duplicate|delete|move`、`workspace:rename|delete`；事件 `tree:changed`；錯誤碼 `NO_WORKSPACE`、`INVALID_OPERATION`
- 修正：檔名長度改以 UTF-8 位元組計算（上限 200），避免中文長名稱超過檔案系統限制

**驗證方式**：`npm run verify`（122 個單元測試）；`xvfb-run -a npm run test:e2e`（16 項冒煙檢查，包含在真正的 App 中拖曳、外部修改檔案、刪除到垃圾桶）。macOS 尚未實機測試。

## 決策紀錄（已與使用者確認）

| #   | 決策                | 內容                                                                                                                                            |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 機密變數存放        | 存在 `<workspace>/.hachi-secrets.json`（已列入 .gitignore）；環境檔中 secret 的 value 一律留空。之後若接 Keychain，會作為可切換的另一種存放後端 |
| 2   | 請求檔名            | 用名稱的 slug 當檔名（保留中文），檔案內另存 `id`；重新命名時一併改檔名                                                                         |
| 3   | history.json        | 預設加入 .gitignore；只存未替換變數的原始請求與回應摘要（狀態碼、耗時、大小），不存回應 Body                                                    |
| 4   | UI / 狀態管理       | shadcn/ui（Radix + Tailwind）、Zustand、CodeMirror 6（Phase 2 起）、lucide 圖示                                                                 |
| 5   | 授權                | 專案採 MIT。只能使用寬鬆授權的相依套件，以 `npm run check:licenses` 檢查。複製進專案的第三方程式碼需記錄在 THIRD_PARTY_NOTICES.md               |
| 6   | 版權人              | `Hachi contributors`（不要填 Cyclopes）                                                                                                         |
| 7   | Bundle ID           | 暫用 `tw.com.cyclopes.hachi`，集中在 `src/shared/app-info.json`，使用者之後會換成正式的                                                         |
| 8   | Git 流程            | 直接 commit 並 push 到 `main`，不另開分支                                                                                                       |
| 9   | 工作流程            | 每個 Phase 完成後先實際執行驗證，簡述做了什麼與如何驗證，**等使用者確認再進下一階段**；不確定的設計決策先問使用者                               |
| 10  | 語言                | App 介面用繁體中文；原生選單依規格用英文                                                                                                        |
| 11  | 套件版本            | TypeScript 用 6.0（typescript-eslint 尚未支援 7）；Vite 用 7（electron-vite 5 只支援到 7）                                                      |
| 12  | 刪除項目            | Collection / 資料夾 / 請求刪除時移到系統垃圾桶（`shell.trashItem`），刪除前需確認                                                               |
| 13  | Workspace 改名      | 只改 `workspace.json` 的顯示名稱，資料夾路徑不變                                                                                                |
| 14  | Workspace 刪除      | 提供「從清單移除」（不動檔案）與「刪除」（整個資料夾移到垃圾桶，需二次確認）                                                                    |
| 15  | 複製命名            | `<名稱> copy`、`<名稱> copy 2`…；複製資料夾 / Collection 時所有項目都產生新 id                                                                  |
| 16  | 檔名 slug           | 小寫、空白換成 `-`、保留中文；重名加 `-2`、`-3`（決策 2 的細節）                                                                                |
| 17  | 資料夾層數          | 不限層數                                                                                                                                        |
| 18  | Collection 共用設定 | Headers / Auth / 變數的欄位在 Phase 1 定義，編輯介面在 Phase 2 與請求編輯器共用元件                                                             |
| 19  | 排序                | `order` / `collectionOrder` 存 id 而非檔名                                                                                                      |

## 下一步：Phase 2 待確認事項

Phase 1 確認後，開始實作前要先向使用者說明 Phase 2 的規劃並確認，預計包括：

- HTTP 發送用 undici 或 Node 內建 fetch、Proxy 設定的格式（`workspace.json` 的 `settings` 與請求的覆寫方式）
- 請求檔 body 各模式（json / raw / formData / urlencoded）的欄位定案；form-data 是否支援檔案欄位
- 回應大小上限、HTML 預覽的沙箱方式（CSP / iframe sandbox）
- 儲存行為：自動儲存或手動（CmdOrCtrl+S）——與 Phase 3 多分頁「未儲存變更提示」相關
- Collection 層級 Headers / Auth / 變數編輯介面的位置

## 開發環境注意事項

- 雲端容器透過 proxy 連網時，Electron 的 postinstall 可能下載失敗。這時可以用 curl 下載 `electron-v<版本>-linux-x64.zip`，解壓到 `node_modules/electron/dist`，並寫入 `node_modules/electron/path.txt`（內容為 `electron`）
- 在 Linux 上以 root 執行 E2E 測試時需加 `--no-sandbox`（`scripts/smoke-e2e.mjs` 已自動處理）
