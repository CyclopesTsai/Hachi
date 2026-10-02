# Contributing to Hachi

感謝你願意貢獻 Hachi！

## 授權與 CLA

- Hachi 以 **GNU Affero General Public License v3.0 or later**（`AGPL-3.0-or-later`）授權，見 [LICENSE](LICENSE)。
- Hachi 也會在 Mac App Store 以付費版（贊助性質、功能相同）上架，該版本由維護者以 App Store 條款另行散布，因此**所有貢獻都需要先簽署 [CLA](CLA.md)**：你保留著作權，但授權維護者可以用任何授權條款散布你的貢獻。
- 簽署方式：在 pull request 留言「I have read the Hachi Contributor License Agreement (CLA.md) and I hereby sign it.」

## 第三方程式碼與套件

- 隨 App 發佈的相依套件只接受寬鬆授權（MIT、ISC、BSD、Apache-2.0 等），`npm run check:licenses` 會檢查。GPL / LGPL / MPL 等 copyleft 套件雖然與 AGPL 相容，但 App Store 版無法使用 copyleft 套件，因此不接受。
- 複製進專案的第三方程式碼請保留原授權聲明，並記錄在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 開發流程

- 開發、測試與打包方式見 [README](README.md)；目前進度與設計決策見 [docs/progress.md](docs/progress.md)。
- 送出前請執行 `npm run verify`（型別檢查、ESLint、Prettier、單元測試、授權檢查）。
- IPC 或 JSON 格式有變動時，請同步更新 [docs/ipc.md](docs/ipc.md) 與 [docs/schema.md](docs/schema.md)。
