# Hachi 資料結構（JSON Schema）

> 版本：Phase 0。標示「✅ 已實作」的格式已定案並有 zod schema；標示「📝 草案」的格式會在對應 Phase 實作時定案，並同步更新本文件。
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
6. **檔名**：由顯示名稱經 `sanitizeFileName()`（`src/shared/file-names.ts`）轉換：保留中文與空白，移除 `<>:"/\|?*` 與控制字元、去掉結尾的點與空白、避開 Windows 保留名稱（`CON`、`NUL`…），長度上限 100 字元。

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
   └─ <collection>/
      ├─ collection.json             📝 Phase 1
      ├─ <request>.json              📝 Phase 1/2（type: "http"）、Phase 4（type: "websocket"）
      └─ <folder>/
         ├─ folder.json              📝 Phase 1
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
  "collectionOrder": [] // collections/ 下的資料夾名稱，依顯示順序
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

## 📝 共用型別（Phase 1–3 定案）

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

## 📝 `collection.json` / `folder.json`（Phase 1）

```jsonc
{
  "version": 1,
  "id": "…",
  "name": "Users API",
  "headers": [/* KeyValue */], // 共用 Headers（folder 可再覆寫）
  "auth": { "type": "none" },
  "variables": [/* KeyValue */], // collection 層級變數（folder.json 無此欄）
  "order": ["get-users.json", "admin"] // 子項目（請求檔名 / 子資料夾名）顯示順序
}
```

排序存在父層的 `order` 陣列：拖曳排序只會修改一個檔案。磁碟上存在、但不在 `order` 中的項目會依名稱排在最後（容忍手動新增或 git 合併）。

## 📝 請求檔 `<request>.json`

HTTP（Phase 2）：

```jsonc
{
  "version": 1,
  "id": "…",
  "type": "http",
  "name": "Get users",
  "method": "GET", // GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS
  "url": "{{baseUrl}}/users",
  "params": [/* KeyValue */],
  "headers": [/* KeyValue */],
  "body": {
    "mode": "none", // none | json | raw | formData | urlencoded
    "json": "",
    "raw": "",
    "formData": [],
    "urlencoded": []
  },
  "auth": { "type": "inherit" },
  "settings": { "timeoutMs": null, "validateSSL": null } // null = 沿用 Workspace 預設
}
```

WebSocket（Phase 4）：

```jsonc
{
  "version": 1,
  "id": "…",
  "type": "websocket",
  "name": "Chat",
  "url": "wss://{{host}}/ws",
  "params": [],
  "headers": [],
  "subprotocols": [],
  "auth": { "type": "inherit" },
  "settings": {
    "autoReconnect": false,
    "reconnectIntervalMs": 3000,
    "heartbeat": { "enabled": false, "intervalMs": 30000, "payload": "" }
  },
  "messageTemplates": [
    { "id": "…", "name": "Ping", "format": "json", "content": "{\"type\":\"ping\"}" }
  ] // format: text | json | binary-hex | binary-base64
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
