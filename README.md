<p align="center">
  <img src="build/icon.png" width="112" alt="Hachi">
</p>

<h1 align="center">Hachi</h1>

<p align="center">
  A desktop API client for HTTP and WebSocket — your requests live as plain JSON files in a folder you choose, ready for git.
</p>

<p align="center">
  <a href="https://github.com/CyclopesTsai/Hachi/releases">Download</a> ·
  <a href="README.zh-TW.md">繁體中文</a>
</p>

![Hachi](docs/screenshot.png)

Hachi is in the spirit of Postman and Bruno: no account, no cloud, no database. A **Workspace** is a folder of JSON files (one file per request), so you can review, share and version your API collections with git. The app's interface is in English or Traditional Chinese, following your system language or your choice in App Settings (native menus are in English).

## Features

- **HTTP requests**: params, headers, five body types (JSON, raw, form-data, x-www-form-urlencoded, none), timeouts, proxy, redirects, SSL options, response viewer with Pretty / Raw / JSON tree / HTML preview
- **WebSocket**: text / JSON / binary messages, message templates, ping and heartbeats, a searchable message log
- **Variables**: environments, collection variables, secret values kept out of git, dynamic variables (`{{$guid}}`, `{{$timestamp}}`…), `{{$file:base64:…}}` for file contents
- **Auth**: Bearer, Basic, API key, OAuth 2.0, Digest, AWS Signature v4
- **Scripts and tests**: JavaScript pre-request / post-response scripts in a sandbox (`await`, `sendRequest`, Postman `pm.*` and Bruno `bru.*` compatibility), assertion tables, variable extraction
- **Collection Runner**: iterations or a time limit, concurrency, data files (CSV / JSON), live charts and statistics, HTML report
- **Saved results**: keep a request and its response under the request, with secrets and credentials hidden
- **Mock Server**: fixed HTTP routes and WebSocket endpoints served from your Workspace
- **Cookie jar** and **TLS certificate checks**: chain diagnosis, whether Mozilla, macOS / iOS and Windows trust a server, and its root’s status in the Apple, Chrome, Microsoft and Mozilla root programs (CCADB)
- **Import / export**: Postman and Bruno (`.bru` and YAML) both ways, cURL import, OpenAPI 3.0 export (HTML / JSON), code generation (cURL, fetch, axios, Python requests)
- **Git**: commit, pull / push, conflict resolution and history inside the app

## Download

Get the latest version from [Releases](https://github.com/CyclopesTsai/Hachi/releases):

| Platform              | File                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| macOS (Apple Silicon) | `Hachi-x.y.z-arm64.dmg`                                                   |
| macOS (Intel)         | `Hachi-x.y.z-x64.dmg`                                                     |
| Windows (x64)         | `Hachi-x.y.z-setup-x64.exe` (installer) or `Hachi-x.y.z-portable-x64.exe` |

The builds are not code-signed yet:

- **macOS**: the first time, macOS blocks the app. Open it once, then go to **System Settings → Privacy & Security** and choose **Open Anyway**.
- **Windows**: SmartScreen shows "Windows protected your PC". Choose **More info → Run anyway**.

Git features use the git installed on your computer ([Git for Windows](https://git-scm.com/download/win) on Windows).

## Build from source

Requirements: Node.js 22.19+ and npm.

```bash
npm install          # also downloads the Electron binary
npm run dev          # run in development mode
npm run verify       # type check, lint, format, unit tests, license check
npm run test:e2e     # end-to-end smoke test (opens a Hachi window)
npm run dist:mac     # macOS .dmg (arm64 and x64)
npm run dist:win     # Windows installer and portable exe (run on Windows)
```

Built with Electron, React, TypeScript, Tailwind CSS and CodeMirror. The format of the Workspace files is described in [docs/schema.md](docs/schema.md).

## License

Copyright © 2026 Hachi contributors.

Hachi is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). Contributions require signing the [CLA](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md). Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
