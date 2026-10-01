請用 Electron + Vite + React + TypeScript + Tailwind 實作一個類似 Postman / Bruno 的桌面 API 測試工具，App 名稱為「Hachi」。

【專案識別】
- App 名稱：Hachi
- package name：hachi
- Bundle ID：tw.com.cyclopes.hachi（請集中放在單一設定處，之後我會改成正式的）
- 視窗標題、原生選單、About 視窗、打包產物名稱都使用 Hachi
- 預設 Workspace 資料夾建議位置：~/Documents/Hachi/（可讓使用者自選）
- 先用簡單的文字或佔位圖示即可，之後我再提供正式 Logo / icon

【技術棧】
- Electron（main / preload / renderer 分離）、Vite、React、TypeScript、Tailwind
- 打包：electron-builder
- HTTP：undici 或 fetch（在 main process 執行）
- WebSocket：ws（在 main process 執行）
- 檔案監聽：chokidar
- 狀態管理與 UI 元件庫由你選擇，請簡述理由

【硬性規則】
- 先支援 macOS，但程式碼保持跨平台：路徑一律用 path 模組、快捷鍵用 CmdOrCtrl、設定檔放 app.getPath('userData')
- 無登入功能、不使用任何資料庫，所有資料存成 JSON 檔
- 安全：contextIsolation 開啟、nodeIntegration 關閉；renderer 只能透過 preload 暴露的白名單 API 呼叫 main；IPC 輸入需做基本驗證
- HTTP 與 WebSocket 都在 main process 執行（避開 CORS、可自訂 WS Headers）
- IPC 介面與 JSON schema 由你設計，並寫入 docs/ipc.md 與 docs/schema.md，後續階段需遵守並同步更新
- 所有 JSON 檔都要有 version 欄位，方便日後遷移
- JSON 寫入要用原子寫入（先寫暫存檔再 rename），避免檔案損毀
- 每個 Phase 完成後：先實際執行驗證，簡述做了什麼與如何驗證，等我確認再進下一階段
- 不確定的設計決策請先問我，不要自行假設

【資料結構（大致方向，欄位由你決定）】
app-config.json          （userData 目錄：最近開啟的 Workspace、主題、視窗狀態）
<workspace>/
  workspace.json         （名稱、設定、排序）
  collections/<name>/collection.json
  collections/<name>/<request>.json   （以 type 區分 "http" | "websocket"）
  environments/*.json
  history.json           （HTTP 與 WS 連線紀錄）
  .gitignore             （排除含機密的環境檔）

【功能需求】

1. Workspace（最上層）
- 建立、開啟、切換、重新命名、刪除 Workspace，每個對應磁碟上的一個資料夾，可自選路徑
- 記錄「最近開啟」清單
- 首次啟動沒有 Workspace 時，引導建立第一個
- 每個 Workspace 各自擁有 Collections、Environments、History、Settings
- 切換 Workspace 時，分頁與環境一併切換

2. Collection（隸屬於 Workspace）
- 在目前 Workspace 內建立 Collection、資料夾、請求
- 新增、重新命名、複製、刪除、拖曳排序
- Collection 層級可設定共用 Headers / Auth / 變數
- 項目類型：HTTP 請求、WebSocket 連線

3. HTTP 請求編輯器
- 方法：GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS
- URL、Query Params 表格、Headers 表格（皆可勾選啟用/停用）
- Body：none / JSON / Raw text / Form-data / x-www-form-urlencoded
- Auth：None / Bearer / Basic / API Key
- Timeout、SSL 驗證開關、Proxy 設定

4. HTTP 回應檢視器
- 狀態碼、耗時、回應大小
- Body：JSON 美化（可摺疊）/ Raw / HTML 預覽
- Response Headers、Cookies
- 複製與下載回應內容

5. 環境變數
- 多組環境（dev / staging / prod），快速切換
- {{variable}} 語法，可用於 URL、Header、Body、Auth
- 變數可標記為機密（secret），機密值不寫入可被提交的檔案

6. 多分頁、歷史紀錄
- 同時開啟多個請求分頁（HTTP 與 WS 皆可），未儲存變更要有提示
- 歷史紀錄自動記錄最近發送的請求，可重新載入

7. WebSocket
- 連線設定：ws:// / wss://、{{variable}}、Headers、Query Params、子協定、Auth
- 連線控制：連線 / 中斷、狀態顯示（連線中 / 已連線 / 已關閉 / 錯誤）、自動重連選項
- 訊息：Text / JSON / Binary（Hex 或 Base64）、可儲存多組訊息範本一鍵送出
- 即時訊息串：區分送出/收到、時間戳、JSON 美化、搜尋、篩選、清除、匯出
- 心跳（Ping/Pong）手動或定時、顯示 Close Code 與原因
- 可同時開多個 WebSocket 分頁；訊息紀錄預設只存在記憶體，需要時手動匯出

8. 進階功能
- 匯入 / 匯出：Postman Collection、cURL
- 程式碼產生：cURL、fetch、axios、Python requests
- Pre-request / Post-response 腳本（設定變數）、測試斷言（狀態碼、JSON 欄位）
- Collection Runner（批次依序執行）
- 全域搜尋

9. 桌面 App 專屬
- 原生選單列（Hachi / File / Edit / View / Window），符合 macOS 慣例
- 原生檔案對話框
- 快捷鍵：CmdOrCtrl+Enter 發送、CmdOrCtrl+T 新分頁、CmdOrCtrl+W 關閉分頁、CmdOrCtrl+O 開啟 Workspace
- 視窗大小、位置、上次開啟的 Workspace 與分頁要記憶
- 跟隨系統深色 / 淺色模式
- 拖放匯入檔案
- 選用：機密變數存入系統 Keychain（macOS Keychain，Windows 之後再接）

【階段】
Phase 0：專案骨架（Hachi）、視窗、原生選單、安全設定（contextIsolation 等）、首次啟動引導建立 Workspace、app-config.json；撰寫 docs/ipc.md 與 docs/schema.md 初版，並說明你規劃的資料夾結構
Phase 1：Workspace 切換 + Collection / 資料夾 / 請求樹狀（新增、重新命名、複製、刪除、拖曳排序），含檔案監聽
Phase 2：HTTP 編輯器與回應檢視器
Phase 3：環境變數、多分頁、歷史紀錄
Phase 4：WebSocket 完整功能
Phase 5：匯入匯出、程式碼產生、腳本與斷言、Collection Runner、全域搜尋
Phase 6：視窗狀態記憶、深色模式、快捷鍵整理、electron-builder 打包 macOS Hachi-x.y.z.dmg（Apple Silicon + Intel）

【打包與未來規劃】
- 目前只打包 macOS（.dmg），先不做簽章與公證，但請在 README 說明之後如何加上 Apple Developer 簽章與 Notarization
- 之後要支援 Windows（.exe / .msi），請避免寫死 macOS 專屬行為；平台專屬程式碼集中在獨立模組並加註解

【其他要求】
- 提供 README（如何開發、執行、打包），標題與說明皆使用 Hachi
- 重要模組（HTTP 發送、變數替換、檔案讀寫、WS 管理）撰寫單元測試
- 程式碼風格：啟用 ESLint + Prettier，TypeScript strict 模式

請先從 Phase 0 開始，先說明規劃（資料夾結構、IPC 設計概要、JSON schema 概要、狀態管理與 UI 元件庫的選擇），等我確認後再動手實作。
