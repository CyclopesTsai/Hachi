# Hachi IPC 介面

> 版本：Phase 4。後續每個 Phase 新增或修改 channel 時，必須同步更新本文件。
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

| Channel                           | `window.hachi`                           | 輸入                                                                                                                                                                      | 輸出                                                                                        | 說明                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app:getInfo`                     | `app.getInfo()`                          | —                                                                                                                                                                         | `AppInfo`                                                                                   | 名稱、版本、appId、平台、是否已打包                                                                                                                                                                                                                                                                                                                                                          |
| `app:reveal`                      | `app.reveal(input)`                      | `{ itemId }`（`null` = Workspace 資料夾）                                                                                                                                 | `void`                                                                                      | 在 Finder / 檔案總管中顯示：Workspace、Collection、資料夾開啟該資料夾（`shell.openPath`），請求在所在資料夾中選取檔案（`shell.showItemInFolder`）                                                                                                                                                                                                                                            |
| `app:getDefaultWorkspaceDir`      | `app.getDefaultWorkspaceDir()`           | —                                                                                                                                                                         | `string`                                                                                    | 預設 Workspace 上層目錄：`<Documents>/Hachi`                                                                                                                                                                                                                                                                                                                                                 |
| `app:setCloseGuard`               | `app.setCloseGuard(input)`               | `{ dirty: boolean }`                                                                                                                                                      | `void`                                                                                      | 有未儲存的分頁時設為 `true`：關閉視窗 / 結束 App 會先送 `app:closeRequested` 讓 renderer 詢問                                                                                                                                                                                                                                                                                                |
| `app:confirmClose`                | `app.confirmClose()`                     | —                                                                                                                                                                         | `void`                                                                                      | renderer 處理完 `app:closeRequested` 後呼叫，main 才真正關閉視窗或結束 App                                                                                                                                                                                                                                                                                                                   |
| `config:get`                      | `config.get()`                           | —                                                                                                                                                                         | `AppConfig`                                                                                 | 讀取 app-config（記憶體中的版本）                                                                                                                                                                                                                                                                                                                                                            |
| `config:update`                   | `config.update(input)`                   | `{ theme?, proxy?: ProxySettings, ui?: { requestBodyWrap?, responseBodyWrap? }, history?: { maxEntries: 50..1000 }, websocket?: { messageLimit: 10..5000 } }`             | `AppConfig`                                                                                 | Renderer 只能修改使用者偏好（主題、Proxy、顯示偏好）；recent / window 狀態由 main 維護。`ui` 只更新有傳的鍵；`history.maxEntries` 調小時立即刪除所有 Workspace 中最舊的歷史紀錄                                                                                                                                                                                                              |
| `workspace:getCurrent`            | `workspace.getCurrent()`                 | —                                                                                                                                                                         | `WorkspaceInfo \| null`                                                                     | 目前開啟的 Workspace                                                                                                                                                                                                                                                                                                                                                                         |
| `workspace:create`                | `workspace.create(input)`                | `{ name: string(1..100, trim), parentDir: 絕對路徑 }`                                                                                                                     | `WorkspaceInfo`                                                                             | 在 `parentDir/<淨化後名稱>` 建立 Workspace 並開啟。目標已是 Workspace → `ALREADY_EXISTS`；非空資料夾 → `DIR_NOT_EMPTY`                                                                                                                                                                                                                                                                       |
| `workspace:open`                  | `workspace.open(input)`                  | `{ path: 絕對路徑 }`                                                                                                                                                      | `WorkspaceInfo`                                                                             | 開啟並設為目前 Workspace，更新最近清單                                                                                                                                                                                                                                                                                                                                                       |
| `workspace:openWithDialog`        | `workspace.openWithDialog()`             | —                                                                                                                                                                         | `WorkspaceInfo \| null`                                                                     | 顯示原生資料夾選擇器後開啟；取消回傳 `null`                                                                                                                                                                                                                                                                                                                                                  |
| `workspace:listRecent`            | `workspace.listRecent()`                 | —                                                                                                                                                                         | `RecentWorkspaceEntry[]`                                                                    | 最近開啟清單（含 `exists` 旗標）                                                                                                                                                                                                                                                                                                                                                             |
| `workspace:removeRecent`          | `workspace.removeRecent(input)`          | `{ path: 絕對路徑 }`                                                                                                                                                      | `RecentWorkspaceEntry[]`                                                                    | 從最近清單移除（不刪除磁碟資料）                                                                                                                                                                                                                                                                                                                                                             |
| `workspace:rename`                | `workspace.rename(input)`                | `{ name: string(1..100, trim) }`                                                                                                                                          | `WorkspaceInfo`                                                                             | 重新命名目前 Workspace：只改 `workspace.json` 的 `name`，資料夾不變。無開啟中 Workspace → `NO_WORKSPACE`                                                                                                                                                                                                                                                                                     |
| `workspace:delete`                | `workspace.delete(input)`                | `{ path: 絕對路徑 }`                                                                                                                                                      | `RecentWorkspaceEntry[]`                                                                    | 把 Workspace 資料夾移到系統垃圾桶並從最近清單移除。只接受目前或最近清單中的 Workspace（否則 `FORBIDDEN`），且資料夾內必須有 `workspace.json`（否則 `NOT_A_WORKSPACE`）。刪除目前 Workspace 時會先關閉它（觸發 `workspace:changed` = `null`）                                                                                                                                                 |
| `workspace:getSettings`           | `workspace.getSettings()`                | —                                                                                                                                                                         | `WorkspaceSettings`                                                                         | 目前 Workspace 的請求預設值（timeout、SSL、重新導向）                                                                                                                                                                                                                                                                                                                                        |
| `workspace:saveSettings`          | `workspace.saveSettings(input)`          | `WorkspaceSettings`                                                                                                                                                       | `WorkspaceSettings`                                                                         | 寫回 `workspace.json` 的 `settings`                                                                                                                                                                                                                                                                                                                                                          |
| `workspace:setScriptTrust`        | `workspace.setScriptTrust(input)`        | `{ trusted: boolean }`                                                                                                                                                    | `AppConfig`                                                                                 | 信任（或取消信任）目前 Workspace 的腳本，記在 `app-config.json` 的 `scripts.trustedWorkspaces`（決策 84）                                                                                                                                                                                                                                                                                    |
| `dialog:selectDirectory`          | `dialog.selectDirectory(input)`          | `{ title?: string(≤200), defaultPath?: 絕對路徑 }`                                                                                                                        | `string \| null`                                                                            | 原生資料夾選擇器；取消回傳 `null`                                                                                                                                                                                                                                                                                                                                                            |
| `dialog:selectFile`               | `dialog.selectFile(input)`               | `{ title?: string(≤200) }`                                                                                                                                                | `string \| null`                                                                            | 原生檔案選擇器（Form-data 檔案欄位用）；取消回傳 `null`                                                                                                                                                                                                                                                                                                                                      |
| `dialog:saveTextFile`             | `dialog.saveTextFile(input)`             | `{ title?, defaultName: string(1..200), content: string }`                                                                                                                | `string \| null`                                                                            | 存檔對話框（預設在「下載」），寫入 UTF-8 文字（WebSocket 訊息匯出用）；取消回傳 `null`                                                                                                                                                                                                                                                                                                       |
| `tree:get`                        | `tree.get()`                             | —                                                                                                                                                                         | `WorkspaceTree`                                                                             | 目前 Workspace 的 Collection 樹（會等待進行中的操作完成）                                                                                                                                                                                                                                                                                                                                    |
| `tree:reload`                     | `tree.reload(input)`                     | `{ scope: 'workspace' } \| { scope: 'item', id }`                                                                                                                         | `WorkspaceTree`                                                                             | 重新讀取在 Hachi 以外修改的檔案。`workspace`：整個樹 + `workspace.json`；`item`：只重讀該項目（請求、資料夾或整個 Collection 及其內容），樹的其他部分不變。檔案已不存在的項目會從樹上移除                                                                                                                                                                                                    |
| `item:create`                     | `item.create(input)`                     | `ItemCreateInput`                                                                                                                                                         | `ItemMutationResult`                                                                        | 新增 Collection（`parentId: null`）/ 資料夾 / 請求，加到父層 `order` 最後                                                                                                                                                                                                                                                                                                                    |
| `item:rename`                     | `item.rename(input)`                     | `{ id, name: string(1..100, trim) }`                                                                                                                                      | `WorkspaceTree`                                                                             | 改名並同步改檔名 / 資料夾名（slug，衝突時加 `-2`…）；id 不變                                                                                                                                                                                                                                                                                                                                 |
| `item:duplicate`                  | `item.duplicate(input)`                  | `{ id }`                                                                                                                                                                  | `ItemMutationResult`                                                                        | 複製到原項目正下方，名稱為 `<名稱> copy`、`<名稱> copy 2`…；資料夾 / Collection 深層複製，所有項目都產生新 id                                                                                                                                                                                                                                                                                |
| `item:delete`                     | `item.delete(input)`                     | `{ id }`                                                                                                                                                                  | `WorkspaceTree`                                                                             | 移到系統垃圾桶，並從父層 `order` 移除。無法讀取的項目也可刪除                                                                                                                                                                                                                                                                                                                                |
| `item:move`                       | `item.move(input)`                       | `{ id, parentId: id \| null, index: int ≥ 0 }`                                                                                                                            | `WorkspaceTree`                                                                             | 拖曳排序 / 移動。`parentId: null` 只適用於 Collection；跨父層移動時檔案會搬到新資料夾。不可移進自己或子孫（`INVALID_OPERATION`）                                                                                                                                                                                                                                                             |
| `request:get`                     | `request.get(input)`                     | `{ id }`                                                                                                                                                                  | `RequestData`（`request` 為 `HttpRequest \| WsRequest`，以 `type` 區分）                    | HTTP 請求的完整內容（缺少的欄位補預設值）與繼承的 Headers / Auth。WebSocket 請求 → `INVALID_OPERATION`                                                                                                                                                                                                                                                                                       |
| `request:save`                    | `request.save(input)`                    | `{ id, request: HttpRequest \| WsRequest }`                                                                                                                               | `{ request, tree }`                                                                         | 寫回請求檔。磁碟上的 `id`、`name`、`type` 不會被改（改名請用 `item:rename`）；檔案中未知的欄位保留；`type` 必須與檔案相同                                                                                                                                                                                                                                                                    |
| `request:saveAs`                  | `request.saveAs(input)`                  | `{ parentId: id, name: string(1..100), request: HttpRequest \| WsRequest }`                                                                                               | `{ id, request, tree }`                                                                     | 把未儲存的分頁（新請求 / 歷史 / 已刪除項目）存成新的請求檔                                                                                                                                                                                                                                                                                                                                   |
| `request:getInherited`            | `request.getInherited(input)`            | `{ parentId: id \| null }`                                                                                                                                                | `InheritedSettings`                                                                         | 放在 `parentId` 內的項目會沿用的 Headers / Auth（未儲存分頁、項目被移動後使用）                                                                                                                                                                                                                                                                                                              |
| `container:get`                   | `container.get(input)`                   | `{ id }`                                                                                                                                                                  | `ContainerSettingsData`                                                                     | Collection / 資料夾的共用 Headers、Auth、腳本（決策 126，含 Collection 的 `scriptFlow`）與繼承內容                                                                                                                                                                                                                                                                                           |
| `container:save`                  | `container.save(input)`                  | `{ id, headers: KeyValue[], auth: Auth, variables: Variable[], scripts: RequestScripts, scriptFlow: 'sequential' \| 'sandwich' }`                                         | `ContainerSettingsData`                                                                     | 寫回 `collection.json` / `folder.json`。Collection 的 `inherit` 會存成 `none`；Collection 變數（資料夾忽略），機密值寫入 `.hachi-secrets.json`；`scripts` 存進 `collection.json` / `folder.json`，`scriptFlow` 只對 Collection 有效                                                                                                                                                          |
| `http:send`                       | `http.send(input)`                       | `{ runId, requestId: id \| null, parentId: id \| null, environmentId: id \| null, request: HttpRequest, skipScripts?: boolean }`                                          | `HttpResult`                                                                                | 在 main 以 undici 發送**編輯器目前的內容**（含未儲存的修改）；`requestId` 用來找出上層的 Headers / Auth。連線失敗等網路錯誤以 `{ kind: 'error' }` 回傳，不是 IPC 錯誤。發送前在 main 以「暫存 > 環境 > Collection」替換 `{{變數}}`（見「變數替換」），並記錄到歷史紀錄（取消的請求不記錄）                                                                                                   |
| `http:cancel`                     | `http.cancel(input)`                     | `{ runId }`                                                                                                                                                               | `boolean`                                                                                   | 取消進行中的請求；已結束回傳 `false`                                                                                                                                                                                                                                                                                                                                                         |
| `http:getBody`                    | `http.getBody(input)`                    | `{ runId }`                                                                                                                                                               | `string`                                                                                    | 取得超過 10 MB、未直接回傳的回應內容。main 只保留最近 20 個回應（合計 300 MB），過期 → `NOT_FOUND`                                                                                                                                                                                                                                                                                           |
| `http:saveResponse`               | `http.saveResponse(input)`               | `{ runId }`                                                                                                                                                               | `string \| null`                                                                            | 顯示原生存檔對話框（預設檔名依 URL 與 Content-Type）並寫入回應內容；取消回傳 `null`                                                                                                                                                                                                                                                                                                          |
| `http:resolve`                    | `http.resolve(input)`                    | `HttpResolveInput`：`{ parentId, environmentId, request, revealSecrets }`                                                                                                 | `HttpResolveResult`：`{ request: CodegenRequest, urlError, unresolvedVariables, authNote }` | 程式碼產生用（不發送）：與發送相同的變數替換與 Headers / Auth 繼承；`revealSecrets: false` 時機密變數保留 `{{name}}`；Basic auth 另外放在 `basicAuth`；不含 Hachi 自動加的 User-Agent / Accept；網址無效時 `urlError` 有值、`request.url` 為原輸入；OAuth 2.0 有有效 Token 時放進 `Authorization`，沒有 Token、Digest、AWS Signature 時 `authNote` 說明程式碼中沒有驗證資訊                  |
| `auth:oauth2Status`               | `auth.oauth2Status(input)`               | `{ parentId, environmentId, auth: OAuth2Auth }`                                                                                                                           | `OAuth2TokenStatus`                                                                         | 決策 128：這組 OAuth 2.0 設定（以 `parentId` 的變數替換後）在記憶體中的 Token 狀態：`none` / `valid` / `expired`、到期時間、能否自動更新                                                                                                                                                                                                                                                     |
| `auth:oauth2Obtain`               | `auth.oauth2Obtain(input)`               | 同上                                                                                                                                                                      | `OAuth2TokenStatus`                                                                         | 「取得 Token」：Client Credentials / Password 直接向 Access Token URL 取得；Authorization Code 開系統瀏覽器、在本機 Callback 等待（最多 5 分鐘）再換 Token。失敗時回傳錯誤（訊息含伺服器的 `error` / `error_description`）                                                                                                                                                                   |
| `auth:oauth2Cancel`               | `auth.oauth2Cancel(input)`               | 同上                                                                                                                                                                      | `boolean`                                                                                   | 停止等待瀏覽器授權                                                                                                                                                                                                                                                                                                                                                                           |
| `auth:oauth2Clear`                | `auth.oauth2Clear(input)`                | 同上                                                                                                                                                                      | `void`                                                                                      | 清除這組設定的 Token                                                                                                                                                                                                                                                                                                                                                                         |
| `cookies:list`                    | `cookies.list()`                         | —                                                                                                                                                                         | `StoredCookie[]`                                                                            | 決策 129：目前 Workspace 的 Cookie Jar（未過期的），依網域排序；沒有開啟 Workspace 時為空                                                                                                                                                                                                                                                                                                    |
| `cookies:delete`                  | `cookies.delete(input)`                  | `{ name, domain, path }`                                                                                                                                                  | `void`                                                                                      | 刪除一個 Cookie                                                                                                                                                                                                                                                                                                                                                                              |
| `cookies:clear`                   | `cookies.clear(input)`                   | `{ domain: string \| null }`                                                                                                                                              | `void`                                                                                      | 清除一個網域的 Cookie，`null` 清除全部                                                                                                                                                                                                                                                                                                                                                       |
| `git:status`                      | `git.status()`                           | —                                                                                                                                                                         | `GitStatus`                                                                                 | 目前 Workspace 的 Git 狀態：`no-git`（找不到 git）/ `not-repo` / `repo`（repo 根目錄、分支或 detached 的 commit、upstream、領先 / 落後、**Workspace 內**的變更檔案）                                                                                                                                                                                                                         |
| `git:init`                        | `git.init()`                             | —                                                                                                                                                                         | `GitStatus`                                                                                 | 在 Workspace 資料夾執行 `git init`（第一個分支 main）                                                                                                                                                                                                                                                                                                                                        |
| `git:identity`                    | `git.identity()`                         | —                                                                                                                                                                         | `GitIdentity \| null`                                                                       | git 會用的 user.name / user.email；缺任一個時為 `null`（commit 前先詢問）                                                                                                                                                                                                                                                                                                                    |
| `git:setIdentity`                 | `git.setIdentity(input)`                 | `{ name, email, global }`                                                                                                                                                 | `void`                                                                                      | 寫入這個 repo（`--local`）或這台電腦（`--global`）的 user.name / user.email                                                                                                                                                                                                                                                                                                                  |
| `git:commit`                      | `git.commit(input)`                      | `{ paths, message }`（paths 必須是狀態中列出的變更）                                                                                                                      | `GitStatus`                                                                                 | `git add -A -- paths` 後 `git commit -m message -- paths`：只 commit 這些檔案                                                                                                                                                                                                                                                                                                                |
| `git:discard`                     | `git.discard(input)`                     | `{ path }`                                                                                                                                                                | `GitStatus`                                                                                 | 還原一個檔案：已追蹤的檔案用 `git restore --source=HEAD --staged --worktree`，新檔案移到垃圾桶；衝突的檔案不行                                                                                                                                                                                                                                                                               |
| `git:diff`                        | `git.diff(input)`                        | `{ path }`                                                                                                                                                                | `GitFileDiff`                                                                               | 變更檔案在最後一次 commit（`git show HEAD:<path>`，更名用舊路徑）與目前磁碟上的內容；新檔案 `before` 為 `null`、刪除的 `after` 為 `null`；**衝突的檔案**（`conflict: true`）改為我的版本（stage 2，`git show :2:<path>`）與遠端的版本（stage 3），不含衝突標記；超過 2 MB（`tooLarge`）或含 NUL（`binary`）不回傳內容                                                                        |
| `git:branches`                    | `git.branches()`                         | —                                                                                                                                                                         | `GitBranch[]`                                                                               | 本機與遠端分支（不含 `origin/HEAD`）                                                                                                                                                                                                                                                                                                                                                         |
| `git:switch`                      | `git.switch(input)`                      | `{ name, remote }`                                                                                                                                                        | `GitStatus`                                                                                 | 切換分支；遠端分支沒有同名本機分支時建立追蹤分支（`switch -c x --track origin/x`）                                                                                                                                                                                                                                                                                                           |
| `git:createBranch`                | `git.createBranch(input)`                | `{ name }`                                                                                                                                                                | `GitStatus`                                                                                 | 檢查名稱（`check-ref-format --branch`）後從目前位置建立並切換                                                                                                                                                                                                                                                                                                                                |
| `git:remote`                      | `git.remote()`                           | —                                                                                                                                                                         | `GitRemote \| null`                                                                         | push / pull 用的遠端（origin，沒有時取第一個）與網址                                                                                                                                                                                                                                                                                                                                         |
| `git:setRemote`                   | `git.setRemote(input)`                   | `{ url }`（不可以 `-` 開頭、不可有空白）                                                                                                                                  | `GitStatus`                                                                                 | 設定 origin 的網址（沒有就新增）                                                                                                                                                                                                                                                                                                                                                             |
| `git:fetch`                       | `git.fetch()`                            | —                                                                                                                                                                         | `GitStatus`                                                                                 | `git fetch --all --prune`（需要帳密時經 askpass 詢問）                                                                                                                                                                                                                                                                                                                                       |
| `git:pull`                        | `git.pull()`                             | —                                                                                                                                                                         | `GitStatus`                                                                                 | `git -c pull.rebase=false pull --no-edit`（merge）；**衝突不是錯誤**：回傳 `merging: true` 與 `conflicted` 檔案。沒有 upstream 或合併中時錯誤                                                                                                                                                                                                                                                |
| `git:push`                        | `git.push()`                             | —                                                                                                                                                                         | `GitStatus`                                                                                 | 有 upstream 時 `git push`，沒有時 `git push -u <origin> HEAD`；被拒絕（遠端有新 commit）時提示先 Pull                                                                                                                                                                                                                                                                                        |
| `git:resolve`                     | `git.resolve(input)`                     | `{ path, how }`（`ours` \| `theirs` \| `resolved`）                                                                                                                       | `GitStatus`                                                                                 | 衝突的檔案：`checkout --ours/--theirs` 後 `add`（那一邊刪除了檔案時 `rm`）；`resolved` 會先檢查檔案中沒有 `<<<<<<<` / `>>>>>>>` 衝突標記                                                                                                                                                                                                                                                     |
| `git:abortMerge`                  | `git.abortMerge()`                       | —                                                                                                                                                                         | `GitStatus`                                                                                 | `git merge --abort`                                                                                                                                                                                                                                                                                                                                                                          |
| `git:finishMerge`                 | `git.finishMerge()`                      | —                                                                                                                                                                         | `GitStatus`                                                                                 | 衝突都解決後 `git commit --no-edit`（git 預設的合併訊息）                                                                                                                                                                                                                                                                                                                                    |
| `git:openFile`                    | `git.openFile(input)`                    | `{ path }`（狀態中的檔案）                                                                                                                                                | `void`                                                                                      | 用系統預設的程式開啟檔案（手動解決衝突）                                                                                                                                                                                                                                                                                                                                                     |
| `git:answerPrompt`                | `git.answerPrompt(input)`                | `{ id, value }`（`value` 為 `null` = 取消）                                                                                                                               | `void`                                                                                      | 回覆 `git:prompt` 事件                                                                                                                                                                                                                                                                                                                                                                       |
| `git:log`                         | `git.log(input)`                         | `{ skip }`                                                                                                                                                                | `GitLog`                                                                                    | **整個 repo 所有分支**的 commit（`git log --decorate=full --date-order --exclude=refs/stash --all`），新的在前，每頁 300 個；每個 commit 附作者、時間、上一個 commit、分支 / 遠端分支 / tag 標籤                                                                                                                                                                                             |
| `git:commitDetail`                | `git.commitDetail(input)`                | `{ hash }`（7–64 位 16 進位）                                                                                                                                             | `GitCommitDetail`                                                                           | 完整訊息與改到的檔案（相對於第一個上一個 commit；`--name-status -M`），Workspace 內的檔案在前、附 Workspace 相對路徑，其他標 `inWorkspace: false`                                                                                                                                                                                                                                            |
| `git:commitDiff`                  | `git.commitDiff(input)`                  | `{ hash, path }`（repo 相對路徑，必須是這個 commit 改到的檔案）                                                                                                           | `GitFileDiff`                                                                               | 這個 commit 前後的檔案內容（上一個 commit / 這個 commit；更名用舊路徑；限制同 `git:diff`）                                                                                                                                                                                                                                                                                                   |
| `transfer:importFile`             | `transfer.importFile()`                  | —                                                                                                                                                                         | `ImportReport \| null`                                                                      | 開啟原生檔案對話框，匯入 Postman Collection（v2.0 / v2.1）、Environment 或 Bruno 匯出的 Collection JSON；取消時為 `null`。需要已開啟 Workspace                                                                                                                                                                                                                                               |
| `transfer:importText`             | `transfer.importText(input)`             | `{ fileName, text }`（text 最多 50 MB）                                                                                                                                   | `ImportReport`                                                                              | 匯入檔案內容（拖放到視窗的檔案，由 renderer 以 `File.text()` 讀取）；格式判斷與規則同上                                                                                                                                                                                                                                                                                                      |
| `transfer:importBrunoFolder`      | `transfer.importBrunoFolder()`           | —                                                                                                                                                                         | `BrunoFolderResult \| null`                                                                 | 開啟資料夾對話框。所選資料夾是 Collection（`bruno.json` 或 `opencollection.yml`）或 Collection 裡的子資料夾時直接匯入（`kind: imported`）；裡面有多個 Collection 時回傳清單（`kind: choose`），main 記住這次掃描。讀取 `.bru` / `.yml` / `bruno.json`，略過 `node_modules` 與 `.` 開頭的資料夾；每個 Collection 最多 5000 個檔案、共 50 MB；環境命名為「Collection / 環境」。取消時為 `null` |
| `transfer:importBrunoCollections` | `transfer.importBrunoCollections(input)` | `{ scanId, paths }`（`paths` 1–200 個，必須是該次掃描找到的）                                                                                                             | `ImportOutcome[]`                                                                           | 匯入使用者勾選的 Collection；每次掃描只能用一次（過期時 `INVALID_OPERATION`，不在清單中的路徑 `VALIDATION_ERROR`）                                                                                                                                                                                                                                                                           |
| `transfer:export`                 | `transfer.export(input)`                 | `{ id, format, environmentId }`（`format`：`postman` \| `bruno`（.bru）\| `bruno-yaml` \| `openapi-html` \| `openapi-json`；`environmentId` 只用於 OpenAPI，可為 `null`） | `ExportResult \| null`                                                                      | 匯出 Collection（決策 105）：Postman / OpenAPI 先顯示儲存對話框（預設 `下載/<slug>.postman_collection.json`、`<slug>.html`、`<slug>.openapi.json`）；Bruno 先選資料夾，在裡面建立 `<Collection 名稱>/`（重名加 `-2`）。取消時為 `null`。只接受 Collection                                                                                                                                    |
| `env:list`                        | `env.list()`                             | —                                                                                                                                                                         | `EnvironmentSummary[]`                                                                      | 目前 Workspace 的環境（依名稱排序）；無法讀取的檔案帶 `error`，只能刪除                                                                                                                                                                                                                                                                                                                      |
| `env:get`                         | `env.get(input)`                         | `{ id }`                                                                                                                                                                  | `EnvironmentData`                                                                           | 環境內容，機密值從 `.hachi-secrets.json` 合併回來                                                                                                                                                                                                                                                                                                                                            |
| `env:create`                      | `env.create(input)`                      | `{ name: string(1..100) }`                                                                                                                                                | `{ id, list }`                                                                              | 建立 `environments/<slug>.json`                                                                                                                                                                                                                                                                                                                                                              |
| `env:save`                        | `env.save(input)`                        | `{ id, name, variables: Variable[] }`                                                                                                                                     | `EnvironmentData`                                                                           | 機密值寫入 `.hachi-secrets.json`，環境檔中留空；改名時一併改檔名                                                                                                                                                                                                                                                                                                                             |
| `env:duplicate`                   | `env.duplicate(input)`                   | `{ id }`                                                                                                                                                                  | `{ id, list }`                                                                              | 「<名稱> copy」，新 id，機密值一併複製                                                                                                                                                                                                                                                                                                                                                       |
| `env:delete`                      | `env.delete(input)`                      | `{ id }`                                                                                                                                                                  | `EnvironmentSummary[]`                                                                      | 環境檔移到系統垃圾桶（機密值保留，方便從垃圾桶還原）                                                                                                                                                                                                                                                                                                                                         |
| `history:list`                    | `history.list()`                         | —                                                                                                                                                                         | `{ entries: HttpHistoryEntry[], usage: HistoryUsage }`                                      | 目前 Workspace 的歷史紀錄（新的在前）                                                                                                                                                                                                                                                                                                                                                        |
| `history:delete`                  | `history.delete(input)`                  | `{ id }`                                                                                                                                                                  | `HistoryUsage`                                                                              | 刪除一筆                                                                                                                                                                                                                                                                                                                                                                                     |
| `history:clear`                   | `history.clear()`                        | —                                                                                                                                                                         | `HistoryUsage`                                                                              | 清除目前 Workspace 的全部紀錄                                                                                                                                                                                                                                                                                                                                                                |
| `history:getUsage`                | `history.getUsage()`                     | —                                                                                                                                                                         | `HistoryUsage`                                                                              | 所有 Workspace 共用的筆數上限與使用量（視窗角落的圓餅圖）                                                                                                                                                                                                                                                                                                                                    |
| `runner:start`                    | `runner.start(input)`                    | `{ runId, config: RunnerConfig }`                                                                                                                                         | `{ totalRounds, items: RunnerItem[], skipped: string[], progress: RunnerProgress }`         | 開始 Collection Runner（Phase 5c）：在 main 背景執行，進度以 `runner:event` 推送。執行**已儲存的檔案**；WebSocket / 無法讀取的項目略過。有腳本且 Workspace 未信任、又沒有 `skipScripts` 時回傳 `INVALID_OPERATION`                                                                                                                                                                           |
| `runner:cancel`                   | `runner.cancel(input)`                   | `{ runId }`                                                                                                                                                               | `boolean`                                                                                   | 停止執行（中止進行中的請求）；已結束時為 false                                                                                                                                                                                                                                                                                                                                               |
| `runner:rows`                     | `runner.rows(input)`                     | `{ runId, offset, limit ≤ 1000, failedOnly }`                                                                                                                             | `{ total, rows: RunnerRow[] }`                                                              | 結果列表的一頁                                                                                                                                                                                                                                                                                                                                                                               |
| `runner:row`                      | `runner.row(input)`                      | `{ runId, index }`                                                                                                                                                        | `RunnerRowDetail \| null`                                                                   | 一筆的 Headers / Body / 腳本結果 / 資料列；沒有保留細節時為 null                                                                                                                                                                                                                                                                                                                             |
| `runner:export`                   | `runner.export(input)`                   | `{ runId, format: 'json' \| 'html' }`                                                                                                                                     | `string \| null`                                                                            | 儲存對話框（預設 `下載/runner-<時間>.json` / `.html`）。JSON：設定、統計與所有結果列；HTML：單一離線報告（決策 130）                                                                                                                                                                                                                                                                         |
| `runner:discard`                  | `runner.discard(input)`                  | `{ runId }`                                                                                                                                                               | `void`                                                                                      | 關閉分頁 / 重新執行時丟棄結果（執行中會先停止）                                                                                                                                                                                                                                                                                                                                              |
| `runner:pickDataFile`             | `runner.pickDataFile()`                  | —                                                                                                                                                                         | `RunnerDataFile \| null`                                                                    | 選擇 CSV / JSON 資料檔（上限 10 MB、10,000 列），在 main 解析後回傳 `{ fileName, columns, rows }`                                                                                                                                                                                                                                                                                            |
| `runtime:list`                    | `runtime.list()`                         | —                                                                                                                                                                         | `RuntimeVariable[]`                                                                         | 目前 Workspace 的暫存變數 `{ name, value }`（決策 71，只在記憶體）                                                                                                                                                                                                                                                                                                                           |
| `runtime:delete`                  | `runtime.delete(input)`                  | `{ name }`                                                                                                                                                                | `RuntimeVariable[]`                                                                         | 刪除一個暫存變數                                                                                                                                                                                                                                                                                                                                                                             |
| `runtime:clear`                   | `runtime.clear()`                        | —                                                                                                                                                                         | `RuntimeVariable[]`                                                                         | 清除目前 Workspace 的所有暫存變數                                                                                                                                                                                                                                                                                                                                                            |
| `session:get`                     | `session.get()`                          | —                                                                                                                                                                         | `SessionData`                                                                               | 目前 Workspace 在這台電腦上次開啟的分頁與環境                                                                                                                                                                                                                                                                                                                                                |
| `session:save`                    | `session.save(input)`                    | `SessionData`                                                                                                                                                             | `void`                                                                                      | renderer 在分頁 / 環境改變後（300 ms 去抖動）寫入                                                                                                                                                                                                                                                                                                                                            |
| `ws:connect`                      | `ws.connect(input)`                      | `WsConnectInput`                                                                                                                                                          | `{ unresolvedVariables: string[] }`                                                         | 開始連線；狀態與訊息以 `ws:event` 推送。`connectionId` 由 renderer 產生，每次連線都是新的                                                                                                                                                                                                                                                                                                    |
| `ws:send`                         | `ws.send(input)`                         | `{ connectionId, parentId, environmentId, format: text \| json \| binary-hex \| binary-base64, content }`                                                                 | `{ unresolvedVariables }`                                                                   | 送出訊息；`{{變數}}` 在此時替換。Hex / Base64 格式錯誤回傳 `VALIDATION_ERROR`；未連線回傳 `INVALID_OPERATION`                                                                                                                                                                                                                                                                                |
| `ws:ping`                         | `ws.ping(input)`                         | `{ connectionId }`                                                                                                                                                        | `void`                                                                                      | 送出 Ping frame，收到 Pong 時在 `ws:event` 附上延遲                                                                                                                                                                                                                                                                                                                                          |
| `ws:disconnect`                   | `ws.disconnect(input)`                   | `{ connectionId, code?: 1000 \| 3000–4999, reason?: string(≤123) }`                                                                                                       | `boolean`                                                                                   | 關閉連線（連線中則中止）；沒有這個連線時回傳 `false`                                                                                                                                                                                                                                                                                                                                         |

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
// HistoryEntry（HTTP / WebSocket）的格式見 docs/schema.md「history.json」

// ---- Phase 4：WebSocket（src/shared/ws.ts、src/shared/schemas/ws-request.ts）----
interface WsConnectInput {
  connectionId: string
  requestId: string | null // 記錄到歷史紀錄用；未儲存的分頁為 null
  parentId: string | null // 沿用 Headers / Auth 與 Collection 變數的來源
  environmentId: string | null
  request: WsRequest // 變數未替換
}
interface WsEventPayload {
  connectionId: string
  state?: WsConnState // 狀態有變化時才有
  entries: WsLogEntry[] // 50 ms 內累積的紀錄
}
interface WsConnState {
  status: 'connecting' | 'open' | 'closing' | 'closed' | 'error'
  url: string // 實際連線的網址（變數已替換）
  protocol?: string // 伺服器選擇的子協定
  openedAt?: number
  closeCode?: number
  closeReason?: string
  error?: string
}
type WsLogEntry =
  | {
      kind: 'message'
      seq: number
      time: number // epoch ms
      direction: 'sent' | 'received'
      binary: boolean
      data: string // 文字；Binary 為 Base64
      size: number // bytes
      heartbeat?: boolean // 文字心跳
    }
  | {
      kind: 'event'
      seq: number
      time: number
      event: 'connecting' | 'open' | 'closed' | 'error' | 'ping' | 'pong'
      direction?: 'sent' | 'received' // ping / pong
      url?: string
      protocol?: string
      code?: number
      reason?: string
      message?: string // 錯誤訊息；"user" = 使用者中斷
      latencyMs?: number // 我們送出的 Ping 的往返時間
      heartbeat?: boolean
    }
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
    | 'SCRIPT' // Pre-request 腳本錯誤，或 Workspace 腳本未信任
    | 'AUTH' // OAuth 2.0 取得 Token 失敗、AWS Signature 欄位不足（決策 128）
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
- **Auth**：`inherit` 取最近一層不是 `inherit` 的設定；Bearer / Basic 只在沒有手動設定 `Authorization` 時加入；API Key 可加在 Header 或 Query。決策 128：
  - **OAuth 2.0**：送出前取得 Token（記憶體中有效的直接用；過期且有 refresh token 時自動更新；Client Credentials / Password 沒有 Token 時自動取得；Authorization Code 要先在 Auth 分頁按「取得 Token」），以 `Authorization: <Header 前綴> <token>` 送出。Token 以「替換變數後的設定」為 key（secret 只以雜湊參與），只存在記憶體。Token 端點用 Workspace 的逾時 / SSL 與 App Proxy。Authorization Code 使用 PKCE（S256，可關閉）與 `state`，Callback 只接受 `http://127.0.0.1`、`localhost`、`[::1]`（空白 = `http://127.0.0.1:<自動選擇的埠>/callback`）。WebSocket 也會帶上 OAuth 2.0 Token。
  - **Digest**：先照常送出，回應 401 且有 Digest challenge 時（MD5 / SHA-256 與 `-sess`，qop `auth` 或沒有 qop）計算後再送一次。
  - **AWS Signature v4**：簽署 `host`、`content-type` 與所有 `x-amz-*` Header；S3 另加 `x-amz-content-sha256`（form-data Body 為 `UNSIGNED-PAYLOAD`），其他服務不能簽 form-data Body。有 Session Token 時加 `x-amz-security-token`。
  - Digest / AWS Signature 只用於 HTTP（WebSocket 的類型選單沒有這兩項）。
- **Cookie Jar**（決策 129）：請求 `settings.useCookieJar`（預設開）時，送出前依網域 / 路徑 / Secure / 到期加上 Workspace Cookie Jar 中符合的 Cookie（手動輸入的 `Cookie` Header 同名者優先），回應的 `Set-Cookie` 自動保存。使用 Jar 時重新導向由 Hachi 自己跟隨，每一跳的 `Set-Cookie` 都會保存、每一跳都帶上對應的 Cookie（303 與 POST 的 301 / 302 改為 GET；跨來源時移除 `Authorization` / `Cookie`）。WebSocket 交握也會帶上並保存 Cookie。腳本的 `sendRequest` 同樣使用 Jar。
- **選項**：請求的 `settings` 為 `null` 時沿用 Workspace 設定（timeout、SSL 驗證、跟隨重新導向）；最多重新導向次數只在 Workspace 設定（預設 3）。
- **Proxy**：App 層級設定（`app-config.json`），模式 none / system（交給 Chromium 解析系統設定）/ custom；排除清單內的主機直接連線；請求可關閉「使用 App 的 Proxy 設定」。HTTPS 走 CONNECT、HTTP 走 absolute-form。
- **回應**：依 `Content-Encoding` 解壓（gzip / deflate / br / zstd）；超過 100 MB（含解壓後）中止並回傳 `TOO_LARGE`；超過 10 MB 的文字回應以 `{ kind: 'large' }` 回傳，由使用者選擇「顯示」（`http:getBody`）或「下載」。
- **變數**：見下一節；替換在 main 進行，renderer 只送出未替換的內容與 `environmentId` / `parentId`。
- **安全**：Form-data 檔案欄位會讀取使用者選擇的本機檔案並送出；HTML 預覽在 `sandbox=""` 的 iframe（不執行 script、無同源權限）中顯示，App 的 CSP 也會擋下外部資源。

### 腳本、擷取與斷言（Phase 5b）

執行順序（`src/main/services/http/executor.ts`）：

1. **Pre-request 腳本**：看到的是未替換變數的請求（自己啟用的 Headers、URL、JSON / Raw Body），可修改；出錯時不發送，回傳 `{ kind: 'error', code: 'SCRIPT' }`（已做的變數變更仍會套用）。
2. **替換變數並發送**（變數包含腳本剛設定的值）。
3. **擷取**（`extractions`）→ 4. **Post-response 腳本**（出錯不影響回應顯示）→ 5. **斷言**（預期值用最新的變數替換）。

- **Collection / 資料夾腳本**（決策 126）：Pre-request 一律由外而內（Collection → 資料夾 → 請求）；Post-response 依 Collection 的 `scriptFlow`：`sequential`（依序，同 Postman）由外而內、`sandwich`（三明治，同 Bruno）由內而外。每段腳本看到前一段改過的請求；多段的 Console 輸出合在一起，以「── Collection「X」的腳本 ──」分隔；容器的 Pre-request 出錯時不發送，訊息前加上來源。只有容器有腳本時同樣需要信任。
- 請求沒有腳本、擷取、斷言時，結果沒有 `scriptReport`（同 Phase 4 以前）。
- 信任（決策 84）：Workspace 未信任時，renderer 在發送前詢問「信任並執行 / 這次不執行腳本 / 取消」；「這次不執行腳本」以 `skipScripts: true` 發送（擷取與斷言照常執行）。main 也會檢查，未信任又沒有 `skipScripts` 時回傳 `SCRIPT` 錯誤。
- 變數層級：**暫存變數 > 環境 > Collection**。暫存變數由 `hachi.variables.set` 與擷取（預設）設定，依 Workspace 資料夾存在 main 的記憶體，App 結束即消失，HTTP 與 WebSocket 都會用到。
- `environment.set` / `collectionVariables.set` 在腳本結束後寫入檔案（機密變數的值仍寫入 `.hachi-secrets.json`；名稱已存在就更新並啟用，否則新增一般變數）。

```ts
interface ScriptReport {
  preRequest: { error: string | null; logs: ScriptLog[]; tests: ScriptTestResult[]; durationMs } | null
  postResponse: …同上 | null
  extractions: { id; variable; scope: 'runtime' | 'environment'; value: string | null; error? }[]
  assertions: { id; label; passed; actual; error? }[]
  changes: { scope: 'runtime' | 'environment' | 'collection'; name; value: string | null; by: 'preRequest' | 'postResponse' | 'extraction' }[]
  changeErrors: string[]
  scriptsSkipped: boolean
  nextRequest?: string | null // 最後一次 setNextRequest（只在 Runner 生效，決策 127）
}
// HttpResponseData 另新增 requestHeaders：Hachi 實際送出的 Headers（Post-response 腳本的 hachi.request.headers）
```

**沙箱**（決策 70 / 83 / 85）：QuickJS（`quickjs-emscripten`），在 Electron `utilityProcess`（`src/main/script-process.ts`）中執行；每次執行建立新的 context，只拿到變數 / 請求 / 回應的 JSON 複本；沒有檔案、`process`、`require`。決策 127：腳本整段包在 async 函式中（可直接 `await`），唯一的 host 函式是 main 提供的請求（`sendRequest` / `runRequest`）與等待（`sleep` / `setTimeout`），每次執行最多 20 個請求。限制：計算時間 5 秒；**總時間**（含等待請求）為 Workspace 設定 `scriptTimeoutMs`（預設 30 秒，1–300 秒），永遠不會完成的 Promise 立即報錯（另有 watchdog，超過就結束程序並重新啟動）、記憶體 64 MB、堆疊 256 KB、`console` 1000 則（每則 10 KB）、變數變更 1000 筆、每個值 1 MB；超過 10 MB 或二進位的回應，`response.text()` / `json()` 會丟出錯誤。

**腳本 API**（`src/main/services/scripts/prelude.ts`）：

| API                                                              | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hachi.variables.get / has / set / unset / replaceIn / toObject` | `get` 依「暫存 > 環境 > Collection」取原始值；`set` / `unset` 只改暫存變數；`replaceIn('{{a}}')` 替換 `{{變數}}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `hachi.environment.*`、`hachi.collectionVariables.*`             | `get / has / set / unset / toObject`、`.name`；沒有選環境（或請求不在 Collection）時 `set` 會丟出錯誤。值一律存成文字（物件以 JSON）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `hachi.request`                                                  | `method`、`url`、`body`（JSON / Raw 的文字，其他模式為 `null`）、`headers.get / has / set / add / remove / toObject / all`；只有 Pre-request 可修改                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `hachi.response`                                                 | `status`、`statusText`、`headers.get / has / toObject`、`time`（ms）、`size`、`text()`、`json()`（只在 Post-response）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `hachi.test(name, fn)`、`hachi.expect(x)`                        | Jest 風格：`toBe / toEqual / toStrictEqual / toBeTruthy / toBeFalsy / toBeNull / toBeUndefined / toBeDefined / toBeNaN / toContain / toContainEqual / toHaveLength / toHaveProperty(path, value?) / toMatch / toBeGreaterThan(OrEqual) / toBeLessThan(OrEqual) / toBeTypeOf / toBeOneOf`，皆可加 `.not`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `hachi.info`                                                     | `requestName`、`eventName`（`prerequest` / `test`）、`iteration`、`iterationCount`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `bru` / `req` / `res`（決策 104，Bruno 相容）                    | `bru.getVar / setVar / hasVar / deleteVar`（暫存變數）、`getEnvVar / setEnvVar / hasEnvVar / deleteEnvVar`、`getEnvName`、`getCollectionVar`、`getCollectionName`、`getRequestVar / getFolderVar`（依變數層級取值）、`getGlobalEnvVar / setGlobalEnvVar`（→ 暫存變數）、`interpolate`、`sleep`（回傳 Promise）、`sendRequest` / `runRequest` / `setNextRequest`、`runner.setNextRequest / stopExecution`；`req.getUrl / setUrl / getMethod / setMethod / getHeader / getHeaders / setHeader / setHeaders / deleteHeader / getBody / setBody / getName`（`getBody` 會解析 JSON；只有 Pre-request 可修改）與 `url / method / headers / body` 屬性；`res(path)` 讀 JSON Body 路徑，`res.getStatus / getStatusText / getHeader / getHeaders / getBody / getResponseTime / getSize` 與 `status / statusText / headers`（名稱小寫）`/ body / responseTime`；全域 `test(name, fn)` 與 Chai 風格 `expect`（同 `pm.expect`）。不支援：`bru.cookies / getProcessEnv`、`bru.runner.skipRequest`、`req.setTimeout` 等（呼叫時丟出錯誤）。`setVar` 的值存成文字（物件以 JSON） |
| `pm.*`（決策 72）                                                | `pm.variables`（`set` → 暫存）、`pm.environment`、`pm.collectionVariables`、`pm.globals`（→ 暫存變數）、`pm.request`（`url.toString() / update()`、`headers.add / upsert / remove / get`、`method`、`body.raw / update()`）、`pm.response`（`code / status / responseTime / responseSize / headers / text() / json()`、`to.have.status / header / body / jsonBody`、`to.be.ok / success / clientError / serverError / notFound…`）、`pm.test`（含 `.skip`）、`pm.expect`（Chai BDD 常用子集：`to / be / have / not / deep / nested / any`、`equal / eql / a / an / include / property / lengthOf / match / above / below / least / most / within / closeTo / oneOf / members / keys / satisfy / ok / true / false / null / undefined / exist / empty`）、`pm.info`、`pm.iterationData`、`pm.sendRequest`（Promise 或 callback）、`pm.execution.setNextRequest / runRequest`、`postman.setNextRequest`。不支援：`pm.cookies`、`pm.vault`、`pm.visualizer`、`pm.execution.skipRequest`（呼叫時丟出錯誤，Postman 匯入時提示）                                        |
| 請求與流程（決策 127）                                           | `await hachi.sendRequest(urlOrSpec)`：字串網址，或 `{ url, method, header(s), body }`（Postman 的 `raw` / `urlencoded`、axios 風格物件皆可；物件 Body 送成 JSON）；照 Workspace 的 Proxy / SSL / 逾時與 Cookie Jar 送出，**不替換 `{{變數}}`、不記錄在歷史**，回傳 `{ status, statusText, headers, body, json(), text(), responseTime }`（`pm` / `bru` 版本是各自的回應形狀）。`await hachi.runRequest('資料夾/請求')`（名稱路徑，在同一個 Collection 內；或請求 id）：用已儲存的請求（含它的腳本、擷取、斷言）送出並回傳回應，最多巢狀 3 層，它改的變數之後立即可讀。`hachi.setNextRequest(name \| null)`：Runner 中跳到該名稱的請求、`null` 結束這一輪；單獨送出時只在 Console 提示。`await hachi.sleep(ms)`、全域 `setTimeout` / `clearTimeout`                                                                                                                                                                                                                                                                                                                |
| 舊版 Postman                                                     | `tests["名稱"] = 條件`、`responseBody`、`responseCode.code`、`responseTime`、`responseHeaders`、`postman.setEnvironmentVariable / getEnvironmentVariable / clearEnvironmentVariable / setGlobalVariable…`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 其他                                                             | `console.log / info / warn / error / debug`、`btoa` / `atob`（Latin-1）、`CryptoJS`（全域，或 `require('crypto-js')`；只在腳本出現 `CryptoJS` / `crypto-js` 時載入）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Collection Runner（Phase 5c，`src/main/services/runner-service.ts`、`src/shared/runner.ts`）

```ts
interface RunnerConfig {
  targetId: string // Collection / 資料夾
  itemIds: string[] // 要執行的請求（依樹的順序執行）
  environmentId: string | null
  iterations: number // 每個 worker 的輪數（1–10,000，決策 88）；持續時間模式忽略
  durationSec: number | null // 決策 130：持續時間模式（1–86,400 秒），null = 依輪數
  concurrency: number // worker 數（1–20）；總輪數 = iterations × concurrency
  delayMs: number // 兩個請求之間的間隔（0–60,000）
  stopOnFailure: boolean // 網路錯誤、腳本錯誤或任一測試 / 斷言失敗即停止全部 worker
  keepBodies: boolean // 決策 90：每筆 ≤ 1 MB、總共 ≤ 200 MB
  data: { fileName: string; rows: Record<string, string>[] } | null // 決策 89
  skipScripts: boolean
}
```

- 每個 worker 依序跑一輪（輪內依序執行所有請求），輪次編號依開始順序從共用的計數器取得；資料檔第 n 輪用第 `n mod 列數` 列。
- 持續時間模式（決策 130）：每個 worker 一直開始新的一輪直到時間到；時間到後不再開始新的一輪，已開始的一輪跑完。`RunnerProgress.totalRounds` / `totalRequests` 為 0，`durationMs` 為設定的長度（依輪數時為 null）；腳本的 `iterationCount` 為 0。
- `setNextRequest`（決策 127）：請求的腳本設定後，這一輪接著執行該名稱（或 id）的第一個請求；`null` 或找不到的名稱結束這一輪。一輪最多執行 1000 個請求，超過就停止整個執行（避免無窮迴圈）。
- Cookie Jar（決策 129）：並行數 1 使用並保存 Workspace 的 Jar；並行數 > 1 每個 worker 各自複製一份，不寫回。
- 變數（決策 91）：並行數 1 與編輯器發送相同（共用暫存變數、環境 / Collection 寫檔）；並行數 > 1 時每個 worker 從目前的暫存變數、環境與 Collection 各複製一份，修改只在該 worker 內有效。資料列為一層變數：暫存 > 資料列 > 環境 > Collection。
- 每個請求走與 `http:send` 相同的流程（腳本、擷取、斷言），但**不寫入歷史紀錄**，回應也不放進「顯示 / 下載」用的暫存。
- 結果：每筆 `RunnerRow`（輪、worker、狀態碼或錯誤類別、耗時、大小、測試通過數、是否失敗）都保留；Headers / 腳本結果 / 資料列 / Body 這些細節只保留前 2000 筆，以及之後失敗的 2000 筆。記憶體中最多保留最近 5 次執行的結果（執行中的不會被清掉）；切換 Workspace、關閉視窗或畫面重新載入時停止所有執行。
- 統計（決策 87）：每個請求與總計的次數、成功 / 失敗、錯誤率、測試通過 / 失敗、耗時（有回應的請求）平均 / 最小 / 最大 / p50 / p90 / p95 / p99（nearest-rank）/ 標準差；狀態碼與錯誤類別次數；依完成時間每秒的請求數與 p50 / p95（即時圖表）。
- HTML 報告（決策 130，`src/main/services/runner-report.ts`）：單一離線檔（CSS 與 SVG 圖表內嵌，沒有 script）：狀態、總計卡片、執行設定、每秒完成數與 p50 / p95 圖表（長時間的執行分組成最多 240 欄）、每個請求的統計、狀態碼分布、失敗的列（最多 1000 筆，含錯誤訊息與失敗的測試 / 斷言）。

### Git（決策 111–116，`src/main/services/git/`）

- 使用這台電腦安裝的 git（找 PATH，再找平台常見位置：`src/main/platform/` 的 `gitCandidates`；macOS 的 `/usr/bin/git` 只有在 Command Line Tools 已安裝時才用，避免跳出安裝視窗）。以參數陣列執行、不經 shell，環境變數 `GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`、`GIT_OPTIONAL_LOCKS=0`；同一時間只執行一個 git 操作。
- 路徑一律相對於 Workspace（`/` 分隔）；main 只接受狀態中列出的檔案。Workspace 可位在 repo 的子資料夾，只列出 Workspace 內的變更。
- renderer 在開啟 Workspace、視窗取得焦點、樹變更、開啟分支選單時重新讀取狀態；Git 畫面開著時每 4 秒更新（選取的檔案也重新讀取差異）。
- 介面（決策 119）：標題列的 Git / 分支按鈕是唯一入口；「Commit…」開啟 Git 畫面，取代側欄與主畫面（隱藏而不卸載，分頁狀態保留），「返回」關閉。
- **帳密（askpass，決策 113）**：main 在暫存資料夾（0700）產生 askpass 小程式與本機 socket（Windows：named pipe），以 `GIT_ASKPASS` / `SSH_ASKPASS`（`SSH_ASKPASS_REQUIRE=force`）交給 Fetch / Pull / Push。git 執行小程式時，它以 App 本身的執行檔（`ELECTRON_RUN_AS_NODE=1`，打包時不可關閉 RunAsNode fuse）把提示與隨機 token 傳給 main，main 送出 `git:prompt`；回答只傳給這次的 git，不存檔。結束 App 時刪除。網路操作逾時 10 分鐘。
- git 不會開啟編輯器（`GIT_EDITOR=:`、`GIT_MERGE_AUTOEDIT=no`）。合併中不能用一般 commit（只能「完成合併」）。
- Pull 前先詢問未儲存的分頁，之後重新讀取（保留未儲存的分頁）；有衝突時開啟 Git 畫面。
- 切換分支前先詢問未儲存的分頁；切換後重新讀取樹與沒有未儲存修改的分頁（有未儲存修改的分頁保留內容，`tabs.reload(..., { keepUnsaved: true })`）。

```ts
type GitStatus =
  | { state: 'no-git' }
  | { state: 'not-repo' }
  | {
      state: 'repo'
      root: string // repo 根目錄（絕對路徑）
      branch: string | null // detached 時為 null
      head: string | null // commit 短 id；還沒有 commit 時為 null
      upstream: string | null
      ahead: number
      behind: number
      files: {
        path: string
        kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
        oldPath?: string
      }[]
      empty: boolean // 還沒有任何 commit
    }
interface GitBranch {
  name: string
  remote: boolean
  current: boolean
  upstream: string | null
}
```

### 匯入 / 匯出 / 程式碼產生（Phase 5a；Bruno / OpenAPI 見決策 103–105）

```ts
interface ImportReport {
  kind: 'collection' | 'environment'
  id: string // 新建的 Collection / 環境 id
  name: string // 最終名稱（重名時加 " copy"）
  fileName: string
  folders: number
  requests: number
  variables: number
  environments: string[] // 一起建立的環境名稱（Bruno）；其他格式為 []
  warnings: string[] // 無法完全對應的設定（同一訊息合併，附最多 3 個項目路徑）
}

interface ExportResult {
  path: string // 寫入的檔案（Bruno：建立的資料夾）
  skipped: string[] // 略過的 WebSocket 請求（Postman v2.1 / Bruno / OpenAPI 都不支援）
  unreadable: string[] // 檔案損毀而未匯出的項目
  warnings: string[]
}

// Bruno 資料夾匯入（決策 107）
interface ImportOutcome {
  fileName: string // 資料夾名稱
  report: ImportReport | null
  error: string | null // 這個 Collection 匯入失敗的原因（其他照常匯入）
}
interface BrunoCollectionChoice {
  path: string // 相對於所選資料夾（'/' 分隔；'' = 所選資料夾本身）
  name: string // bruno.json / opencollection.yml 的名稱，讀不到時用資料夾名稱
  format: 'bru' | 'yaml'
}
type BrunoFolderResult =
  | { kind: 'imported'; results: ImportOutcome[] }
  | { kind: 'choose'; scanId: string; folder: string; collections: BrunoCollectionChoice[] }

// src/shared/codegen.ts：main 組好，renderer 依語言產生程式碼（generateCode）
interface CodegenRequest {
  method: string
  url: string // 已接上 Params 與 API Key query
  headers: [string, string][] // 請求 + 沿用的 Headers、Auth（Basic 除外）、Content-Type
  basicAuth: { username: string; password: string } | null
  body:
    | { kind: 'none' }
    | { kind: 'text'; text: string; json: boolean }
    | { kind: 'urlencoded'; fields: [string, string][] }
    | { kind: 'formData'; fields: ({ type: 'text'; key; value } | { type: 'file'; key; path })[] }
  options: {
    validateSSL: boolean
    followRedirects: boolean
    maxRedirects: number
    timeoutMs: number
  }
}
```

- 匯入的檔案上限 50 MB、項目上限 20,000 個、資料夾 32 層；變數超過 1000 個只匯入前 1000 個。對應規則見 docs/schema.md「匯入 / 匯出」。
- OpenAPI HTML：單一檔案，內嵌 Redoc standalone bundle（`src/main/redoc.ts` 以 `?raw` 在建置時放進獨立的 chunk，匯出時才載入）與 OpenAPI 文件，離線可開；授權聲明放在 `<script>` 開頭的註解。伺服器網址與路徑參數的範例值使用 Collection 變數＋所選環境（**機密變數不使用**）。
- cURL 匯入完全在 renderer 解析（`src/shared/transfer/curl.ts`），不經過 IPC；不會讀取指令中引用的檔案（`-d @file` 等只提示）。
- 拖放：視窗中任何位置放開檔案即匯入（一次最多 20 個）；內容以 `curl` 開頭的檔案開成未儲存的新分頁，其他檔案走 `transfer:importText`。視窗層級攔截 `dragover` / `drop`，檔案不會讓視窗導覽到 `file://`。
- 程式碼產生：cURL（POSIX shell 引號）、JavaScript fetch / axios（Node.js 20+，form-data 檔案用 `fs.openAsBlob`）、Python requests。JSON Body 轉成物件字面值；含 16 位以上整數時保留原文字（避免精度遺失）。重複的 Header 合併（`Cookie` 用 `; `，其餘用 `, `）。「複製」按鈕使用 `clipboard-sanitized-write` 權限（已在白名單）。

### 變數替換（`src/shared/variables.ts`）

- 語法 `{{name}}`（大括號內前後空白會忽略）。可用在 URL、Params、Headers、Body（目前模式）、Auth、Form-data 的文字值與檔案路徑；請求名稱不替換。
- 來源與優先順序：**暫存變數（Phase 5b）> 目前環境 > Collection 變數**（`parentId` 所屬的 Collection）。停用或名稱空白的變數忽略。
- 變數值可再引用其他變數，最多 10 層；循環引用停止替換並視為找不到。
- 動態變數（沒有同名的使用者變數時）：`{{$guid}}` / `{{$randomUUID}}`、`{{$timestamp}}`（Unix 秒）、`{{$isoTimestamp}}`、`{{$randomInt}}`（0–1000）、`{{$randomString}}`（16 個英數字）、`{{$randomAlphaNumeric}}`（1 個英數字）、`{{$randomEmail}}`（`user_xxxxxxxx@example.com`）、`{{$randomBoolean}}`，每次出現都重新產生。
- 找不到的變數照原樣送出，名稱列在回應的 `unresolvedVariables`。
- Renderer 用同一個模組標示變數：綠色＝有值、藍色＝動態、紅色＝找不到；滑鼠移上去顯示值（機密值遮罩）。

### WebSocket 規則

- 連線在 main 以 `ws` 執行；收到的訊息不在 main 保存，每 50 ms 合併成一個 `ws:event` 推給 renderer，訊息串只存在 renderer 的記憶體（每個分頁上限見 `app-config.json` 的 `websocket.messageLimit`）。
- 握手：URL（補 `ws://`，只接受 ws / wss）+ Params + API Key Query；Headers 與 Auth 沿用上層（同 HTTP）；沒設定時補 `User-Agent: Hachi/<版本>`；子協定為 `Sec-WebSocket-Protocol`。逾時用請求的 `connectTimeoutMs` 或 Workspace 的 timeout；SSL 驗證同 HTTP；不跟隨重新導向。
- Proxy：App 層級設定，以 HTTP CONNECT 通道連線（`https-proxy-agent`），帳密以 `Proxy-Authorization: Basic` 送出；請求可關閉。
- 心跳：`ping` 模式送 Ping frame（收到 Pong 顯示延遲）；`text` 模式送出文字訊息。伺服器送來的 Ping 由 `ws` 自動回應 Pong 並記錄。
- 不自動重連。中斷送出請求設定的 Close Code（預設 1000）與原因；伺服器 5 秒內沒回應關閉時強制斷線。
- 切換 Workspace、關閉視窗、畫面重新載入時，main 會關閉所有連線（Close Code 1001）。
- 每次連線結束時（不論成功與否）寫入一筆歷史紀錄，不含訊息內容。

### 分頁、未儲存提示與關閉視窗

- 分頁狀態只在 renderer；每個 Workspace 開了哪些分頁與目前環境，透過 `session:*` 存在 `<userData>/sessions/`（見 docs/schema.md）。
- 關閉分頁、切換 / 開啟 / 刪除目前 Workspace、重新讀取時，renderer 先詢問未儲存的分頁；關閉分頁、切換 Workspace、關閉視窗時，**仍在連線中的 WebSocket 分頁**也會一起列出（決策 60）。
- 關閉視窗 / 結束 App：renderer 以 `app:setCloseGuard` 告知是否有未儲存或連線中的分頁。有的話 main 取消這次關閉並送出 `app:closeRequested`；使用者選擇儲存或不儲存後，renderer 呼叫 `app:confirmClose`，main 才關閉（或結束）。renderer 重新載入或當掉時 main 會自動解除保護。
- 關閉最後一個視窗就結束 App，**macOS 也一樣**（決策 110；不留在 Dock 背景）。
- 選單的 Open Workspace / Open Recent 改由 renderer 執行（`menu:command`），以便先詢問未儲存的分頁。

## Event channels（Main → Renderer）

| Channel              | Payload                                                                                                                                                                                                                    | 觸發時機                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu:command`       | `{ command: 'workspace.new' \| 'workspace.switch' \| 'workspace.open' \| 'workspace.openRecent' \| 'request.save' \| 'tab.close' \| 'app.settings' \| 'import.file' \| 'import.curl' \| 'help.shortcuts', path?: string }` | 原生選單中需要由 UI 處理的指令（`path` 只用於 `workspace.openRecent`）                                                                                              |
| `workspace:changed`  | `WorkspaceInfo \| null`                                                                                                                                                                                                    | 目前 Workspace 變更（不論來自 renderer、選單或 Open Recent）                                                                                                        |
| `config:changed`     | `AppConfig`                                                                                                                                                                                                                | app-config 內容變更                                                                                                                                                 |
| `tree:changed`       | `WorkspaceTree`                                                                                                                                                                                                            | Collection 樹有變化（App 內操作、重新讀取、切換 Workspace）                                                                                                         |
| `ws:event`           | `WsEventPayload`                                                                                                                                                                                                           | WebSocket 狀態變化與訊息紀錄（每個連線最多每 50 ms 一次；狀態變化立即送出）                                                                                         |
| `history:changed`    | `HistoryUsage`                                                                                                                                                                                                             | 歷史紀錄新增 / 刪除 / 套用新上限後（usage 以目前 Workspace 計算）                                                                                                   |
| `variables:changed`  | `VariablesChangedEvent`：`{ runtime: RuntimeVariable[], environmentId, collectionId }`                                                                                                                                     | 腳本或擷取改了變數：一律附上目前的暫存變數；`environmentId` / `collectionId` 為被寫入檔案的環境 / Collection（renderer 重新讀取變數標示與沒有未儲存修改的編輯分頁） |
| `runner:event`       | `RunnerEvent`：`{ progress: RunnerProgress }`                                                                                                                                                                              | Runner 執行中約每 500 ms 一次、結束時一次：狀態、完成的輪數 / 請求數、經過時間、統計（`RunnerStats`）                                                               |
| `app:closeRequested` | `{ reason: 'close' \| 'quit' }`                                                                                                                                                                                            | 有未儲存的分頁時，使用者關閉視窗或結束 App                                                                                                                          |
| `git:prompt`         | `GitPrompt`（`{ id, prompt, kind }`，kind：`username` / `password` / `passphrase` / `other`）                                                                                                                              | git 需要帳號、密碼 / Token、SSH 金鑰密語或確認時（askpass，決策 113）；renderer 顯示輸入框後以 `git:answerPrompt` 回覆                                              |

訂閱方式：`const off = window.hachi.on('workspace:changed', (ws) => …)`，呼叫 `off()` 取消訂閱。

## 原生選單

快捷鍵刻意只保留少數幾個（決策 21、43、49、50）。View / Window 的項目改用一般的 click 項目，不用 Electron 的 role，因為 role 會自帶快捷鍵。

| 選單              | 項目                                          | 快捷鍵                        | 行為                                                                           |
| ----------------- | --------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| Hachi（僅 macOS） | About Hachi / Services / Show All             | —                             | role                                                                           |
|                   | Settings…                                     | —                             | `menu:command` → `app.settings`（App 設定：Proxy、歷史紀錄上限）               |
|                   | Hide Hachi / Hide Others                      | —                             | `app.hide()` / `hideOtherApplications:`                                        |
|                   | Quit Hachi                                    | `⌘Q`                          | role                                                                           |
| File              | New Workspace…                                | `CmdOrCtrl+Shift+N`           | `menu:command` → `workspace.new`                                               |
|                   | Open Workspace…                               | `CmdOrCtrl+O`                 | `menu:command` → `workspace.open`（先詢問未儲存的分頁，再開資料夾對話框）      |
|                   | Open Recent ▸                                 | —                             | `menu:command` → `workspace.openRecent`（含 `path`）                           |
|                   | Switch Workspace…                             | —                             | `menu:command` → `workspace.switch`                                            |
|                   | Import…                                       | —                             | `menu:command` → `import.file`（`transfer:importFile`；沒有 Workspace 時提示） |
|                   | Import Bruno Collection…                      | —                             | `menu:command` → `import.bruno`（`transfer:importBrunoFolder`）                |
|                   | Import cURL…                                  | —                             | `menu:command` → `import.curl`（貼上 cURL 指令，開成未儲存的新分頁）           |
|                   | Save                                          | `CmdOrCtrl+S`                 | `menu:command` → `request.save`（儲存目前分頁；未儲存的新請求會詢問位置）      |
|                   | Close Tab                                     | `CmdOrCtrl+W`                 | `menu:command` → `tab.close`（關閉目前分頁；沒有分頁時關閉視窗）               |
|                   | Settings…（僅 Windows / Linux）               | —                             | `menu:command` → `app.settings`                                                |
|                   | Close Window（macOS）/ Exit（Windows、Linux） | — / 系統預設（Linux：Ctrl+Q） | 關閉目前視窗 / role `quit`                                                     |
| Edit              | Undo / Redo / Cut / Copy / Paste / Select All | 系統預設（`CmdOrCtrl+Z` 等）  | role `editMenu`                                                                |
| View              | Reload（僅開發模式）                          | `CmdOrCtrl+R`                 | 重新載入畫面（未儲存的分頁會遺失，因此正式版沒有這個項目）                     |
|                   | Force Reload / Toggle Developer Tools（同上） | —                             | 僅開發模式                                                                     |
|                   | Actual Size / Zoom In / Zoom Out              | —                             | 調整畫面縮放                                                                   |
|                   | Toggle Full Screen                            | —                             | 全螢幕                                                                         |
| Window            | Minimize                                      | —                             | 最小化                                                                         |
|                   | Zoom / Bring All to Front（僅 macOS）         | —                             | role                                                                           |
| Help              | Keyboard Shortcuts                            | —                             | `menu:command` → `help.shortcuts`（快捷鍵一覽對話框，決策 96）                 |
|                   | About Hachi（僅 Windows / Linux）             | —                             | 訊息對話框（macOS 在 Hachi 選單）                                              |

「開發模式」＝未打包（`npm run dev` / `npm start`）。設定環境變數 `HACHI_PRODUCTION_MENU=1` 可在開發時顯示正式版的選單（E2E 測試使用）。

### 畫面內的按鍵

| 位置              | 按鍵                                         | 功能                                                                                                   |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 左側樹            | Delete，或 `CmdOrCtrl+Backspace`             | 刪除（會先確認）                                                                                       |
| 左側樹            | Enter                                        | 開啟成固定分頁                                                                                         |
| 左側樹            | ↑ / ↓                                        | 移動選取（不開啟、不展開，決策 96）                                                                    |
| 改名欄位          | Enter / Esc                                  | 確定 / 取消（改名只從右鍵選單開始）                                                                    |
| Body / 回應編輯器 | CodeMirror 標準按鍵（搜尋、復原、多重選取…） | 不含摺疊 / 展開（用左側的摺疊箭頭）；唯讀的回應與 Git 差異也可聚焦，全選 / 複製 / 搜尋可用（決策 125） |
| 對話框            | Enter / Esc                                  | 送出 / 關閉                                                                                            |

平台差異集中在 `src/main/platform/`（`darwin.ts`、`default.ts`）。

## 新增 channel 的流程

1. `channels.ts` 的 `INVOKE`（或 `EVENTS`）加入名稱。
2. `api.ts` 的 `InvokeMap` 加入輸入 / 輸出型別，並在 `HachiApi` 加入方法（缺漏會編譯失敗）。
3. `contract.ts` 的 `inputSchemas` 加入 zod schema（缺漏或型別不符會編譯失敗）。
4. `register.ts` 的 handler map 加入實作（缺漏會編譯失敗）。
5. `preload/index.ts` 暴露方法。
6. 更新本文件。

> 發送 / 取消請求**刻意不設鍵盤快捷鍵**（Phase 2 決定，避免誤觸）；也**不提供 CmdOrCtrl+T**（決策 43），新分頁用分頁列的「+」。其他刻意不提供的快捷鍵見決策 49。
