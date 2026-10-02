# Hachi IPC 介面

> 版本：Phase 3。後續每個 Phase 新增或修改 channel 時，必須同步更新本文件。
>
> 程式碼來源（單一事實來源）：
>
> - Channel 名稱：`src/shared/ipc/channels.ts`
> - 輸入 / 輸出型別：`src/shared/ipc/api.ts`（`InvokeMap`、`HachiApi`）
> - 輸入驗證 schema：`src/shared/ipc/contract.ts`（zod）
> - Main 端實作：`src/main/ipc/register.ts`

## 架構

```
Renderer (React)                Preload (sandbox)                 Main
window.hachi.workspace.open() → ipcRenderer.invoke('workspace:open', input)
                                                                 → 檢查 sender → zod 驗證 → handler
                              ← IpcResult<T>                    ←
window.hachi.on('workspace:changed', cb) ← webContents.send(...)
```

### 安全規則

| 項目                   | 設定                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contextIsolation`     | `true`                                                                                                                                                                                                                                                                   |
| `nodeIntegration`      | `false`                                                                                                                                                                                                                                                                  |
| `sandbox`              | `true`（preload 輸出為 CommonJS 並完整打包，不依賴 node_modules）                                                                                                                                                                                                        |
| 暴露給 renderer 的 API | 只有 `window.hachi`（固定白名單函式）；不暴露 `ipcRenderer`、`require`、`process`                                                                                                                                                                                        |
| 事件訂閱               | `window.hachi.on()` 只接受 `EVENT_CHANNELS` 中的 channel，其餘直接丟錯                                                                                                                                                                                                   |
| Sender 驗證            | 每個 invoke 都檢查 `event.senderFrame.url`：開發時需為 Vite dev server 同源；正式版需為打包內的 `out/renderer/index.html`。不符合回傳 `FORBIDDEN`                                                                                                                        |
| 輸入驗證               | 每個 channel 都有 zod schema（`strictObject`，多餘欄位會被拒絕）；不帶參數的 channel 只接受 `undefined`                                                                                                                                                                  |
| 路徑                   | Workspace 相關 channel 只接受絕對路徑（POSIX 或 Windows 形式），不得含 NUL；main 端一律 `path.resolve` 後使用。**Collection 樹狀項目的操作（`item:*`）只接受 id，不接受路徑**：main 依上次掃描建立的 id → 路徑對照表找出實際位置，renderer 無法指定 Workspace 以外的路徑 |
| 新視窗 / 導覽          | 禁止開新視窗（http/https 連結改用系統瀏覽器開啟）、禁止導覽離開 App 頁面、禁止 `<webview>`                                                                                                                                                                               |
| 權限                   | 除 `clipboard-sanitized-write` 外，所有權限請求（相機、定位…）一律拒絕                                                                                                                                                                                                   |
| CSP                    | 正式版：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`。開發模式額外允許 inline script 與 `ws:`（Vite HMR）   |

### 回傳格式

所有 invoke 都回傳 `IpcResult<T>`，**不會**以 reject 的方式跨 IPC 拋錯：

```ts
type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } }
```

Renderer 端使用 `unwrap()`（`src/renderer/src/lib/ipc.ts`）轉成 `IpcError` 例外。

### 錯誤碼（`src/shared/errors.ts`）

| code                  | 意義                                                   |
| --------------------- | ------------------------------------------------------ |
| `VALIDATION_ERROR`    | 輸入未通過 zod 驗證                                    |
| `FORBIDDEN`           | IPC 來源不可信                                         |
| `NOT_FOUND`           | 檔案或資源不存在                                       |
| `ALREADY_EXISTS`      | 目標已存在（例如該位置已有 Workspace）                 |
| `DIR_NOT_EMPTY`       | 目標資料夾已存在且非空                                 |
| `NOT_A_WORKSPACE`     | 資料夾內沒有 `workspace.json`                          |
| `NO_WORKSPACE`        | 需要開啟中的 Workspace，但目前沒有                     |
| `INVALID_OPERATION`   | 操作不合法（例如把資料夾移進自己、在請求底下新增項目） |
| `INVALID_FILE`        | JSON 格式錯誤或不符合 schema                           |
| `UNSUPPORTED_VERSION` | 檔案 `version` 比目前 App 支援的還新                   |
| `IO_ERROR`            | 檔案系統錯誤                                           |
| `INTERNAL`            | 未預期錯誤（細節只寫入 main log，不回傳給 renderer）   |

## Invoke channels（Renderer → Main）

| Channel                      | `window.hachi`                  | 輸入                                                                                                                  | 輸出                                                   | 說明                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app:getInfo`                | `app.getInfo()`                 | —                                                                                                                     | `AppInfo`                                              | 名稱、版本、appId、平台、是否已打包                                                                                                                                                                                                                                                 |
| `app:getDefaultWorkspaceDir` | `app.getDefaultWorkspaceDir()`  | —                                                                                                                     | `string`                                               | 預設 Workspace 上層目錄：`<Documents>/Hachi`                                                                                                                                                                                                                                        |
| `app:setCloseGuard`          | `app.setCloseGuard(input)`      | `{ dirty: boolean }`                                                                                                  | `void`                                                 | 有未儲存的分頁時設為 `true`：關閉視窗 / 結束 App 會先送 `app:closeRequested` 讓 renderer 詢問                                                                                                                                                                                       |
| `app:confirmClose`           | `app.confirmClose()`            | —                                                                                                                     | `void`                                                 | renderer 處理完 `app:closeRequested` 後呼叫，main 才真正關閉視窗或結束 App                                                                                                                                                                                                          |
| `config:get`                 | `config.get()`                  | —                                                                                                                     | `AppConfig`                                            | 讀取 app-config（記憶體中的版本）                                                                                                                                                                                                                                                   |
| `config:update`              | `config.update(input)`          | `{ theme?, proxy?: ProxySettings, ui?: { requestBodyWrap?, responseBodyWrap? }, history?: { maxEntries: 50..1000 } }` | `AppConfig`                                            | Renderer 只能修改使用者偏好（主題、Proxy、顯示偏好）；recent / window 狀態由 main 維護。`ui` 只更新有傳的鍵；`history.maxEntries` 調小時立即刪除所有 Workspace 中最舊的歷史紀錄                                                                                                     |
| `workspace:getCurrent`       | `workspace.getCurrent()`        | —                                                                                                                     | `WorkspaceInfo \| null`                                | 目前開啟的 Workspace                                                                                                                                                                                                                                                                |
| `workspace:create`           | `workspace.create(input)`       | `{ name: string(1..100, trim), parentDir: 絕對路徑 }`                                                                 | `WorkspaceInfo`                                        | 在 `parentDir/<淨化後名稱>` 建立 Workspace 並開啟。目標已是 Workspace → `ALREADY_EXISTS`；非空資料夾 → `DIR_NOT_EMPTY`                                                                                                                                                              |
| `workspace:open`             | `workspace.open(input)`         | `{ path: 絕對路徑 }`                                                                                                  | `WorkspaceInfo`                                        | 開啟並設為目前 Workspace，更新最近清單                                                                                                                                                                                                                                              |
| `workspace:openWithDialog`   | `workspace.openWithDialog()`    | —                                                                                                                     | `WorkspaceInfo \| null`                                | 顯示原生資料夾選擇器後開啟；取消回傳 `null`                                                                                                                                                                                                                                         |
| `workspace:listRecent`       | `workspace.listRecent()`        | —                                                                                                                     | `RecentWorkspaceEntry[]`                               | 最近開啟清單（含 `exists` 旗標）                                                                                                                                                                                                                                                    |
| `workspace:removeRecent`     | `workspace.removeRecent(input)` | `{ path: 絕對路徑 }`                                                                                                  | `RecentWorkspaceEntry[]`                               | 從最近清單移除（不刪除磁碟資料）                                                                                                                                                                                                                                                    |
| `workspace:rename`           | `workspace.rename(input)`       | `{ name: string(1..100, trim) }`                                                                                      | `WorkspaceInfo`                                        | 重新命名目前 Workspace：只改 `workspace.json` 的 `name`，資料夾不變。無開啟中 Workspace → `NO_WORKSPACE`                                                                                                                                                                            |
| `workspace:delete`           | `workspace.delete(input)`       | `{ path: 絕對路徑 }`                                                                                                  | `RecentWorkspaceEntry[]`                               | 把 Workspace 資料夾移到系統垃圾桶並從最近清單移除。只接受目前或最近清單中的 Workspace（否則 `FORBIDDEN`），且資料夾內必須有 `workspace.json`（否則 `NOT_A_WORKSPACE`）。刪除目前 Workspace 時會先關閉它（觸發 `workspace:changed` = `null`）                                        |
| `workspace:getSettings`      | `workspace.getSettings()`       | —                                                                                                                     | `WorkspaceSettings`                                    | 目前 Workspace 的請求預設值（timeout、SSL、重新導向）                                                                                                                                                                                                                               |
| `workspace:saveSettings`     | `workspace.saveSettings(input)` | `WorkspaceSettings`                                                                                                   | `WorkspaceSettings`                                    | 寫回 `workspace.json` 的 `settings`                                                                                                                                                                                                                                                 |
| `dialog:selectDirectory`     | `dialog.selectDirectory(input)` | `{ title?: string(≤200), defaultPath?: 絕對路徑 }`                                                                    | `string \| null`                                       | 原生資料夾選擇器；取消回傳 `null`                                                                                                                                                                                                                                                   |
| `dialog:selectFile`          | `dialog.selectFile(input)`      | `{ title?: string(≤200) }`                                                                                            | `string \| null`                                       | 原生檔案選擇器（Form-data 檔案欄位用）；取消回傳 `null`                                                                                                                                                                                                                             |
| `tree:get`                   | `tree.get()`                    | —                                                                                                                     | `WorkspaceTree`                                        | 目前 Workspace 的 Collection 樹（會等待進行中的操作完成）                                                                                                                                                                                                                           |
| `tree:reload`                | `tree.reload(input)`            | `{ scope: 'workspace' } \| { scope: 'item', id }`                                                                     | `WorkspaceTree`                                        | 重新讀取在 Hachi 以外修改的檔案。`workspace`：整個樹 + `workspace.json`；`item`：只重讀該項目（請求、資料夾或整個 Collection 及其內容），樹的其他部分不變。檔案已不存在的項目會從樹上移除                                                                                           |
| `item:create`                | `item.create(input)`            | `ItemCreateInput`                                                                                                     | `ItemMutationResult`                                   | 新增 Collection（`parentId: null`）/ 資料夾 / 請求，加到父層 `order` 最後                                                                                                                                                                                                           |
| `item:rename`                | `item.rename(input)`            | `{ id, name: string(1..100, trim) }`                                                                                  | `WorkspaceTree`                                        | 改名並同步改檔名 / 資料夾名（slug，衝突時加 `-2`…）；id 不變                                                                                                                                                                                                                        |
| `item:duplicate`             | `item.duplicate(input)`         | `{ id }`                                                                                                              | `ItemMutationResult`                                   | 複製到原項目正下方，名稱為 `<名稱> copy`、`<名稱> copy 2`…；資料夾 / Collection 深層複製，所有項目都產生新 id                                                                                                                                                                       |
| `item:delete`                | `item.delete(input)`            | `{ id }`                                                                                                              | `WorkspaceTree`                                        | 移到系統垃圾桶，並從父層 `order` 移除。無法讀取的項目也可刪除                                                                                                                                                                                                                       |
| `item:move`                  | `item.move(input)`              | `{ id, parentId: id \| null, index: int ≥ 0 }`                                                                        | `WorkspaceTree`                                        | 拖曳排序 / 移動。`parentId: null` 只適用於 Collection；跨父層移動時檔案會搬到新資料夾。不可移進自己或子孫（`INVALID_OPERATION`）                                                                                                                                                    |
| `request:get`                | `request.get(input)`            | `{ id }`                                                                                                              | `RequestData`                                          | HTTP 請求的完整內容（缺少的欄位補預設值）與繼承的 Headers / Auth。WebSocket 請求 → `INVALID_OPERATION`                                                                                                                                                                              |
| `request:save`               | `request.save(input)`           | `{ id, request: HttpRequest }`                                                                                        | `{ request, tree }`                                    | 寫回請求檔。磁碟上的 `id`、`name`、`type` 不會被改（改名請用 `item:rename`）；檔案中未知的欄位保留                                                                                                                                                                                  |
| `request:saveAs`             | `request.saveAs(input)`         | `{ parentId: id, name: string(1..100), request: HttpRequest }`                                                        | `{ id, request, tree }`                                | 把未儲存的分頁（新請求 / 歷史 / 已刪除項目）存成新的請求檔                                                                                                                                                                                                                          |
| `request:getInherited`       | `request.getInherited(input)`   | `{ parentId: id \| null }`                                                                                            | `InheritedSettings`                                    | 放在 `parentId` 內的項目會沿用的 Headers / Auth（未儲存分頁、項目被移動後使用）                                                                                                                                                                                                     |
| `container:get`              | `container.get(input)`          | `{ id }`                                                                                                              | `ContainerSettingsData`                                | Collection / 資料夾的共用 Headers、Auth 與繼承內容                                                                                                                                                                                                                                  |
| `container:save`             | `container.save(input)`         | `{ id, headers: KeyValue[], auth: Auth, variables: Variable[] }`                                                      | `ContainerSettingsData`                                | 寫回 `collection.json` / `folder.json`。Collection 的 `inherit` 會存成 `none`；Collection 變數（資料夾忽略），機密值寫入 `.hachi-secrets.json`                                                                                                                                      |
| `http:send`                  | `http.send(input)`              | `{ runId, requestId: id \| null, parentId: id \| null, environmentId: id \| null, request: HttpRequest }`             | `HttpResult`                                           | 在 main 以 undici 發送**編輯器目前的內容**（含未儲存的修改）；`requestId` 用來找出上層的 Headers / Auth。連線失敗等網路錯誤以 `{ kind: 'error' }` 回傳，不是 IPC 錯誤。發送前在 main 以「環境 > Collection」替換 `{{變數}}`（見「變數替換」），並記錄到歷史紀錄（取消的請求不記錄） |
| `http:cancel`                | `http.cancel(input)`            | `{ runId }`                                                                                                           | `boolean`                                              | 取消進行中的請求；已結束回傳 `false`                                                                                                                                                                                                                                                |
| `http:getBody`               | `http.getBody(input)`           | `{ runId }`                                                                                                           | `string`                                               | 取得超過 10 MB、未直接回傳的回應內容。main 只保留最近 20 個回應（合計 300 MB），過期 → `NOT_FOUND`                                                                                                                                                                                  |
| `http:saveResponse`          | `http.saveResponse(input)`      | `{ runId }`                                                                                                           | `string \| null`                                       | 顯示原生存檔對話框（預設檔名依 URL 與 Content-Type）並寫入回應內容；取消回傳 `null`                                                                                                                                                                                                 |
| `env:list`                   | `env.list()`                    | —                                                                                                                     | `EnvironmentSummary[]`                                 | 目前 Workspace 的環境（依名稱排序）；無法讀取的檔案帶 `error`，只能刪除                                                                                                                                                                                                             |
| `env:get`                    | `env.get(input)`                | `{ id }`                                                                                                              | `EnvironmentData`                                      | 環境內容，機密值從 `.hachi-secrets.json` 合併回來                                                                                                                                                                                                                                   |
| `env:create`                 | `env.create(input)`             | `{ name: string(1..100) }`                                                                                            | `{ id, list }`                                         | 建立 `environments/<slug>.json`                                                                                                                                                                                                                                                     |
| `env:save`                   | `env.save(input)`               | `{ id, name, variables: Variable[] }`                                                                                 | `EnvironmentData`                                      | 機密值寫入 `.hachi-secrets.json`，環境檔中留空；改名時一併改檔名                                                                                                                                                                                                                    |
| `env:duplicate`              | `env.duplicate(input)`          | `{ id }`                                                                                                              | `{ id, list }`                                         | 「<名稱> copy」，新 id，機密值一併複製                                                                                                                                                                                                                                              |
| `env:delete`                 | `env.delete(input)`             | `{ id }`                                                                                                              | `EnvironmentSummary[]`                                 | 環境檔移到系統垃圾桶（機密值保留，方便從垃圾桶還原）                                                                                                                                                                                                                                |
| `history:list`               | `history.list()`                | —                                                                                                                     | `{ entries: HttpHistoryEntry[], usage: HistoryUsage }` | 目前 Workspace 的歷史紀錄（新的在前）                                                                                                                                                                                                                                               |
| `history:delete`             | `history.delete(input)`         | `{ id }`                                                                                                              | `HistoryUsage`                                         | 刪除一筆                                                                                                                                                                                                                                                                            |
| `history:clear`              | `history.clear()`               | —                                                                                                                     | `HistoryUsage`                                         | 清除目前 Workspace 的全部紀錄                                                                                                                                                                                                                                                       |
| `history:getUsage`           | `history.getUsage()`            | —                                                                                                                     | `HistoryUsage`                                         | 所有 Workspace 共用的筆數上限與使用量（視窗角落的圓餅圖）                                                                                                                                                                                                                           |
| `session:get`                | `session.get()`                 | —                                                                                                                     | `SessionData`                                          | 目前 Workspace 在這台電腦上次開啟的分頁與環境                                                                                                                                                                                                                                       |
| `session:save`               | `session.save(input)`           | `SessionData`                                                                                                         | `void`                                                 | renderer 在分頁 / 環境改變後（300 ms 去抖動）寫入                                                                                                                                                                                                                                   |

### 型別

```ts
interface AppInfo {
  name: string
  version: string
  appId: string
  platform: string
  isPackaged: boolean
}
interface WorkspaceInfo {
  id: string
  name: string
  path: string
}
interface RecentWorkspaceEntry {
  path: string
  name: string
  lastOpenedAt: string
  exists: boolean
}

// ---- Collection 樹（src/shared/tree.ts）----
interface WorkspaceTree {
  workspaceId: string | null
  collections: CollectionNode[]
}
interface BaseNode {
  id: string // 項目 JSON 內的 id；無法讀取的檔案為 "invalid:<相對路徑>"
  name: string
  relPath: string // 相對於 Workspace，使用 "/"，僅供顯示
  error?: string // 檔案無法讀取 / 格式錯誤時才有；此時只能刪除
}
interface CollectionNode extends BaseNode {
  kind: 'collection'
  children: (FolderNode | RequestNode)[]
}
interface FolderNode extends BaseNode {
  kind: 'folder'
  children: (FolderNode | RequestNode)[]
}
interface RequestNode extends BaseNode {
  kind: 'request'
  requestType: 'http' | 'websocket'
  method?: string
}

interface ItemCreateInput {
  parentId: string | null // null = 建立 Collection
  kind: 'collection' | 'folder' | 'request'
  name: string // 1..100
  requestType?: 'http' | 'websocket' // kind 為 request 時必填
}
interface ItemMutationResult {
  id: string // 新建立 / 複製出的項目 id
  tree: WorkspaceTree
}

// ---- Phase 3 ----
interface Variable extends KeyValue {
  secret: boolean // 機密：值只存在 .hachi-secrets.json
}
interface EnvironmentSummary {
  id: string // 無法讀取的檔案為 "invalid:<檔名>"
  name: string
  error?: string
}
interface EnvironmentData {
  id: string
  name: string
  variables: Variable[] // 含機密值
}
interface HistoryUsage {
  total: number // 所有 Workspace 加總
  max: number // App 設定的上限（所有 Workspace 共用）
  workspace: number // 目前 Workspace 的筆數
}
interface SessionData {
  tabs: ({ kind: 'item'; id: string } | { kind: 'environments' })[] // 不含未儲存的新請求
  activeTab: number | null
  activeEnvironmentId: string | null
}
// HttpHistoryEntry 的格式見 docs/schema.md「history.json」
```

### 操作的一致性與重新讀取

- 所有樹狀操作與重新掃描在 main 端**依序執行**（同一時間只有一個）。
- 每次操作完成後回傳最新的樹；renderer 以回傳值與 `tree:changed` 事件為準，不自行推算。樹內容沒有改變時不會發出 `tree:changed`。
- **不持續監聽檔案**（Phase 2 決定，移除 chokidar）。在 Hachi 以外修改的檔案，使用者按側欄的「重新讀取」（整個 Workspace）或項目右鍵「重新讀取」（單一 Collection / 資料夾 / 請求）後才會反映。編輯器中的項目有未儲存修改時，renderer 會先詢問是否放棄。

### HTTP 型別（`src/shared/http.ts`、`src/shared/schemas/http-request.ts`）

```ts
interface RequestData {
  request: HttpRequest
  inherited: InheritedSettings
}
interface InheritedSettings {
  headers: (KeyValue & { sourceId: string; sourceName: string })[] // 內層覆寫外層同名 Header
  auth: { auth: Auth; sourceId: string; sourceName: string } | null // 最近一層不是 inherit 的 Auth
}
type HttpResult = HttpResponseData | HttpErrorData
interface HttpResponseData {
  kind: 'response'
  runId: string
  status: number
  statusText: string
  headers: [string, string][] // 名稱小寫，重複的 Header 各佔一列
  cookies: ResponseCookie[]
  contentType: string
  body: { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'large' } | { kind: 'empty' }
  bodyBytes: number
  headerBytes: number
  timings: { headersMs: number; totalMs: number }
  url: string // 實際送出的 URL（含 Params，變數已替換）
  redirects: number
  unresolvedVariables: string[] // 找不到值、照原樣送出的 {{變數}}
}
interface HttpErrorData {
  kind: 'error'
  runId: string
  code:
    | 'INVALID_URL'
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'TLS'
    | 'PROXY'
    | 'NETWORK'
    | 'TOO_LARGE'
    | 'FILE_NOT_FOUND'
    | 'TOO_MANY_REDIRECTS'
    | 'UNKNOWN'
  message: string
  url: string
  timings: { totalMs: number }
  unresolvedVariables: string[]
}
```

### HTTP 發送規則

- **URL**：URL 欄位照原樣使用（沒有 scheme 時補 `http://`；只接受 http / https），啟用的 Params 在發送時接在既有 query 之後，不會改寫 URL 欄位。
- **Headers**：請求自己的 Headers > 資料夾 > Collection（同名以內層為準）。另外自動補上 `User-Agent: Hachi/<版本>`、`Accept: */*`，以及 Body 對應的 `Content-Type`（皆在使用者沒設定時才加）。
- **Auth**：`inherit` 取最近一層不是 `inherit` 的設定；Bearer / Basic 只在沒有手動設定 `Authorization` 時加入；API Key 可加在 Header 或 Query。
- **選項**：請求的 `settings` 為 `null` 時沿用 Workspace 設定（timeout、SSL 驗證、跟隨重新導向）；最多重新導向次數只在 Workspace 設定（預設 3）。
- **Proxy**：App 層級設定（`app-config.json`），模式 none / system（交給 Chromium 解析系統設定）/ custom；排除清單內的主機直接連線；請求可關閉「使用 App 的 Proxy 設定」。HTTPS 走 CONNECT、HTTP 走 absolute-form。
- **回應**：依 `Content-Encoding` 解壓（gzip / deflate / br / zstd）；超過 100 MB（含解壓後）中止並回傳 `TOO_LARGE`；超過 10 MB 的文字回應以 `{ kind: 'large' }` 回傳，由使用者選擇「顯示」（`http:getBody`）或「下載」。
- **變數**：見下一節；替換在 main 進行，renderer 只送出未替換的內容與 `environmentId` / `parentId`。
- **安全**：Form-data 檔案欄位會讀取使用者選擇的本機檔案並送出；HTML 預覽在 `sandbox=""` 的 iframe（不執行 script、無同源權限）中顯示，App 的 CSP 也會擋下外部資源。

### 變數替換（`src/shared/variables.ts`）

- 語法 `{{name}}`（大括號內前後空白會忽略）。可用在 URL、Params、Headers、Body（目前模式）、Auth、Form-data 的文字值與檔案路徑；請求名稱不替換。
- 來源與優先順序：**目前環境 > Collection 變數**（`parentId` 所屬的 Collection）。停用或名稱空白的變數忽略。
- 變數值可再引用其他變數，最多 10 層；循環引用停止替換並視為找不到。
- 動態變數（沒有同名的使用者變數時）：`{{$guid}}`、`{{$timestamp}}`（Unix 秒）、`{{$isoTimestamp}}`、`{{$randomInt}}`（0–1000），每次出現都重新產生。
- 找不到的變數照原樣送出，名稱列在回應的 `unresolvedVariables`。
- Renderer 用同一個模組標示變數：綠色＝有值、藍色＝動態、紅色＝找不到；滑鼠移上去顯示值（機密值遮罩）。

### 分頁、未儲存提示與關閉視窗

- 分頁狀態只在 renderer；每個 Workspace 開了哪些分頁與目前環境，透過 `session:*` 存在 `<userData>/sessions/`（見 docs/schema.md）。
- 關閉分頁、切換 / 開啟 / 刪除目前 Workspace、重新讀取時，renderer 先詢問未儲存的分頁。
- 關閉視窗 / 結束 App：renderer 以 `app:setCloseGuard` 告知是否有未儲存的分頁。有的話 main 取消這次關閉並送出 `app:closeRequested`；使用者選擇儲存或不儲存後，renderer 呼叫 `app:confirmClose`，main 才關閉（或結束）。renderer 重新載入或當掉時 main 會自動解除保護。
- 選單的 Open Workspace / Open Recent 改由 renderer 執行（`menu:command`），以便先詢問未儲存的分頁。

## Event channels（Main → Renderer）

| Channel              | Payload                                                                                                                                                              | 觸發時機                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `menu:command`       | `{ command: 'workspace.new' \| 'workspace.switch' \| 'workspace.open' \| 'workspace.openRecent' \| 'request.save' \| 'tab.close' \| 'app.settings', path?: string }` | 原生選單中需要由 UI 處理的指令（`path` 只用於 `workspace.openRecent`） |
| `workspace:changed`  | `WorkspaceInfo \| null`                                                                                                                                              | 目前 Workspace 變更（不論來自 renderer、選單或 Open Recent）           |
| `config:changed`     | `AppConfig`                                                                                                                                                          | app-config 內容變更                                                    |
| `tree:changed`       | `WorkspaceTree`                                                                                                                                                      | Collection 樹有變化（App 內操作、重新讀取、切換 Workspace）            |
| `history:changed`    | `HistoryUsage`                                                                                                                                                       | 歷史紀錄新增 / 刪除 / 套用新上限後（usage 以目前 Workspace 計算）      |
| `app:closeRequested` | `{ reason: 'close' \| 'quit' }`                                                                                                                                      | 有未儲存的分頁時，使用者關閉視窗或結束 App                             |

訂閱方式：`const off = window.hachi.on('workspace:changed', (ws) => …)`，呼叫 `off()` 取消訂閱。

## 原生選單

| 選單                       | 項目                                    | 快捷鍵                                 | 行為                                                                      |
| -------------------------- | --------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Hachi（僅 macOS）          | About Hachi / Services / Hide / Quit    | 系統預設                               | role                                                                      |
|                            | Settings…                               | `CmdOrCtrl+,`                          | `menu:command` → `app.settings`（App 設定：Proxy）                        |
| File                       | New Workspace…                          | `CmdOrCtrl+Shift+N`                    | `menu:command` → `workspace.new`                                          |
|                            | Open Workspace…                         | `CmdOrCtrl+O`                          | `menu:command` → `workspace.open`（先詢問未儲存的分頁，再開資料夾對話框） |
|                            | Open Recent ▸                           | —                                      | `menu:command` → `workspace.openRecent`（含 `path`）                      |
|                            | Switch Workspace…                       | —                                      | `menu:command` → `workspace.switch`                                       |
|                            | Save                                    | `CmdOrCtrl+S`                          | `menu:command` → `request.save`（儲存目前分頁；未儲存的新請求會詢問位置） |
|                            | Close Tab                               | `CmdOrCtrl+W`                          | `menu:command` → `tab.close`（關閉目前分頁；沒有分頁時關閉視窗）          |
|                            | Settings…（僅 Windows / Linux）         | `CmdOrCtrl+,`                          | `menu:command` → `app.settings`                                           |
|                            | Close Window（macOS）/ Exit（其他平台） | `CmdOrCtrl+Shift+W`（macOS）/ 系統預設 | role                                                                      |
| Edit / View / Window       | 標準 role 選單                          | 系統預設                               | —                                                                         |
| Help（僅 Windows / Linux） | About Hachi                             | —                                      | 訊息對話框                                                                |

平台差異集中在 `src/main/platform/`（`darwin.ts`、`default.ts`）。

## 新增 channel 的流程

1. `channels.ts` 的 `INVOKE`（或 `EVENTS`）加入名稱。
2. `api.ts` 的 `InvokeMap` 加入輸入 / 輸出型別，並在 `HachiApi` 加入方法（缺漏會編譯失敗）。
3. `contract.ts` 的 `inputSchemas` 加入 zod schema（缺漏或型別不符會編譯失敗）。
4. `register.ts` 的 handler map 加入實作（缺漏會編譯失敗）。
5. `preload/index.ts` 暴露方法。
6. 更新本文件。

> 發送 / 取消請求**刻意不設鍵盤快捷鍵**（Phase 2 決定，避免誤觸）；也**不提供 CmdOrCtrl+T**（決策 43），新分頁用分頁列的「+」。
