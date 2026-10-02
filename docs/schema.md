# Hachi 資料結構（JSON Schema）

> 版本：Phase 3。標示「✅ 已實作」的格式已定案並有 zod schema；標示「📝 草案」的格式會在對應 Phase 實作時定案，並同步更新本文件。
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
└─ sessions/<sha1(workspacePath)>.json  ✅ Phase 3：各 Workspace 的分頁與目前環境（使用者本機狀態，不進 git）

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
      ├─ <request>.json              ✅ 共通欄位（Phase 1）；HTTP 完整欄位 ✅ Phase 2、WebSocket 📝 Phase 4
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
  "theme": "system", // "system" | "light" | "dark"
  "recentWorkspaces": [
    // 最多 10 筆，最新在前
    {
      "path": "/Users/me/Documents/Hachi/My API",
      "name": "My API",
      "lastOpenedAt": "2026-10-01T02:00:00.000Z"
    }
  ],
  "lastWorkspacePath": "/Users/me/Documents/Hachi/My API", // 啟動時自動開啟；null = 無
  "window": null, // Phase 6：{ x?, y?, width, height, isMaximized }
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
    "responseBodyWrap": false // 回應 Body 自動換行（僅影響顯示）
  },
  "history": {
    "maxEntries": 200 // 歷史紀錄筆數上限，所有 Workspace 共用（50–1000）
  }
}
```

`proxy` 與 `ui` 於 Phase 2、`history` 於 Phase 3 加入（新增欄位附預設值，不升版）。

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
    "maxRedirects": 3 // 最多跟隨次數，0–20（Phase 2）
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
    }
    // Phase 4 加入 type: "websocket"；看不懂的 type 會原樣保留
  ]
}
```

- 取消的請求不記錄。
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
```

## ✅ `collection.json`

```jsonc
{
  "version": 1,
  "id": "6f1c…", // UUID，建立時產生；改名、搬移都不會變
  "name": "Users API", // 顯示名稱（1–100 字元）
  "headers": [], // KeyValue[]，共用 Headers
  "auth": { "type": "none" }, // Auth
  "variables": [], // Variable[]：KeyValue + "secret": boolean；機密變數的 value 一律留空（值在 .hachi-secrets.json）
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

WebSocket 的其餘欄位在 Phase 4 定案，以「新增欄位附預設值」的方式加入，不升版。

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
    "useProxy": true // false = 這個請求不使用 App 的 Proxy 設定
  }
}
```

WebSocket（Phase 4 定案）：

```jsonc
{
  "version": 1,
  "id": "…",
  "type": "websocket",
  "name": "Chat",
  "url": "",
  "params": [],
  "headers": [],
  "subprotocols": [],
  "auth": { "type": "inherit" },
  "settings": {
    "autoReconnect": false,
    "reconnectIntervalMs": 3000,
    "heartbeat": { "enabled": false, "intervalMs": 30000, "payload": "" }
  },
  "messageTemplates": [] // { id, name, format: text | json | binary-hex | binary-base64, content }
}
```

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
