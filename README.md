# Hachi

Hachi 是一個類似 Postman / Bruno 的桌面 API 測試工具，支援 HTTP 與 WebSocket。所有資料都以 JSON 檔存在你自選的 Workspace 資料夾中，不需要登入、不使用資料庫，適合搭配 git 版本控制。

> 目前進度：**Phase 0**（專案骨架、安全設定、原生選單、首次啟動建立 Workspace）。

## 技術棧

| 項目       | 選擇                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| 桌面框架   | Electron（main / preload / renderer 分離，`contextIsolation` + `sandbox`）         |
| 建置       | electron-vite（Vite 7）、electron-builder                                          |
| UI         | React 19、TypeScript（strict）、Tailwind CSS 4、shadcn/ui（Radix UI）、lucide 圖示 |
| 狀態管理   | Zustand                                                                            |
| 驗證       | zod（IPC 輸入與 JSON 檔案）                                                        |
| 測試       | Vitest（單元測試）、Playwright（Electron E2E 冒煙測試）                            |
| 程式碼風格 | ESLint + Prettier                                                                  |

## 開發

需求：Node.js 22+、npm 10+。

```bash
npm install
npm run dev          # 啟動開發模式（renderer 支援 HMR）
```

常用指令：

| 指令                              | 說明                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`                     | 開發模式                                                                               |
| `npm run build`                   | 建置到 `out/`                                                                          |
| `npm start`                       | 以建置結果啟動（preview）                                                              |
| `npm test`                        | 單元測試                                                                               |
| `npm run test:e2e`                | 建置後啟動真正的 App 跑冒煙測試（Linux 無桌面環境請用 `xvfb-run -a npm run test:e2e`） |
| `npm run typecheck`               | TypeScript 型別檢查                                                                    |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                      |
| `npm run check:licenses`          | 檢查所有隨 App 發佈的套件授權（只允許 MIT 相容的寬鬆授權）                             |
| `npm run verify`                  | 以上檢查一次跑完                                                                       |
| `npm run dist:mac`                | 打包 macOS `.dmg`（Phase 6 完善）                                                      |

開發用環境變數：

- `HACHI_USER_DATA_DIR=/path`：改用指定的 userData 目錄（測試用，避免動到真正的設定）。

## 專案結構

```
src/
├─ shared/        main 與 renderer 共用：App 識別（app-info.json）、IPC 合約、zod schema、錯誤碼
├─ main/          Electron main process
│  ├─ platform/   ★ 平台專屬程式碼（darwin.ts / default.ts），其他地方不判斷 process.platform
│  ├─ ipc/        IPC 註冊、輸入驗證、sender 驗證
│  └─ services/   設定檔、Workspace、原子寫入
├─ preload/       暴露 window.hachi 白名單 API
└─ renderer/      React UI（features/、components/ui/、stores/）
docs/
├─ ipc.md         IPC 介面文件
└─ schema.md      JSON 檔案格式與資料夾結構
```

## App 識別設定

App 名稱、Bundle ID（`tw.com.cyclopes.hachi`）、版權字串集中在 **`src/shared/app-info.json`**。main process 與 `electron-builder.config.mjs` 都從這裡讀取，要換成正式值時只需改這一個檔案（`package.json` 的 `productName` 也請一併確認）。

## 資料存放位置

- App 設定：`app.getPath('userData')/app-config.json`（macOS：`~/Library/Application Support/Hachi/`）
- Workspace：預設 `~/Documents/Hachi/<名稱>/`，可自選。詳細格式請見 [docs/schema.md](docs/schema.md)。

## 打包（macOS）

```bash
npm run dist:mac     # 產生 release/<version>/Hachi-<version>-arm64.dmg 與 -x64.dmg
```

目前**未簽章、未公證**。使用者首次開啟時需在 Finder 中按右鍵 →「打開」，或到「系統設定 → 隱私權與安全性」允許。

### 之後加入 Apple Developer 簽章與公證（Notarization）

1. 加入 Apple Developer Program，在 Xcode 或 developer.apple.com 建立 **Developer ID Application** 憑證並安裝到 Keychain（CI 上則匯出成 `.p12`）。
2. 在 `electron-builder.config.mjs` 的 `mac` 區塊：
   - 移除 `identity: null`（讓 electron-builder 自動尋找憑證，或填入憑證名稱）
   - 加上 `hardenedRuntime: true`、`gatekeeperAssess: false`
   - 加上 `entitlements` / `entitlementsInherit`（例如 `resources/entitlements.mac.plist`，Electron 需要 `com.apple.security.cs.allow-jit` 等項目）
   - 加上 `notarize: true`
3. 提供公證用的憑證（擇一），以環境變數傳入：
   - App 專用密碼：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
   - App Store Connect API Key：`APPLE_API_KEY`（.p8 路徑）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`
4. CI 上另外設定 `CSC_LINK`（.p12 的路徑或 base64）與 `CSC_KEY_PASSWORD`。
5. 執行 `npm run dist:mac`，完成後可用 `spctl -a -vv /Applications/Hachi.app` 與 `xcrun stapler validate Hachi-x.y.z.dmg` 驗證。

### Windows（規劃中）

`electron-builder.config.mjs` 已預留 `win` 設定（nsis）。平台差異集中在 `src/main/platform/`，新增 Windows 支援時主要修改該處。

## 授權

Hachi 以 [MIT License](LICENSE) 釋出。第三方元件的授權資訊請見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
