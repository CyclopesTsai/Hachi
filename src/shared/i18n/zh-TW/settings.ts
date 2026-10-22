/** Workspace settings and App settings dialogs. */
export const settings = {
  workspace: {
    title: 'Workspace 設定',
    description: '請求的預設值（每個請求可在自己的 Settings 分頁覆寫）。存在 workspace.json。',
    ssl: 'SSL 憑證驗證',
    sslCheck: '驗證伺服器憑證',
    redirects: '重新導向',
    redirectsFollow: '自動跟隨',
    maxRedirects: '最多跟隨次數',
    maxRedirectsHint: (max: number) => `0–${max} 次`,
    gitAutoFetch: '開啟 Workspace 時自動 Fetch',
    gitAutoFetchHint: '關閉時只在按下 Fetch / Pull 時連線遠端。',
    scriptTimeout: '腳本總時間 (秒)',
    scriptTimeoutHint: '每段腳本，含 sendRequest / sleep 等待',
    scripts: '腳本',
    trustScripts: '信任這個 Workspace 的腳本',
    trustScriptsHint: '只記在這台電腦；不信任時，發送含有腳本的請求前會先詢問。',
    files: '外部檔案',
    trustFiles: '允許 {{$file:…}} 讀取 Workspace 以外的檔案',
    trustFilesHint: '只記在這台電腦；Workspace 資料夾內的檔案一律可以讀取。'
  },
  app: {
    title: 'App 設定',
    description: '存在這台電腦（不會寫進 Workspace），適用所有 Workspace。',
    language: '語言',
    languageSystem: '跟隨系統',
    theme: '外觀',
    themes: { system: '跟隨系統', light: '淺色', dark: '深色' },
    proxyMode: 'Proxy 模式',
    proxyModes: { none: '不使用 Proxy', system: '使用系統 Proxy 設定', custom: '自訂' },
    proxyUser: '帳號（選填）',
    proxyPassword: '密碼（選填）',
    proxyPasswordHint: '密碼以明文存在這台電腦的設定檔（app-config.json），不會寫進 Workspace。',
    proxyBypass: '不經過 Proxy 的主機（每行一個，可用 *.example.com）',
    historyLimit: '歷史紀錄上限',
    historyLimitHint: (min: number, max: number) => `筆（${min}–${max}，所有 Workspace 共用）`,
    historyUsage: (total: number) =>
      `目前共 ${total} 筆。超過上限時，會刪除所有 Workspace 中最舊的紀錄。`,
    historyConfirm: (limit: number, remove: number) =>
      `歷史紀錄上限改為 ${limit} 筆後，會刪除所有 Workspace 中最舊的 ${remove} 筆紀錄。要繼續嗎？`,
    wsMessages: 'WebSocket 訊息',
    wsMessagesHint: (min: number, max: number) => `則／分頁（${min}–${max}，超過時刪除最舊的）`
  },
  legal: {
    notice: (name: string, license: string) =>
      `${name} 是自由軟體，以 ${license}（GNU Affero General Public License 第 3 版或更新版本）授權， 不提供任何擔保。`,
    license: '授權條款',
    source: '原始碼'
  }
}
