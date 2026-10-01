# Hachi IPC 介面

> 版本：Phase 0。後續每個 Phase 新增或修改 channel 時，必須同步更新本文件。
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

| 項目                   | 設定                                                                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contextIsolation`     | `true`                                                                                                                                                                                                                                                                 |
| `nodeIntegration`      | `false`                                                                                                                                                                                                                                                                |
| `sandbox`              | `true`（preload 輸出為 CommonJS 並完整打包，不依賴 node_modules）                                                                                                                                                                                                      |
| 暴露給 renderer 的 API | 只有 `window.hachi`（固定白名單函式）；不暴露 `ipcRenderer`、`require`、`process`                                                                                                                                                                                      |
| 事件訂閱               | `window.hachi.on()` 只接受 `EVENT_CHANNELS` 中的 channel，其餘直接丟錯                                                                                                                                                                                                 |
| Sender 驗證            | 每個 invoke 都檢查 `event.senderFrame.url`：開發時需為 Vite dev server 同源；正式版需為打包內的 `out/renderer/index.html`。不符合回傳 `FORBIDDEN`                                                                                                                      |
| 輸入驗證               | 每個 channel 都有 zod schema（`strictObject`，多餘欄位會被拒絕）；不帶參數的 channel 只接受 `undefined`                                                                                                                                                                |
| 路徑                   | 只接受絕對路徑（POSIX 或 Windows 形式），不得含 NUL；main 端一律 `path.resolve` 後使用。Phase 1 起，Workspace 內的檔案操作只接受「相對於 Workspace 的路徑」並驗證不跳脫該資料夾                                                                                        |
| 新視窗 / 導覽          | 禁止開新視窗（http/https 連結改用系統瀏覽器開啟）、禁止導覽離開 App 頁面、禁止 `<webview>`                                                                                                                                                                             |
| 權限                   | 除 `clipboard-sanitized-write` 外，所有權限請求（相機、定位…）一律拒絕                                                                                                                                                                                                 |
| CSP                    | 正式版：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`。開發模式額外允許 inline script 與 `ws:`（Vite HMR） |

### 回傳格式

所有 invoke 都回傳 `IpcResult<T>`，**不會**以 reject 的方式跨 IPC 拋錯：

```ts
type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } }
```

Renderer 端使用 `unwrap()`（`src/renderer/src/lib/ipc.ts`）轉成 `IpcError` 例外。

### 錯誤碼（`src/shared/errors.ts`）

| code                  | 意義                                                 |
| --------------------- | ---------------------------------------------------- |
| `VALIDATION_ERROR`    | 輸入未通過 zod 驗證                                  |
| `FORBIDDEN`           | IPC 來源不可信                                       |
| `NOT_FOUND`           | 檔案或資源不存在                                     |
| `ALREADY_EXISTS`      | 目標已存在（例如該位置已有 Workspace）               |
| `DIR_NOT_EMPTY`       | 目標資料夾已存在且非空                               |
| `NOT_A_WORKSPACE`     | 資料夾內沒有 `workspace.json`                        |
| `INVALID_FILE`        | JSON 格式錯誤或不符合 schema                         |
| `UNSUPPORTED_VERSION` | 檔案 `version` 比目前 App 支援的還新                 |
| `IO_ERROR`            | 檔案系統錯誤                                         |
| `INTERNAL`            | 未預期錯誤（細節只寫入 main log，不回傳給 renderer） |

## Invoke channels（Renderer → Main）

| Channel                      | `window.hachi`                  | 輸入                                                  | 輸出                     | 說明                                                                                                                   |
| ---------------------------- | ------------------------------- | ----------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `app:getInfo`                | `app.getInfo()`                 | —                                                     | `AppInfo`                | 名稱、版本、appId、平台、是否已打包                                                                                    |
| `app:getDefaultWorkspaceDir` | `app.getDefaultWorkspaceDir()`  | —                                                     | `string`                 | 預設 Workspace 上層目錄：`<Documents>/Hachi`                                                                           |
| `config:get`                 | `config.get()`                  | —                                                     | `AppConfig`              | 讀取 app-config（記憶體中的版本）                                                                                      |
| `config:update`              | `config.update(input)`          | `{ theme?: 'system' \| 'light' \| 'dark' }`           | `AppConfig`              | Renderer 只能修改使用者偏好；recent / window 狀態由 main 維護                                                          |
| `workspace:getCurrent`       | `workspace.getCurrent()`        | —                                                     | `WorkspaceInfo \| null`  | 目前開啟的 Workspace                                                                                                   |
| `workspace:create`           | `workspace.create(input)`       | `{ name: string(1..100, trim), parentDir: 絕對路徑 }` | `WorkspaceInfo`          | 在 `parentDir/<淨化後名稱>` 建立 Workspace 並開啟。目標已是 Workspace → `ALREADY_EXISTS`；非空資料夾 → `DIR_NOT_EMPTY` |
| `workspace:open`             | `workspace.open(input)`         | `{ path: 絕對路徑 }`                                  | `WorkspaceInfo`          | 開啟並設為目前 Workspace，更新最近清單                                                                                 |
| `workspace:openWithDialog`   | `workspace.openWithDialog()`    | —                                                     | `WorkspaceInfo \| null`  | 顯示原生資料夾選擇器後開啟；取消回傳 `null`                                                                            |
| `workspace:listRecent`       | `workspace.listRecent()`        | —                                                     | `RecentWorkspaceEntry[]` | 最近開啟清單（含 `exists` 旗標）                                                                                       |
| `workspace:removeRecent`     | `workspace.removeRecent(input)` | `{ path: 絕對路徑 }`                                  | `RecentWorkspaceEntry[]` | 從最近清單移除（不刪除磁碟資料）                                                                                       |
| `dialog:selectDirectory`     | `dialog.selectDirectory(input)` | `{ title?: string(≤200), defaultPath?: 絕對路徑 }`    | `string \| null`         | 原生資料夾選擇器；取消回傳 `null`                                                                                      |

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
```

## Event channels（Main → Renderer）

| Channel             | Payload                                              | 觸發時機                                                     |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `menu:command`      | `{ command: 'workspace.new' \| 'workspace.switch' }` | 原生選單中需要由 UI 處理的指令                               |
| `workspace:changed` | `WorkspaceInfo \| null`                              | 目前 Workspace 變更（不論來自 renderer、選單或 Open Recent） |
| `config:changed`    | `AppConfig`                                          | app-config 內容變更                                          |

訂閱方式：`const off = window.hachi.on('workspace:changed', (ws) => …)`，呼叫 `off()` 取消訂閱。

## 原生選單

| 選單                       | 項目                                    | 快捷鍵              | 行為                                            |
| -------------------------- | --------------------------------------- | ------------------- | ----------------------------------------------- |
| Hachi（僅 macOS）          | About Hachi / Services / Hide / Quit    | 系統預設            | role                                            |
| File                       | New Workspace…                          | `CmdOrCtrl+Shift+N` | `menu:command` → `workspace.new`                |
|                            | Open Workspace…                         | `CmdOrCtrl+O`       | main 直接開啟資料夾對話框 → `workspace:changed` |
|                            | Open Recent ▸                           | —                   | main 直接開啟 → `workspace:changed`             |
|                            | Switch Workspace…                       | —                   | `menu:command` → `workspace.switch`             |
|                            | Close Window（macOS）/ Exit（其他平台） | 系統預設            | role                                            |
| Edit / View / Window       | 標準 role 選單                          | 系統預設            | —                                               |
| Help（僅 Windows / Linux） | About Hachi                             | —                   | 訊息對話框                                      |

平台差異集中在 `src/main/platform/`（`darwin.ts`、`default.ts`）。

## 新增 channel 的流程

1. `channels.ts` 的 `INVOKE`（或 `EVENTS`）加入名稱。
2. `api.ts` 的 `InvokeMap` 加入輸入 / 輸出型別，並在 `HachiApi` 加入方法（缺漏會編譯失敗）。
3. `contract.ts` 的 `inputSchemas` 加入 zod schema（缺漏或型別不符會編譯失敗）。
4. `register.ts` 的 handler map 加入實作（缺漏會編譯失敗）。
5. `preload/index.ts` 暴露方法。
6. 更新本文件。
