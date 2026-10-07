# Hachi

Hachi 是一個類似 Postman / Bruno 的桌面 API 測試工具，支援 HTTP 與 WebSocket。所有資料都以 JSON 檔存在你自選的 Workspace 資料夾中，不需要登入、不使用資料庫，適合搭配 git 版本控制。

> 目前版本：**v0.4.0**（macOS、Windows）（[Releases](https://github.com/CyclopesTsai/Hachi/releases)）。HTTP / WebSocket、環境變數、腳本與斷言、Collection Runner、Postman / Bruno / cURL 匯入匯出、OpenAPI 文件（HTML / JSON）匯出、程式碼產生、Git（commit、Pull / Push、衝突處理、History）。開發進度與設計決策見 [docs/progress.md](docs/progress.md)。

## 技術棧

| 項目       | 選擇                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| 桌面框架   | Electron（main / preload / renderer 分離，`contextIsolation` + `sandbox`）         |
| 建置       | electron-vite（Vite 7）、electron-builder                                          |
| UI         | React 19、TypeScript（strict）、Tailwind CSS 4、shadcn/ui（Radix UI）、lucide 圖示 |
| 狀態管理   | Zustand                                                                            |
| HTTP       | undici（在 main process 發送）                                                     |
| WebSocket  | ws + https-proxy-agent（在 main process 連線）                                     |
| 編輯器     | CodeMirror 6                                                                       |
| 驗證       | zod（IPC 輸入與 JSON 檔案）                                                        |
| 測試       | Vitest（單元測試）、Playwright（Electron E2E 冒煙測試）                            |
| 程式碼風格 | ESLint + Prettier                                                                  |

## 開發

需求：Node.js 22.19+（undici 需要）、npm 10+。

`npm install` 完成後會自動執行 `install-electron` 下載 Electron 執行檔（Electron 44 起套件本身不再自動下載）。若 `npm run dev` 出現找不到 Electron 的錯誤，可手動執行 `npx install-electron`。npm 11 對相依套件的 install script 顯示的 `install-scripts` 警告可以忽略。

```bash
npm install
npm run dev          # 啟動開發模式（renderer 支援 HMR）
```

常用指令：

| 指令                              | 說明                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | 開發模式                                                                                                          |
| `npm run build`                   | 建置到 `out/`                                                                                                     |
| `npm start`                       | 以建置結果啟動（preview）                                                                                         |
| `npm test`                        | 單元測試                                                                                                          |
| `npm run test:e2e`                | 建置後啟動真正的 App 跑冒煙測試（測試期間會跳出 Hachi 視窗；Linux 無桌面環境請用 `xvfb-run -a npm run test:e2e`） |
| `npm run typecheck`               | TypeScript 型別檢查                                                                                               |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                                                 |
| `npm run check:licenses`          | 檢查所有隨 App 發佈的套件授權（只允許寬鬆授權，見 CONTRIBUTING.md）                                               |
| `npm run verify`                  | 以上檢查一次跑完                                                                                                  |
| `npm run dist:mac`                | 打包 macOS `.dmg`（arm64 與 x64）                                                                                 |

開發用環境變數：

- `HACHI_USER_DATA_DIR=/path`：改用指定的 userData 目錄（測試用，避免動到真正的設定）。

## 專案結構

```
src/
├─ shared/        main 與 renderer 共用：App 識別（app-info.json）、IPC 合約、zod schema、錯誤碼
├─ main/          Electron main process
│  ├─ platform/   ★ 平台專屬程式碼（darwin.ts / default.ts），其他地方不判斷 process.platform
│  ├─ ipc/        IPC 註冊、輸入驗證、sender 驗證
│  └─ services/   設定檔、Workspace、Collection、環境 / 機密值、歷史紀錄、分頁記憶、HTTP 引擎、WebSocket 連線
├─ preload/       暴露 window.hachi 白名單 API
└─ renderer/      React UI（features/、components/ui/、stores/）
docs/
├─ ipc.md         IPC 介面文件
└─ schema.md      JSON 檔案格式與資料夾結構
```

## App 識別設定

App 名稱、Bundle ID（`tw.com.cyclopes.hachi`）、版權字串集中在 **`src/shared/app-info.json`**。main process 與 `electron-builder.config.mjs` 都從這裡讀取，要換成正式值時只需改這一個檔案（`package.json` 的 `productName` 也請一併確認）。

## 資料存放位置

- App 設定：`app.getPath('userData')/app-config.json`（macOS：`~/Library/Application Support/Hachi/`；Windows：`%APPDATA%\Hachi\`）；同一目錄另有 `history-index.json`（歷史紀錄共用上限的索引）與 `sessions/`（各 Workspace 開啟的分頁與目前環境）
- Workspace：預設 `~/Documents/Hachi/<名稱>/`，可自選。詳細格式請見 [docs/schema.md](docs/schema.md)。
- **機密變數**：環境 / Collection 變數勾選「機密」後，值只存在 `<workspace>/.hachi-secrets.json`（已列入 Workspace 的 `.gitignore`），環境檔與 `collection.json` 裡留空，可以放心提交到 git。`history.json` 也在 `.gitignore` 中。

## 打包（macOS）

```bash
npm run dist:mac     # 產生 release/<version>/Hachi-<version>-arm64.dmg（Apple Silicon）與 -x64.dmg（Intel）
```

- 圖示：`build/icon.png`（1024×1024）是 `node scripts/make-icon.mjs` 產生的佔位圖示，換成正式圖示時直接覆蓋這個檔案即可（electron-builder 會轉成 `.icns`）。
- `app.asar` 只放 main process 執行時需要的套件（renderer 用的套件已由 Vite 打包進 JS），清單在打包時由 `electron-builder.config.mjs` 從 `out/main` 自動算出。
- 打包後的 App 也能跑冒煙測試：`SMOKE_APP_PATH=release/<version>/mac-arm64/Hachi.app/Contents/MacOS/Hachi node scripts/smoke-e2e.mjs`。

目前只有 **ad-hoc 簽章、未經 Apple 公證**（沒有 Apple Developer 憑證）。從網路下載的 App 第一次開啟時會被 macOS 擋下（「無法驗證開發者」或「Apple 無法檢查是否含有惡意軟體」），處理方式：

1. 把 Hachi 拖到「應用程式」後打開一次，出現警告時按「完成」。
2. 到「系統設定 → 隱私權與安全性」，在下方找到 Hachi，按「強制打開」並確認（較舊的 macOS 也可在 Finder 中對 App 按右鍵 →「打開」）。

如果看到「**已損毀，無法打開**」（v0.1.0 的已知問題：簽章不完整，v0.1.1 起已修正），可以先在終端機移除下載標記：

```bash
xattr -dr com.apple.quarantine /Applications/Hachi.app
```

## GitHub Actions（CI 與自動發佈）

| Workflow                        | 觸發                         | 內容                                                                                                                                                                                     |
| ------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | push 到 `main`、Pull Request | Linux（Xvfb）與 Windows 各跑一次 `npm run verify` ＋ E2E 冒煙測試；截圖存成 Actions artifact                                                                                             |
| `.github/workflows/release.yml` | 推送 `v*` tag                | macOS 與 Windows 機器各自 `verify` → 打包（dmg ×2；Windows 安裝程式與免安裝版）→ 對打包後的 App 跑冒煙測試 → 兩邊都通過後**發佈同一個 GitHub Release**（附所有檔案與自動產生的變更說明） |
| 同上                            | Actions 頁面「Run workflow」 | 只打包，檔案存成 Actions artifact（不建立 Release）                                                                                                                                      |

發佈新版本：

```bash
npm version 0.2.0 --no-git-tag-version   # 修改 package.json 的版本
git commit -am "Release 0.2.0"
git tag v0.2.0                            # tag 必須等於 v + package.json 的版本
git push origin main --tags
```

公開 repo 使用 GitHub Actions 的標準機器（含 macOS、Windows）免費。

### macOS 簽章與公證（Developer ID）

設定好下列 GitHub repository secrets 後，推 tag 時 macOS 版會用 Developer ID 簽章（hardened runtime）並送 Apple 公證；沒有設定時照舊用 ad-hoc 簽章（使用者需在「隱私權與安全性」按「強制打開」）。設定在 `electron-builder.config.mjs`（依有沒有 `CSC_LINK` 切換）與 `.github/workflows/release.yml`。

| Secret             | 內容                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `CSC_LINK`         | Developer ID Application 憑證（含私鑰）匯出的 `.p12`，轉成 base64：`base64 -i DeveloperID.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | 匯出 `.p12` 時設定的密碼                                                                                 |
| `APPLE_API_KEY_P8` | App Store Connect API 金鑰檔 `AuthKey_XXXXXXXXXX.p8` 的**完整內容**（含 BEGIN / END 那兩行）             |
| `APPLE_API_KEY_ID` | 該金鑰的 Key ID（10 碼）                                                                                 |
| `APPLE_API_ISSUER` | App Store Connect API 頁面上的 Issuer ID（UUID）                                                         |

1. **憑證**：Xcode → Settings → Accounts → 選開發者帳號 → Manage Certificates → 「+」→ **Developer ID Application**（需要帳號持有人 Account Holder 權限）。完成後在「鑰匙圈存取」的「我的憑證」找到「Developer ID Application: …」，展開確認有私鑰，對憑證按右鍵 → 輸出 → `.p12`，設定密碼。
2. **公證用的 API 金鑰**：[App Store Connect](https://appstoreconnect.apple.com) → 使用者與存取權限 → 整合 → App Store Connect API → 團隊金鑰 → 「+」產生金鑰（存取權限選 Developer）。`.p8` 只能下載一次，記下 Key ID 與 Issuer ID。
3. **GitHub**：repo → Settings → Secrets and variables → Actions → New repository secret，逐一加入上表 5 個值。
4. 推下一個 tag。Release workflow 的「Check the signature」步驟會用 `codesign`、`spctl`、`stapler` 確認簽章與公證。

本機也可以簽：憑證在鑰匙圈時執行 `CSC_NAME="Developer ID Application: 名字 (TEAMID)" npm run dist:mac`，並設定上面三個 `APPLE_API_*` 環境變數（`APPLE_API_KEY` 為 `.p8` 檔的路徑）。

## Windows

Release 中有兩種檔案（x64）：

- `Hachi-x.y.z-setup-x64.exe`：安裝程式，裝在自己的帳號下（不需要系統管理員），可選安裝位置，建立桌面與開始功能表捷徑，可從「設定 → 應用程式」解除安裝。
- `Hachi-x.y.z-portable-x64.exe`：免安裝版，直接執行（每次啟動會先解壓縮，較慢）。

目前沒有程式碼簽章，第一次執行會出現「**Windows 已保護您的電腦**」：按「其他資訊」→「仍要執行」。

- Git 功能需要先安裝 [Git for Windows](https://git-scm.com/download/win)；它附的 Git Credential Manager 會自己跳出登入視窗，沒有時 Hachi 會詢問帳密。
- 建議不要把 Workspace 放在 OneDrive 同步的資料夾（例如被同步的「文件」）：同步程式可能鎖住檔案或產生衝突副本，和 git 互相干擾。
- 本機打包：在 Windows 上執行 `npm run dist:win`（macOS 上打包 Windows 需要 Wine，建議交給 GitHub Actions）。平台差異集中在 `src/main/platform/`。

## 授權

Copyright © 2026 Hachi contributors

Hachi 是自由軟體，以 [GNU Affero General Public License v3.0 or later](LICENSE)（`AGPL-3.0-or-later`）授權：你可以依該授權條款散布與修改本程式。本程式不提供任何擔保，詳見授權條款。

- 散布修改版（包含以網路服務形式提供修改版）時，必須以相同授權公開對應的原始碼。
- 維護者也可能以其他條款（例如商業授權）提供 Hachi；貢獻者需簽署 [CLA](CLA.md)，詳見 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 第三方元件的授權資訊請見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
