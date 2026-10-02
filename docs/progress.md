# Hachi 開發進度與決策紀錄

> **給接手的 Claude Code session**：開始工作前請先讀完本檔與 `CLAUDE.md`。
> 每完成一個 Phase（或做出新的設計決策）都要更新本檔，並與程式碼一起 commit。

## 目前狀態

- **目前階段**：Phase 2 已實作並驗證，**等待使用者確認**；確認後進入 Phase 3（環境變數、多分頁、歷史紀錄）
- **最後更新**：2026-10-02

## Phase 進度

| Phase | 內容                                                                                                | 狀態                                                      |
| ----- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0     | 專案骨架、視窗、原生選單、安全設定、首次啟動引導、app-config.json、docs 初版                        | ✅ 完成                                                   |
| 1     | Workspace 切換 + Collection / 資料夾 / 請求樹狀（新增、重新命名、複製、刪除、拖曳排序），含檔案監聽 | ✅ 完成（檔案監聽於 Phase 2 改為手動重新讀取，見決策 20） |
| 2     | HTTP 編輯器與回應檢視器                                                                             | 🟡 待確認                                                 |
| 3     | 環境變數、多分頁、歷史紀錄                                                                          | ⏳ 下一步                                                 |
| 4     | WebSocket 完整功能                                                                                  | —                                                         |
| 5     | 匯入匯出、程式碼產生、腳本與斷言、Collection Runner、全域搜尋                                       | —                                                         |
| 6     | 視窗狀態記憶、深色模式、快捷鍵整理、打包 macOS dmg                                                  | —                                                         |

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

### Phase 2 完成內容

- 移除 chokidar 檔案監聽；改為側欄「重新讀取」按鈕（整個 Workspace）與項目右鍵「重新讀取」（單一 Collection / 資料夾 / 請求，只重掃該子樹）
- HTTP 發送引擎（main，`src/main/services/http/`）：undici；URL + Params、Headers / Auth 繼承（請求 > 資料夾 > Collection）、Body 五種模式（含 form-data 檔案）、timeout、取消、SSL 驗證開關、重新導向（次數上限在 Workspace 設定）、Proxy（none / system / custom + 排除清單 + 帳密）、解壓縮、100 MB 上限（含解壓後）、Set-Cookie 解析、回應暫存（最近 20 筆 / 300 MB）供「顯示」與「下載」
- 請求編輯器：方法、URL（Params 不回寫 URL）、Params / Headers / Body / Auth / Settings 分頁；CodeMirror 6（JSON 格式化與錯誤提示、自動換行開關）；繼承的 Headers 與 Auth 以唯讀方式顯示來源
- 回應檢視器：狀態碼、耗時、大小、重新導向次數；Body（Pretty / Raw / HTML Preview、自動換行開關、下載）、Headers、Cookies；超過 10 MB 顯示「顯示 / 下載」按鈕；網路錯誤分類顯示
- Collection / 資料夾設定編輯器（共用 Headers、Auth）；Workspace 設定對話框（timeout、SSL、跟隨重新導向、最多次數）；App 設定對話框（Proxy，選單 Settings… / CmdOrCtrl+,）
- 手動儲存：File → Save（CmdOrCtrl+S）與「儲存」按鈕；未儲存時樹上與編輯器顯示圓點；切換項目時詢問「儲存 / 不儲存 / 取消」；重新讀取時詢問是否放棄修改
- 修正：zod `partial()` 會替未傳的欄位補預設值，導致切換一個「自動換行」會重設另一個 → IPC 改用不含預設值的 schema；每次載入文件重新建立編輯器，避免 Undo 跨請求

**驗證方式**：`npm run verify`（210 個單元測試，HTTP 引擎以本機 HTTP / HTTPS（自簽憑證）/ Proxy 測試伺服器實測）；`xvfb-run -a npm run test:e2e`（27 項冒煙檢查，含在 App 中對本機伺服器實際發送、儲存、取消、大型回應、下載、重新導向、Proxy、重新讀取）。macOS 尚未實機測試。

**已知限制（Phase 3 處理）**：關閉視窗或從選單切換 Workspace 時，尚未儲存的修改不會提示（Phase 3 的多分頁會一併處理未儲存提示）；樹上的方法標籤顯示的是已儲存的方法。

## 決策紀錄（已與使用者確認）

| #   | 決策                | 內容                                                                                                                                                      |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 機密變數存放        | 存在 `<workspace>/.hachi-secrets.json`（已列入 .gitignore）；環境檔中 secret 的 value 一律留空。之後若接 Keychain，會作為可切換的另一種存放後端           |
| 2   | 請求檔名            | 用名稱的 slug 當檔名（保留中文），檔案內另存 `id`；重新命名時一併改檔名                                                                                   |
| 3   | history.json        | 預設加入 .gitignore；只存未替換變數的原始請求與回應摘要（狀態碼、耗時、大小），不存回應 Body                                                              |
| 4   | UI / 狀態管理       | shadcn/ui（Radix + Tailwind）、Zustand、CodeMirror 6（Phase 2 起）、lucide 圖示                                                                           |
| 5   | 授權                | 專案採 MIT。只能使用寬鬆授權的相依套件，以 `npm run check:licenses` 檢查。複製進專案的第三方程式碼需記錄在 THIRD_PARTY_NOTICES.md                         |
| 6   | 版權人              | `Hachi contributors`（不要填 Cyclopes）                                                                                                                   |
| 7   | Bundle ID           | 暫用 `tw.com.cyclopes.hachi`，集中在 `src/shared/app-info.json`，使用者之後會換成正式的                                                                   |
| 8   | Git 流程            | 直接 commit 並 push 到 `main`，不另開分支                                                                                                                 |
| 9   | 工作流程            | 每個 Phase 完成後先實際執行驗證，簡述做了什麼與如何驗證，**等使用者確認再進下一階段**；不確定的設計決策先問使用者                                         |
| 10  | 語言                | App 介面用繁體中文；原生選單依規格用英文                                                                                                                  |
| 11  | 套件版本            | TypeScript 用 6.0（typescript-eslint 尚未支援 7）；Vite 用 7（electron-vite 5 只支援到 7）                                                                |
| 12  | 刪除項目            | Collection / 資料夾 / 請求刪除時移到系統垃圾桶（`shell.trashItem`），刪除前需確認                                                                         |
| 13  | Workspace 改名      | 只改 `workspace.json` 的顯示名稱，資料夾路徑不變                                                                                                          |
| 14  | Workspace 刪除      | 提供「從清單移除」（不動檔案）與「刪除」（整個資料夾移到垃圾桶，需二次確認）                                                                              |
| 15  | 複製命名            | `<名稱> copy`、`<名稱> copy 2`…；複製資料夾 / Collection 時所有項目都產生新 id                                                                            |
| 16  | 檔名 slug           | 小寫、空白換成 `-`、保留中文；重名加 `-2`、`-3`（決策 2 的細節）                                                                                          |
| 17  | 資料夾層數          | 不限層數                                                                                                                                                  |
| 18  | Collection 共用設定 | Headers / Auth 的編輯介面在 Phase 2（與請求編輯器共用元件）；**Collection 變數的編輯介面移到 Phase 3**，與環境變數和 `{{variable}}` 替換一起做            |
| 19  | 排序                | `order` / `collectionOrder` 存 id 而非檔名                                                                                                                |
| 20  | 檔案監聽            | **不持續監聽外部檔案**（移除 chokidar，覆蓋 CLAUDE.md 原規格）。改為手動「重新讀取」：整個 Workspace / 單一 Collection / 單一項目；有未儲存修改時提示放棄 |
| 21  | 發送 / 取消快捷鍵   | **不提供鍵盤快捷鍵**，以防誤觸（覆蓋 CLAUDE.md 的 CmdOrCtrl+Enter 發送）                                                                                  |
| 22  | Params 與 URL       | Params 表格**不回寫** URL 欄位；發送時才把啟用的 Params 接在 URL（含其原有 query）之後                                                                    |
| 23  | Body 顯示換行       | 請求 Body 與回應 Body 各有「自動換行」勾選（只影響顯示），記在 `app-config.json` 的 `ui`                                                                  |
| 24  | 繼承的 Auth         | Auth 為「沿用上層」時，顯示實際沿用的內容與來源（唯讀，要修改需到上層）；繼承的 Headers 也以唯讀方式列出                                                  |
| 25  | 回應內容操作        | 不提供「複製」按鈕（使用者自行選取複製），提供「下載」                                                                                                    |
| 26  | 儲存方式            | 手動儲存（CmdOrCtrl+S / 儲存按鈕），未儲存有圓點提示；切換項目時詢問 儲存 / 不儲存 / 取消                                                                 |
| 27  | Proxy               | App 層級（`app-config.json`，不進 Workspace / git）：none / system / custom + 排除清單 + 選填帳密；請求可關閉「使用 App 的 Proxy」                        |
| 28  | Cookies             | 只顯示回應的 Cookies，不做 Cookie Jar（可排到 Phase 5）                                                                                                   |
| 29  | Form-data 檔案      | 支援，存絕對路徑並提示換電腦可能不存在                                                                                                                    |
| 30  | 回應大小            | 超過 10 MB：畫面上提供「顯示 / 下載」兩個按鈕讓使用者選；超過 100 MB（含解壓後）中止接收                                                                  |
| 31  | HTML 預覽           | `sandbox=""` iframe：不執行 script、不載入外部資源                                                                                                        |
| 32  | 重新導向            | 預設跟隨；最多次數在 Workspace 設定（預設 **3**，0–20）；請求可單獨關閉跟隨                                                                               |

## 下一步：Phase 3 待確認事項

Phase 2 確認後，開始實作前要先向使用者說明 Phase 3 的規劃並確認，預計包括：

- 環境檔 / `.hachi-secrets.json` 格式定案（見 `docs/schema.md` 草案）、Collection 變數的優先順序（環境 vs Collection）
- `{{variable}}` 替換的範圍（URL、Params、Headers、Body、Auth）、未定義變數的顯示與發送行為、變數高亮
- 多分頁：分頁狀態存放（`<userData>/sessions/<hash>.json`）、預覽分頁（單擊暫時開啟）與否、關閉分頁 / 視窗 / 切換 Workspace 的未儲存提示
- 歷史紀錄：保留筆數、從歷史重新載入的方式（開新分頁 vs 覆蓋）
- CmdOrCtrl+T / CmdOrCtrl+W 的行為

## 開發環境注意事項

- 雲端容器透過 proxy 連網時，Electron 的 postinstall 可能下載失敗。這時可以用 curl 下載 `electron-v<版本>-linux-x64.zip`，解壓到 `node_modules/electron/dist`，並寫入 `node_modules/electron/path.txt`（內容為 `electron`）
- 在 Linux 上以 root 執行 E2E 測試時需加 `--no-sandbox`（`scripts/smoke-e2e.mjs` 已自動處理）
