# Hachi 資料結構（JSON Schema）

> 版本：Phase 1。標示「✅ 已實作」的格式已定案並有 zod schema；標示「📝 草案」的格式會在對應 Phase 實作時定案，並同步更新本文件。
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
└─ sessions/<sha1(workspacePath)>.json  📝 Phase 3：各 Workspace 的分頁與目前環境（使用者本機狀態，不進 git）

<workspace>/                         # 預設 ~/Documents/Hachi/<名稱>/，可自選
├─ workspace.json                    ✅
├─ .gitignore                        ✅
├─ history.json                      ✅ 骨架（entries 格式 📝 Phase 3）
├─ .hachi-secrets.json               📝 Phase 3：機密變數值（已列入 .gitignore）
├─ environments/
│  └─ <env>.json                     📝 Phase 3
└─ collections/
   └─ <collection>/                  ✅ Phase 1（資料夾名為 slug）
      ├─ collection.json             ✅ Phase 1
      ├─ <request>.json              ✅ 共通欄位（Phase 1）；HTTP 完整欄位 📝 Phase 2、WebSocket 📝 Phase 4
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
  "window": null // Phase 6：{ x?, y?, width, height, isMaximized }
}
```

## ✅ `workspace.json`

```jsonc
{
  "version": 1,
  "id": "0d6c3f0e-…", // UUID，建立時產生，不隨資料夾改名而變
  "name": "My API", // 顯示名稱（1–100 字元）
  "createdAt": "2026-10-01T02:00:00.000Z",
  "settings": {
    "timeoutMs": 30000, // 預設請求逾時，0 = 不限
    "validateSSL": true // 預設 TLS 憑證驗證
    // Phase 2 會補上 proxy 設定（新增欄位附預設值，不升版）
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

## ✅ / 📝 `history.json`

Phase 0 建立骨架 `{ "version": 1, "entries": [] }`。Entry 格式於 Phase 3 定案，方向：

```jsonc
{
  "version": 1,
  "entries": [
    // 新的在前，上限約 200 筆
    {
      "id": "…",
      "type": "http",
      "timestamp": "…",
      "request": {/* 未替換變數的原始請求快照（不含機密值） */},
      "response": { "status": 200, "timeMs": 123, "sizeBytes": 456 } // 只存摘要，不存 body
    },
    {
      "id": "…",
      "type": "websocket",
      "timestamp": "…",
      "url": "wss://…",
      "connectedAt": "…",
      "closedAt": "…",
      "closeCode": 1000,
      "closeReason": "",
      "messageCount": 12 // 訊息內容不存檔
    }
  ]
}
```

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
  "variables": [], // KeyValue[]，Collection 層級變數
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

Collection 層級的 Headers / Auth / 變數在 Phase 1 只定義欄位，編輯介面在 Phase 2 加入。

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

其餘欄位由各自的編輯器在 Phase 2（HTTP）/ Phase 4（WebSocket）定案，屆時以「新增欄位附預設值」的方式加入，不升版。目前新建請求時寫入的預設內容如下。

HTTP（Phase 2 會補齊 body 各模式的欄位）：

```jsonc
{
  "version": 1,
  "id": "…",
  "type": "http",
  "name": "Get users",
  "method": "GET", // GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS
  "url": "",
  "params": [], // KeyValue[]
  "headers": [], // KeyValue[]
  "body": { "mode": "none" }, // none | json | raw | formData | urlencoded
  "auth": { "type": "inherit" },
  "settings": { "timeoutMs": null, "validateSSL": null } // null = 沿用 Workspace 預設
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

## 📝 `environments/<env>.json` 與 `.hachi-secrets.json`（Phase 3）

```jsonc
// environments/dev.json（可提交）
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
  "environments": { "env-uuid": { "v2": "actual-secret-value" } }   // 以 environment id → variable id 對應
}
```

之後若接 macOS Keychain，會作為另一種機密儲存後端（以 Workspace id + 變數 id 為 key），`.hachi-secrets.json` 保留為預設 / 後備。
