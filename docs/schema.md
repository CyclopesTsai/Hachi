# Hachi 資料結構（JSON Schema）

> 版本：Phase 4。標示「✅ 已實作」的格式已定案並有 zod schema；標示「📝 草案」的格式會在對應 Phase 實作時定案，並同步更新本文件。
>
> zod schema 位置：`src/shared/schemas/`

## 通用規則

1. **所有 JSON 檔都有整數 `version` 欄位**（從 1 開始）。
2. **讀取流程**：`JSON.parse` → 依 `version` 依序執行遷移（`migrations[n]`：n → n+1）→ zod 驗證（`src/shared/schemas/versioned.ts`）。
   - 缺少 `version` 或格式錯誤 → `INVALID_FILE`
   - `version` 大於 App 支援的版本 → `UNSUPPORTED_VERSION`（不會覆寫，避免舊版 App 破壞新版資料）
3. **版本升級政策**：
   - 新增欄位且有預設值 → **不升版**（讀取時由 zod `default()` 補上）
   - 改名、刪除、改變語意或型別 → **升版**並撰寫 migration 與測試
4. **原子寫入**（`src/main/services/fs/atomic-write.ts`）：寫入同目錄下的暫存檔 `.<檔名>.<pid>.<隨機>.tmp` → `fsync` → `rename` 覆蓋目標。同一檔案的寫入依呼叫順序序列化；失敗時清除暫存檔。Windows 上 rename 遇到 `EPERM/EACCES/EBUSY` 會重試。
5. **格式**：UTF-8、2 空白縮排、結尾換行（git diff 友善）。讀取時容忍 UTF-8 BOM。
6. **檔名**（`src/shared/file-names.ts`）：
   - 共通規則：移除 `<>:"/\|?*` 與控制字元、去掉開頭的點與結尾的點 / 空白、避開 Windows 保留名稱（`CON`、`NUL.txt`…），長度上限 **200 個 UTF-8 位元組**（檔案系統以位元組計算，一個中文字 3 位元組）。
   - Workspace 資料夾用 `sanitizeFileName()`：保留大小寫與空白，例如 `My API`。
   - Collection / 資料夾 / 請求用 `slugify()`：轉小寫、空白換成 `-`、保留中文，例如「Get Users」→ `get-users`、「取得使用者」→ `取得使用者`。同一資料夾內重名（不分大小寫）時加上 `-2`、`-3`…。`collection.json`、`folder.json` 為保留檔名。
   - 顯示名稱存在 JSON 的 `name` 欄位；檔名只是方便閱讀，App 以 `id` 識別項目。
7. **保留未知欄位**：Collection、資料夾、請求檔以 `looseObject` 驗證，App 改寫檔案（例如重新命名）時會保留它不認識的欄位，避免較新版本或後續 Phase 加入的欄位被刪掉。

## 資料夾結構

```
<userData>/                          # macOS: ~/Library/Application Support/Hachi
├─ app-config.json                   ✅ App 設定
├─ history-index.json                ✅ Phase 3：所有 Workspace 歷史紀錄的索引（共用筆數上限用）
├─ sessions/<sha1(workspacePath)>.json  ✅ Phase 3：各 Workspace 的分頁與目前環境（使用者本機狀態，不進 git）
└─ cookies/<workspace id>.json       ✅ 決策 129：各 Workspace 的 Cookie Jar（只存在這台電腦，不進 git）

<workspace>/                         # 預設 ~/Documents/Hachi/<名稱>/，可自選
├─ workspace.json                    ✅（settings 於 Phase 2 擴充）
├─ .gitignore                        ✅
├─ history.json                      ✅ Phase 3：請求歷史（已列入 .gitignore）
├─ .hachi-secrets.json               ✅ Phase 3：機密變數值（已列入 .gitignore；沒有機密變數時不建立）
├─ environments/
│  └─ <env>.json                     ✅ Phase 3（檔名為 slug）
└─ collections/
   └─ <collection>/                  ✅ Phase 1（資料夾名為 slug）
      ├─ collection.json             ✅ Phase 1
      ├─ <request>.json              ✅ 共通欄位（Phase 1）；HTTP 完整欄位 ✅ Phase 2、WebSocket ✅ Phase 4
      └─ <folder>/                   ✅ 可多層巢狀
         ├─ folder.json              ✅ Phase 1
         └─ <request>.json
```

---

## ✅ `app-config.json`

位置：`app.getPath('userData')`。檔案損毀或版本過新時，會先改名為 `app-config.json.corrupt-<時間>` / `.newer-<時間>` 備份，再以預設值重建，確保 App 一定能啟動。

```jsonc
{
  "version": 1,
  "theme": "system", // "system" | "light" | "dark"（App 設定「外觀」，Phase 6）
  "recentWorkspaces": [
    // 最多 10 筆，最新在前
    {
      "path": "/Users/me/Documents/Hachi/My API",
      "name": "My API",
      "lastOpenedAt": "2026-10-01T02:00:00.000Z"
    }
  ],
  "lastWorkspacePath": "/Users/me/Documents/Hachi/My API", // 啟動時自動開啟；null = 無
  "window": null, // 視窗位置與大小（Phase 6，決策 94）：{ x, y, width, height, isMaximized, isFullScreen }；原本的螢幕不在時改為置中
  "proxy": {
    // App 層級（每台電腦），不寫進 Workspace
    "mode": "none", // "none" | "system" | "custom"
    "url": "", // custom 時：http://host:port 或 https://host:port（沒寫 scheme 補 http://）
    "bypass": ["localhost", "127.0.0.1", "::1"], // 不經過 Proxy：完全相符、"*.example.com" / ".example.com"（含子網域）、"*"（全部）
    "username": "", // 選填，Proxy-Authorization: Basic
    "password": "" // 目前以明文存在本機；之後可改存系統 Keychain
  },
  "ui": {
    "requestBodyWrap": false, // 請求 Body 編輯器自動換行（僅影響顯示）
    "responseBodyWrap": false, // 回應 Body 自動換行（僅影響顯示）
    "gitChangesTree": true // Git Commit 畫面的變更以樹狀顯示（false = 清單，決策 122）
  },
  "history": {
    "maxEntries": 200 // 歷史紀錄筆數上限，所有 Workspace 共用（50–1000）
  },
  "websocket": {
    "messageLimit": 100 // 每個 WebSocket 分頁的訊息串最多保留幾則（10–5000），超過時刪除最舊的
  },
  "scripts": {
    "trustedWorkspaces": ["/Users/me/Documents/Hachi/My API"] // 信任其腳本的 Workspace 資料夾（決策 84，只在這台電腦）
  }
}
```

`proxy` 與 `ui` 於 Phase 2、`history` 於 Phase 3、`websocket` 於 Phase 4、`scripts` 於 Phase 5b 加入（新增欄位附預設值，不升版）。

## ✅ `workspace.json`

```jsonc
{
  "version": 1,
  "id": "0d6c3f0e-…", // UUID，建立時產生，不隨資料夾改名而變
  "name": "My API", // 顯示名稱（1–100 字元）
  "createdAt": "2026-10-01T02:00:00.000Z",
  "settings": {
    "timeoutMs": 30000, // 預設請求逾時，0 = 不限（上限 3600000）
    "validateSSL": true, // 預設 TLS 憑證驗證
    "followRedirects": true, // 預設跟隨重新導向（Phase 2）
    "maxRedirects": 3, // 最多跟隨次數，0–20（Phase 2）
    "scriptTimeoutMs": 30000, // 每段腳本的總時間（含等待 sendRequest / sleep），1000–300000（決策 127）
    "gitAutoFetch": false // 開啟 Workspace 時自動 git fetch（決策 113）
  },
  "collectionOrder": [] // Collection 的 id，依顯示順序（規則同 collection.json 的 order）
}
```

建立 Workspace 時會依序寫入 `collections/`、`environments/`、`history.json`、`.gitignore`，**最後**才寫 `workspace.json`；因此有 `workspace.json` 就代表 Workspace 結構完整。開啟時若子資料夾遺失會自動補建。

## ✅ `.gitignore`

```gitignore
# Hachi — files that must not be committed
# Secret variable values (environments keep only the variable names)
.hachi-secrets.json
# Request history may contain tokens and resolved secrets
history.json
# Temporary files from atomic writes
*.tmp
```

## ✅ `history.json`（Phase 3）

每個 Workspace 一份，**新的在前**。只存未替換變數的請求（`{{token}}` 不會變成實際值）與回應摘要，**不存回應 Body**。檔案已列入 `.gitignore`。

```jsonc
{
  "version": 1,
  "entries": [
    {
      "id": "…",
      "type": "http",
      "sentAt": "2026-10-02T03:04:05.678Z",
      "requestId": "9a2e…", // 發送的請求項目；未儲存的分頁為 null
      "environmentName": "dev", // 發送時的環境（僅供顯示）；無環境為 null
      "request": {/* 完整的 HTTP 請求（同請求檔格式），變數未替換 */},
      "result": {
        "kind": "response",
        "status": 200,
        "statusText": "OK",
        "timeMs": 123,
        "sizeBytes": 456
      }
      // 或 { "kind": "error", "code": "TIMEOUT", "message": "…", "timeMs": 30000 }
    },
    {
      // Phase 4：一次 WebSocket 連線（從開始連線到關閉），不存訊息內容
      "id": "…",
      "type": "websocket",
      "sentAt": "…", // 開始連線的時間
      "requestId": "…", // 或 null
      "environmentName": "dev",
      "request": {/* 完整的 WebSocket 請求（同請求檔格式），變數未替換 */},
      "result": {
        "openedAt": "…", // 連線成功的時間；沒連上為 null
        "closedAt": "…",
        "closeCode": 1000, // 沒有建立連線（例如網址錯誤）時為 null
        "closeReason": "",
        "error": null, // 失敗原因（例如 "Unexpected server response: 401"）
        "sent": 3, // 送出的訊息數（含文字心跳）
        "received": 5
      }
    }
    // 看不懂的 type（較新版本寫入的）會原樣保留
  ]
}
```

- 取消的 HTTP 請求不記錄；WebSocket 每次連線（不論成功與否）都記錄一筆。
- 檔案損毀時改名為 `history.json.corrupt-<時間>` 後重新開始（歷史紀錄可以捨棄）。
- **筆數上限由所有 Workspace 共用**（`app-config.json` 的 `history.maxEntries`，預設 200）：超過時刪除所有 Workspace 中最舊的紀錄。為了不用每次讀取所有 Workspace，`<userData>/history-index.json` 記錄每一筆的 Workspace 與時間：

```jsonc
// <userData>/history-index.json
{
  "version": 1,
  "entries": [{ "workspacePath": "/Users/me/Documents/Hachi/My API", "id": "…", "sentAt": "…" }]
}
```

- 開啟 Workspace 時以該 Workspace 的 `history.json` 重建它在索引中的紀錄（例如資料夾從別台電腦同步過來）。
- App 啟動時，`history.json` 已不存在的 Workspace（被搬走或刪除）會從索引移除；刪除 Workspace 時也會移除。
- 索引損毀時直接重建（從開啟的 Workspace 慢慢補回）。

---

## ✅ 共用型別（schema 於 Phase 1 定義，編輯介面在 Phase 2）

```jsonc
// KeyValue：Query Params、Headers、form 欄位、變數共用
{ "id": "…", "key": "Authorization", "value": "Bearer {{token}}", "enabled": true, "description": "" }

// Auth
{ "type": "none" }
{ "type": "bearer", "token": "{{token}}" }
{ "type": "basic", "username": "…", "password": "…" }
{ "type": "apiKey", "key": "X-API-Key", "value": "…", "in": "header" }   // in: "header" | "query"
{ "type": "inherit" }   // 沿用上層 folder / collection
// 決策 128
{ "type": "digest", "username": "…", "password": "…" }
{ "type": "awsSigV4", "accessKeyId": "…", "secretAccessKey": "…", "sessionToken": "", "region": "us-east-1", "service": "execute-api" }
{
  "type": "oauth2",
  "grantType": "client_credentials", // client_credentials | password | authorization_code
  "accessTokenUrl": "https://…/token",
  "authUrl": "", // authorization_code
  "callbackUrl": "", // authorization_code；空白 = http://127.0.0.1:<自動>/callback，只接受本機
  "clientId": "…",
  "clientSecret": "…",
  "scope": "read write",
  "username": "", "password": "", // password grant
  "pkce": true, // authorization_code
  "clientAuth": "header", // header（Basic）| body
  "headerPrefix": "Bearer"
}
```

所有欄位都可用 `{{變數}}`。OAuth 2.0 的 Token 不寫入任何檔案（只在記憶體，決策 128）。

## ✅ `collection.json`

```jsonc
{
  "version": 1,
  "id": "6f1c…", // UUID，建立時產生；改名、搬移都不會變
  "name": "Users API", // 顯示名稱（1–100 字元）
  "headers": [], // KeyValue[]，共用 Headers
  "auth": { "type": "none" }, // Auth
  "variables": [], // Variable[]：KeyValue + "secret": boolean；機密變數的 value 一律留空（值在 .hachi-secrets.json）
  "scripts": { "preRequest": "", "postResponse": "" }, // 決策 126，會執行
  "scriptFlow": "sequential", // sequential（依序）| sandwich（三明治：Post-response 由內而外）
  "order": ["9a2e…", "c41d…"] // 子項目（資料夾 / 請求）的 id，依顯示順序
}
```

## ✅ `folder.json`

```jsonc
{
  "version": 1,
  "id": "9a2e…",
  "name": "Admin",
  "headers": [], // 可覆寫上層的共用 Headers
  "auth": { "type": "inherit" }, // 預設沿用上層
  "scripts": { "preRequest": "", "postResponse": "" }, // 決策 126；順序依 Collection 的 scriptFlow
  "order": []
}
```

Collection / 資料夾的 Headers 與 Auth 在 Phase 2 有編輯介面（點選 Collection 或資料夾）。Collection 的 `auth` 不可為 `inherit`（存檔時改為 `none`）。Collection 變數於 Phase 3 加入（Collection 設定的 Variables 分頁）；同名時環境變數優先。複製 Collection 時機密值一併複製。

### 排序規則（`order` 與 `collectionOrder`）

- 存的是 **id**，不是檔名：重新命名只需改動該項目自己的檔案。
- 拖曳排序只改動父層的一個檔案；跨資料夾移動會搬移檔案，並更新新舊兩個父層的 `order`。
- 磁碟上存在、但不在 `order` 中的項目（手動新增、git 合併進來）依名稱排在最後；`order` 中已不存在的 id 直接忽略，並在下次寫入時清掉。

### 掃描時的容錯

| 情況                                                                 | 處理方式                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 資料夾內沒有 `collection.json` / `folder.json`（在 Finder 手動建立） | 自動補寫一個（名稱 = 資料夾名稱），視為正常項目                            |
| 兩個檔案的 `id` 相同（在 Finder 複製檔案）                           | 後讀到的那個自動改用新的 id 並寫回                                         |
| JSON 損毀、缺少必要欄位或 `version` 太新                             | 在樹上以錯誤圖示顯示（id 為 `invalid:<相對路徑>`），只能刪除，不會覆寫該檔 |
| 以 `.` 開頭的檔案 / 資料夾、原子寫入暫存檔、非 `.json` 檔            | 忽略                                                                       |

## ✅ 請求檔 `<request>.json`

Phase 1 驗證所有請求共通的欄位：

| 欄位      | 型別                    | 說明                        |
| --------- | ----------------------- | --------------------------- |
| `version` | `1`                     |                             |
| `id`      | string                  | UUID                        |
| `type`    | `"http" \| "websocket"` |                             |
| `name`    | string（1–100）         | 顯示名稱                    |
| `method`  | string（選填）          | HTTP 方法，樹狀清單的標籤用 |

HTTP 與 WebSocket 的完整欄位見下面兩節（後續 Phase 新增欄位一律附預設值，不升版）。

### ✅ HTTP 請求（Phase 2 定案，`src/shared/schemas/http-request.ts`）

所有欄位都有預設值，Phase 1 建立的檔案可直接讀取。

```jsonc
{
  "version": 1,
  "id": "…",
  "type": "http",
  "name": "Get users",
  "method": "GET", // GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS（讀取時轉大寫）
  "url": "https://api.example.com/users", // 照輸入保存；發送時才接上 params
  "params": [], // KeyValue[]：啟用且 key 不為空的列，發送時接在 URL 的 query 之後
  "headers": [], // KeyValue[]
  "body": {
    "mode": "none", // none | json | raw | formData | urlencoded
    // 各模式的內容分開保存，切換模式不會遺失
    "json": "",
    "raw": "",
    "rawContentType": "text/plain",
    "formData": [
      // { id, key, enabled, type: "text" | "file", value, filePath, description? }
      // filePath 為本機絕對路徑，換電腦可能不存在
    ],
    "urlencoded": [] // KeyValue[]
  },
  "auth": { "type": "inherit" }, // 見「共用型別」的 Auth
  "settings": {
    "timeoutMs": null, // null = 沿用 Workspace；0 = 不限
    "validateSSL": null, // null = 沿用 Workspace
    "followRedirects": null, // null = 沿用 Workspace（次數上限一律用 Workspace 的 maxRedirects）
    "useProxy": true, // false = 這個請求不使用 App 的 Proxy 設定
    "useCookieJar": true // false = 不帶上、也不保存 Workspace Cookie Jar 的 Cookie（決策 129）
  },
  "scripts": {
    "preRequest": "", // 發送前執行的 JavaScript（最多約 1 MB），見 docs/ipc.md「腳本」
    "postResponse": "" // 收到回應後執行的 JavaScript
  },
  "extractions": [
    // 從回應擷取變數（決策 73 / 81），收到回應後、Post-response 腳本之前執行
    {
      "id": "…",
      "enabled": true,
      "source": "jsonBody", // jsonBody | header | status | body
      "path": "data.token", // JSON 路徑 / Header 名稱 / body 的 Regex（取第 1 個群組）；空白＝整個 JSON 或 Body
      "variable": "token",
      "scope": "runtime" // runtime（暫存變數，預設）| environment（寫入目前環境）
    }
  ],
  "assertions": [
    // 斷言（決策 73），最後執行
    {
      "id": "…",
      "enabled": true,
      "target": "jsonBody", // status | responseTime | header | jsonBody | body
      "path": "data.items[0].id", // header 名稱或 JSON 路徑（其他 target 不用）
      "operator": "eq", // eq | neq | contains | notContains | exists | notExists | gt | gte | lt | lte | matches | isType
      "expected": "{{userId}}" // 執行時替換變數；isType 用 string / number / boolean / object / array / null
    }
  ],
  "docs": "" // Markdown 說明（Bruno 的 docs；OpenAPI 匯出時當作 description），最多約 1 MB
}
```

- **JSON 路徑**：`data.items[0].id`、`$.data`、`data["key with space"]`；空白或 `$` 為整個 JSON。
- **比較規則**：依實際值的型別比較——字串直接比對；數字以 `Number(預期值)` 比較；布林 / null 比對文字 `true` / `false` / `null`；物件 / 陣列以 `JSON.parse(預期值)` 深度比較。`contains`：字串包含、陣列含有相等的元素、物件含有該 key。
- **擷取的值**：字串照原樣，其他 JSON 值以 `JSON.stringify` 存成文字。

`collection.json` / `folder.json` 也有同樣形狀的 `scripts`，會在請求的腳本之前（Post-response 依 `scriptFlow`）執行（決策 126，取代決策 70）。

### ✅ WebSocket 請求（Phase 4 定案，`src/shared/schemas/ws-request.ts`）

所有欄位都有預設值；Phase 1 建立的檔案（含舊的 `autoReconnect` 等欄位）可直接讀取，不認識的欄位會保留。

```jsonc
{
  "version": 1,
  "id": "…",
  "type": "websocket",
  "name": "Chat",
  "url": "wss://chat.example.com/socket", // 沒有 scheme 時補 ws://；只接受 ws / wss
  "params": [], // KeyValue[]，連線時接在 URL 後面
  "headers": [], // KeyValue[]，握手時送出（沿用上層 Headers，同 HTTP）
  "subprotocols": ["chat.v2"], // Sec-WebSocket-Protocol（空字串忽略）
  "auth": { "type": "inherit" }, // 同 HTTP；API Key 可加在 Header 或 Query
  "settings": {
    "connectTimeoutMs": null, // 握手逾時；null = 沿用 Workspace 的 timeout，0 = 不限
    "validateSSL": null, // null = 沿用 Workspace
    "useProxy": true, // 使用 App 的 Proxy（HTTP CONNECT）
    "heartbeat": {
      "enabled": false,
      "mode": "ping", // "ping"：WebSocket Ping frame；"text"：送出 payload 文字訊息
      "intervalMs": 30000, // 1000–3600000
      "payload": "" // mode 為 text 時送出的內容，可用 {{變數}}
    },
    "closeCode": 1000, // 按「中斷」時送出：1000 或 3000–4999
    "closeReason": "" // 最多 123 bytes（UTF-8）
  },
  "messageTemplates": [
    // 訊息範本（會提交到 git，機密請用 {{變數}}）
    { "id": "…", "name": "Hello", "format": "json", "content": "{\"hi\":\"{{user}}\"}" }
    // format：text | json | binary-hex | binary-base64
  ]
}
```

- 不提供自動重連（決策 54）。
- 網址、Params、Headers、Auth、子協定的 `{{變數}}` 在連線時替換；訊息內容（含範本、文字心跳）在送出時替換（決策 52）。
- 訊息紀錄只存在記憶體（每個分頁最多 `app-config.json` 的 `websocket.messageLimit` 則），需要時從畫面匯出成 JSON 或純文字。

## ✅ `environments/<env>.json` 與 `.hachi-secrets.json`（Phase 3）

```jsonc
// environments/dev.json（可提交；檔名為名稱的 slug，改名時一併改檔名）
{
  "version": 1,
  "id": "env-uuid",
  "name": "dev",
  "variables": [
    { "id": "v1", "key": "baseUrl", "value": "https://dev.example.com", "enabled": true, "secret": false },
    { "id": "v2", "key": "token", "value": "", "enabled": true, "secret": true }   // 機密值一律留空
  ]
}

// .hachi-secrets.json（已在 .gitignore，不提交）
{
  "version": 1,
  "environments": { "env-uuid": { "v2": "actual-secret-value" } },   // 環境 id → 變數 id → 值
  "collections": { "collection-uuid": { "v9": "…" } }                // Collection id → 變數 id → 值
}
```

- 儲存時先寫 `.hachi-secrets.json`，再寫環境檔 / `collection.json`，所以即使中途失敗，可提交的檔案也不會含有機密值。取消「機密」勾選時，值移回可提交的檔案並從機密檔刪除。
- `.hachi-secrets.json` 損毀時回報 `INVALID_FILE`，不會覆寫（避免機密值遺失）。
- 刪除環境 / Collection 時保留機密值（從垃圾桶還原後仍可使用）。
- 兩個環境檔的 `id` 相同（例如在 Finder 複製）時，依檔名排序後讀到的那個改用新的 id。
- 之後若接 macOS Keychain，會作為另一種機密儲存後端（以 Workspace id + 變數 id 為 key），`.hachi-secrets.json` 保留為預設 / 後備。

## ✅ `<userData>/sessions/<sha1(workspacePath)>.json`（Phase 3）

每個 Workspace 在這台電腦上次開啟的分頁與目前環境。存在 userData（不進 Workspace / git）；損毀或遺失時當作沒有分頁。

```jsonc
{
  "version": 1,
  "workspacePath": "/Users/me/Documents/Hachi/My API", // 方便人工查看；檔名是這個路徑的 SHA-1
  "tabs": [{ "kind": "item", "id": "9a2e…" }, { "kind": "environments" }], // 最多 100 個
  "activeTab": 0, // tabs 的索引；null = 沒有
  "activeEnvironmentId": "env-uuid" // null = 無環境
}
```

- 未儲存的新請求分頁不記錄；關閉前一定會詢問是否儲存，所以不保存未儲存的內容。
- 已不存在的項目在還原時略過。刪除 Workspace 時一併刪除它的 session 檔。

## ✅ 匯入 / 匯出（Phase 5a，`src/shared/transfer/`）

匯入一律建立新的項目（所有 id 重新產生），不會覆寫既有檔案；Collection / 環境名稱已存在時加上 ` copy`（決策 15）。寫入途中失敗時刪除寫了一半的 Collection 資料夾。

### Postman Collection（v2.0 / v2.1）→ Hachi

| Postman                                                                                                                                                                                                                                                                                    | Hachi                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `info.name`                                                                                                                                                                                                                                                                                | Collection 名稱（空白時 `Imported Collection`；名稱超過 100 字截斷）                                                                             |
| `item[]` 有 `item` 的項目                                                                                                                                                                                                                                                                  | 資料夾（最多 32 層）；Postman 資料夾變數不支援（提示）                                                                                           |
| `item[]` 有 `request` 的項目                                                                                                                                                                                                                                                               | HTTP 請求；`request` 為字串時視為 GET 該網址（v2.0）                                                                                             |
| `request.method`                                                                                                                                                                                                                                                                           | 轉大寫；Hachi 不支援的方法改為 GET（提示）                                                                                                       |
| `request.url.raw` + `query[]`                                                                                                                                                                                                                                                              | URL 欄位（去掉 query）+ Params（含停用的）；只有結構化欄位時由 protocol / host / port / path 組出                                                |
| `url.variable[]`（`/:id`）                                                                                                                                                                                                                                                                 | 有值時直接代入網址；沒有值的 `:name` 保留並提示改用 `{{變數}}`                                                                                   |
| `request.header[]`（或 v2.0 的多行字串）                                                                                                                                                                                                                                                   | Headers（`disabled` → 停用；`description` 保留）                                                                                                 |
| body `raw`                                                                                                                                                                                                                                                                                 | `options.raw.language` 為 `json`（或沒有 language 但 Content-Type 含 json）→ JSON；其餘 → Raw，Content-Type 取 Header 或 language                |
| body `urlencoded` / `formdata`                                                                                                                                                                                                                                                             | x-www-form-urlencoded / Form-data（檔案欄位只取第一個 `src`，路徑來自原本的電腦，提示）                                                          |
| body `graphql`                                                                                                                                                                                                                                                                             | JSON Body `{ "query": …, "variables": … }`（Postman 也是這樣送出；提示）                                                                         |
| body `file`                                                                                                                                                                                                                                                                                | none（提示）                                                                                                                                     |
| `auth`：`noauth` / `inherit` / `bearer` / `basic` / `apikey`                                                                                                                                                                                                                               | None / 沿用上層 / Bearer / Basic / API Key（`in: query` → Query）；請求沒有 `auth` → 沿用上層；Collection 沒有 → None                            |
| `auth`：`digest` / `awsv4`（`accessKey` / `secretKey` / `sessionToken` / `region` / `service`）                                                                                                                                                                                            | Digest / AWS Signature（決策 128）                                                                                                               |
| `auth`：`oauth2`（`grant_type`：`client_credentials` / `password_credentials` / `authorization_code` / `authorization_code_with_pkce`；`accessTokenUrl`、`authUrl`、`redirect_uri`、`clientId`、`clientSecret`、`scope`、`username`、`password`、`client_authentication`、`headerPrefix`） | OAuth 2.0；`implicit` → None（提示）；Token 本身不匯入；`addTokenTo: queryParams` 改用 Header（提示）                                            |
| 其他 auth（`ntlm`、`hawk`…）                                                                                                                                                                                                                                                               | None（提示）                                                                                                                                     |
| `event[]` `prerequest` / `test`                                                                                                                                                                                                                                                            | `scripts.preRequest` / `scripts.postResponse`（停用的腳本不匯入）；Collection / 資料夾的腳本也會執行，Collection 的 `scriptFlow` 為 `sequential` |
| `protocolProfileBehavior.disableStrictSSL` / `followRedirects: false`                                                                                                                                                                                                                      | `settings.validateSSL: false` / `settings.followRedirects: false`                                                                                |
| `variable[]`                                                                                                                                                                                                                                                                               | Collection 變數（`type: "secret"` → 機密）                                                                                                       |
| `response[]`（Examples）                                                                                                                                                                                                                                                                   | 不匯入（提示）                                                                                                                                   |

### Postman Environment / Globals → Hachi

`name` → 環境名稱（Globals 沒有名稱時為 `Globals`）；`values[]` → 變數（`enabled: false` → 停用；`type: "secret"` → 機密變數，值寫入 `.hachi-secrets.json`）。

### Hachi → Postman Collection v2.1

| Hachi                                                 | Postman                                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Collection / 資料夾 / HTTP 請求                       | `info` + `item[]`（依顯示順序）；WebSocket 請求略過並列出                                             |
| Collection / 資料夾的共用 Headers                     | Postman 沒有共用 Headers：併入每個請求（請求自己已有同名的啟用 Header 時不加；提示）                  |
| URL + Params                                          | `url.raw`（含啟用的 query）+ `protocol` / `host` / `port` / `path` / `query[]`（停用的標 `disabled`） |
| Auth 沿用上層 / None                                  | 不寫 `auth`（Postman 視為沿用）/ `{ "type": "noauth" }`（Collection 層級的 None 不寫）                |
| Bearer / Basic / API Key                              | `bearer` / `basic` / `apikey` 屬性陣列                                                                |
| JSON / Raw Body                                       | `raw` + `options.raw.language`；Raw 的 Content-Type 不是 language 預設值時另加 `Content-Type` Header  |
| `scripts`                                             | `event[]`（`prerequest` / `test`）                                                                    |
| `settings.validateSSL` / `followRedirects` 為 `false` | `protocolProfileBehavior`；請求的 timeout 與「不使用 App 的 Proxy」無法對應（提示）                   |
| Collection 變數                                       | `variable[]`（`type: "string"`）；**機密變數的值留空**                                                |
| 損毀的項目                                            | 略過並列出                                                                                            |

### Bruno → Hachi（`src/shared/transfer/bruno*.ts`、`bru-lang.ts`，決策 103 / 104 / 107）

來源：

- `.bru` 的 Collection 資料夾（有 `bruno.json`）
- Bruno 3 的 OpenCollection YAML 資料夾（有 `opencollection.yml`，見下方 YAML 對照）
- Bruno 匯出的 Collection JSON（有 `items` 陣列、沒有 Postman 的 `info`）
- Collection 裡的子資料夾（兩種標記檔都沒有）：當成一個 Collection，名稱取 `folder.bru` / `folder.yml` 的 name（沒有就用資料夾名稱），它的 Headers / Auth / 變數成為 Collection 層級；上層的設定與環境沒有匯入（提示）

選的資料夾本身不是 Collection 時，main 往下找子資料夾中的 Collection（最多 4 層、200 個；略過 `.` 開頭與 `node_modules`，不進入已找到的 Collection）：找到多個時由使用者勾選，找到一個直接匯入，都沒有時當成子資料夾匯入。

所有來源先讀成同一個 Bruno 資料模型（`bruno-model.ts`），再依下表對應。環境命名為「Collection 名稱 / 環境名稱」（Hachi 的環境是整個 Workspace 共用）。

| Bruno                                                      | Hachi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bruno.json` 的 `name`                                     | Collection 名稱                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 子資料夾（`folder.bru` 的 `meta.name` / `seq`）            | 資料夾（名稱沒有 `folder.bru` 時用資料夾名稱）；依 `seq` 排序；資料夾變數不支援（提示）                                                                                                                                                                                                                                                                                                                                                                                                    |
| `.bru`（`meta.type: http` / `graphql`）                    | HTTP 請求，依 `seq` 排序；GraphQL 轉成 JSON Body `{ query, variables }`（提示）；其他類型略過（提示）                                                                                                                                                                                                                                                                                                                                                                                      |
| `get { url }` 等方法區塊                                   | 方法 + URL；`params:path` 的值代入 `:name`，query 移到 Params                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `params:query`、`headers`、`body:form-urlencoded`          | Params / Headers / x-www-form-urlencoded（`~` 開頭 → 停用）                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `body:json` / `text` / `xml`、`body:multipart-form`        | JSON / Raw（Content-Type 對應）/ Form-data（`@file(path)` → 檔案欄位）                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `auth`：`none` / `inherit` / `bearer` / `basic` / `apikey` | None / 沿用上層 / Bearer / Basic / API Key；`digest` → Digest、`awsv4` → AWS Signature（`profileName` 不支援，提示）、`oauth2`（`grant_type` / `grantType` 為 client_credentials / password / authorization_code）→ OAuth 2.0（`credentials_placement: body` → `clientAuth: body`、`token_header_prefix`、`pkce`）；其他（implicit、NTLM、WSSE…）→ None（提示）。匯出時對應回同樣的區塊（`.bru` 的 `auth:digest` / `auth:awsv4` / `auth:oauth2`，YAML 的 `type: digest / awsv4 / oauth2`） |
| `collection.bru`                                           | Collection 的 Headers、Auth、`vars:pre-request` → Collection 變數；腳本保留但不執行（提示）                                                                                                                                                                                                                                                                                                                                                                                                |
| `assert`（`res.status: eq 200`…）                          | 斷言表格：`eq / neq / gt / gte / lt / lte / contains / notContains / matches`、`isDefined` → exists、`isString` 等 → isType、`startsWith / endsWith` → matches；其他（`length`、`between`…）略過（提示）                                                                                                                                                                                                                                                                                   |
| `vars:pre-request`                                         | Pre-request 腳本開頭的 `bru.setVar(name, bru.interpolate(value))`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `vars:post-response`                                       | 單純路徑（`res.body.a.b`、`res.headers.x`、`res.status`）→ 擷取表格（暫存變數）；其他運算式 → `bru.setVar(name, 運算式)` 腳本                                                                                                                                                                                                                                                                                                                                                              |
| `script:pre-request` / `script:post-response`、`tests`     | `scripts.preRequest` / `scripts.postResponse`（`tests` 接在後面）；用到不支援的 API（`bru.cookies`、`process.env`、`bru.runner.skipRequest` 等）時提示；Collection / 資料夾的腳本也會執行，`scripts.flow` 對應 `scriptFlow`（沒寫時三明治，決策 126）                                                                                                                                                                                                                                      |
| `docs`                                                     | `docs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `environments/*.bru`                                       | 環境（`vars:secret` 只有名稱 → 空值的機密變數，提示重新輸入）                                                                                                                                                                                                                                                                                                                                                                                                                              |

OpenCollection YAML 與 `.bru` 的對照（YAML 讀進同一個模型）：

| YAML                                                                                                                        | 對應的 `.bru`                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `opencollection.yml`：`info.name`、`request.headers / auth / variables / scripts`                                           | `bruno.json` 的 name、`collection.bru`                                                                        |
| `folder.yml`：`info.name / seq`、`request.*`（沒有 `auth` 時視為沿用上層）                                                  | `folder.bru`                                                                                                  |
| 請求 `*.yml`：`info.name / type / seq`、`http.method / url / params[] / headers[] / body / auth`                            | `meta`、方法區塊、`params:*`、`headers`、`body:*`、`auth:*`（沒有 `auth` → None，`auth: inherit` → 沿用上層） |
| `body.type`：`json` / `text` / `xml`（`data`）、`form-urlencoded` / `multipart-form`（`data[]`，檔案的 `value` 是路徑陣列） | 對應的 `body:*` 區塊                                                                                          |
| `graphql:` 區段（`body.query / variables`）                                                                                 | `body:graphql`（轉成 JSON Body）                                                                              |
| `runtime.variables[]`                                                                                                       | `vars:pre-request`                                                                                            |
| `runtime.actions[]`（`set-variable`、`selector.expression`）                                                                | `vars:post-response`                                                                                          |
| `runtime.scripts[]`（`before-request` / `after-response` / `tests`）                                                        | `script:*`、`tests`                                                                                           |
| `runtime.assertions[]`（`expression` / `operator` / `value`）                                                               | `assert`                                                                                                      |
| `settings.timeout` / `followRedirects`                                                                                      | （`.bru` 沒有）→ 請求的逾時（0 = 用 Workspace 設定）/ 跟隨轉址                                                |
| `docs`、`environments/*.yml`（`variables[]`，`secret: true` 只有名稱；值可為 `{ type, data }`）                             | `docs`、`environments/*.bru`                                                                                  |

不是 Bruno 的 `.yml`（沒有 `info` 或對應區段，例如 CI 設定）會略過；`.bru` Collection 不讀 `.yml`，YAML Collection 不讀 `.bru`。

### Hachi → Bruno 資料夾

匯出時可選 **YAML**（OpenCollection：`opencollection.yml`、`folder.yml`、`<名稱>.yml`、`environments/<環境>.yml`，會寫出請求的逾時 / 轉址設定）或 **.bru**（如下）。環境名稱開頭的「Collection 名稱 / 」會去掉。

`bruno.json`、`collection.bru`（Headers、Auth、Collection 變數）、每個資料夾的 `folder.bru`、每個 HTTP 請求一個 `<名稱>.bru`（檔名去掉不合法字元，重名加數字）、`environments/<環境>.bru`（Workspace 的所有環境；**機密變數只寫名稱**）。擷取表格 → `vars:post-response`（Regex 擷取改為整個 Body、存到環境的擷取變成暫存變數，提示）；斷言 → `assert`；腳本原樣寫出（用了 `hachi.*` 時提示）；請求的逾時 / SSL 設定無法對應（提示）。WebSocket 略過。

### Hachi → OpenAPI 3.0（`src/shared/transfer/openapi.ts`，決策 105）

| Hachi                                                 | OpenAPI                                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collection 名稱                                       | `info.title`（`version: 1.0.0`）                                                                                                                                                       |
| URL 開頭的 `{{變數}}` 或 `https://host`               | `servers`（變數用 Collection 變數＋所選環境的值；最常用的放在文件層級，其他放在 operation）；沒有值時提示                                                                              |
| 路徑中的 `{{x}}` / `:x`                               | `{x}` path 參數（必填，範例為變數值）                                                                                                                                                  |
| Params、URL 中的 query                                | query 參數（選填，範例為值）                                                                                                                                                           |
| 請求與上層（Collection / 資料夾）的 Headers           | header 參數；`Authorization` / `Content-Type` / `Accept` 不列（由 security / requestBody 表示）                                                                                        |
| JSON / Raw / urlencoded / Form-data Body              | `requestBody`：JSON 附範例與推導的 schema（不是有效 JSON 時只附原文，提示）；GET / HEAD 不寫                                                                                           |
| Auth（沿用上層時往上找）                              | `components.securitySchemes`（`bearerAuth` / `basicAuth` / `digestAuth` / `apiKey_<in>_<name>` / `oauth2_<flow>`，AWS Signature 不輸出）與 operation `security`；None → `security: []` |
| 資料夾路徑                                            | `tags`（`A / B`）                                                                                                                                                                      |
| 請求名稱 / `docs`                                     | `summary` / `description`                                                                                                                                                              |
| 啟用的 `status eq N` 斷言                             | `responses.N`（狀態碼說明）；沒有時 `default`                                                                                                                                          |
| 同一路徑＋方法的第二個請求、沒有網址的請求、WebSocket | 略過（提示 / 列出）                                                                                                                                                                    |

### cURL 匯入（`src/shared/transfer/curl.ts`）

- 斷詞：POSIX shell（單 / 雙引號、`$'…'`、`\` 跳脫與換行接續、`#` 註解）；含 `^"` 或 `^` 換行時改用 Windows cmd 規則（瀏覽器的「Copy as cURL (cmd)」）。開頭的 `$ ` 提示字元與 `curl.exe` 也接受。
- 支援：`-X`、`-H`、`-d` / `--data` / `--data-raw` / `--data-binary` / `--data-ascii` / `--data-urlencode`、`--json`、`-F` / `--form` / `--form-string`、`-u`、`--oauth2-bearer`、`-A`、`-e`、`-b`（Cookie 字串）、`-G`、`-I`、`-k`、`-m`、`--url`，以及合併的短選項（`-sSL`、`-XPOST`）。
- 方法：`-X` > `-I`（HEAD）> 有 Body 時 POST > GET。`-G` 把 data 放進 Params。
- Body：有 `-F` → Form-data；Content-Type 含 json 或內容是 JSON → JSON；`a=1&b=2` 形式（且沒有其他 Content-Type）→ x-www-form-urlencoded（值會解碼）；其餘 → Raw（Content-Type 預設 `application/x-www-form-urlencoded`，同 curl）。與 Body 模式重複的 Content-Type Header 會移除。
- URL 照原樣放進 URL 欄位（含 query）；請求名稱為「方法 + 網址（不含 scheme 與 query）」。沒有指定 Auth 時為「沿用上層」。
- 不匯入、只提示：讀檔（`@file`、`<file`、`-T`）、Proxy（使用 App 設定）、`--digest` / `--ntlm` 等驗證、不認得的選項。`-L` 與輸出相關的選項（`-s`、`-o`、`-v`…）忽略。

## ✅ Runner 結果匯出（Phase 5c）

`runner:export` 寫出的 JSON（不在 Workspace 中，由使用者選擇位置）：

```jsonc
{
  "hachi": "runner-result",
  "version": 1,
  "target": "Shop", // Collection / 資料夾名稱
  "environment": "dev",
  "startedAt": "2026-10-03T12:00:00.000Z",
  "durationMs": 1234,
  "status": "done", // done | cancelled | stopped | error
  "message": null,
  "settings": {
    "iterations": 3, // 持續時間模式為 null
    "durationSec": null, // 決策 130：持續時間模式的秒數
    "concurrency": 2,
    "delayMs": 0,
    "stopOnFailure": false,
    "keepBodies": true,
    "dataFile": "users.csv",
    "skipScripts": false
  },
  "requests": [{ "id": "…", "name": "Ping", "method": "GET", "path": "Shop / Ping" }],
  "skipped": [], // 略過的 WebSocket / 無法讀取的項目
  "stats": { "items": [], "total": {}, "statusCodes": {}, "errorCodes": {}, "timeline": [] }, // RunnerStats
  "rows": [
    // RunnerRow；保留細節的列另有 requestHeaders / responseHeaders / body / bodyNote / scriptReport / data
  ]
}
```

`format: "html"` 時寫出同樣內容做成的單一離線 HTML 報告（決策 130；沒有 script、不連外）。

資料檔：CSV（RFC 4180，第一列為欄名，支援引號、`""`、CRLF 與 BOM）或 JSON（物件陣列，非字串的值存成 JSON 文字），上限 10 MB、10,000 列。

## ✅ `<userData>/cookies/<workspace id>.json`（決策 129）

Workspace 的 Cookie Jar，只存在這台電腦（不在 Workspace 資料夾，也不進 git）。回應的 `Set-Cookie` 保存後約 0.5 秒原子寫入，切換 Workspace / 結束 App 前會先寫完；檔案損壞時視為空的 Jar。

```jsonc
{
  "version": 1,
  "cookies": [
    {
      "name": "session",
      "value": "abc",
      "domain": "api.example.com", // 小寫、不含開頭的點
      "hostOnly": true, // 沒有 Domain 屬性：只送給這個主機
      "path": "/",
      "expires": 1791234567000, // ms；null = 工作階段 Cookie（保留到刪除，同 Postman）
      "secure": false,
      "httpOnly": true,
      "sameSite": "Lax", // 只顯示，不影響送出
      "createdAt": 1791230000000
    }
  ]
}
```

規則（RFC 6265，沒有 Public Suffix List）：Domain 屬性必須符合請求主機且含有點；`Secure` Cookie 只能由 https（或 localhost）設定與送出；`Max-Age` 優先於 `Expires`，`Max-Age=0` / 過期即刪除；總數上限 3000、每個網域 180（超過時刪最舊的），每個 Cookie 4 KB。
