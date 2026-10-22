/** Sending requests in main: auth, file variables, request scripts, mock servers. */
export const httpMain = {
  hidden: '（已隱藏）',
  oauth2: {
    empty: (label: string) => `OAuth 2.0 的 ${label} 是空的`,
    invalidUrl: (label: string, text: string) => `OAuth 2.0 的 ${label} 不是有效的網址：${text}`,
    needHttp: (label: string) => `OAuth 2.0 的 ${label} 需要 http:// 或 https://`,
    reasonJoin: '：',
    noAccessToken: '回應中沒有 access_token',
    noContent: '沒有內容',
    tokenFailed: (status: number, detail: string) =>
      `取得 OAuth 2.0 Token 失敗（HTTP ${status}）：${detail}`,
    badCallback: (text: string) => `Callback URL 不是有效的網址：${text}`,
    callbackLoopback: 'Callback URL 需要是 http://127.0.0.1、http://localhost 或 http://[::1]',
    pageOk: '已完成授權',
    pageFailed: '授權失敗',
    pageClose: '可以關閉這個分頁，回到 Hachi。',
    failed: (error: string, description: string | null) =>
      `授權失敗：${error}${description ? `：${description}` : ''}`,
    stateMismatch: 'state 不符，已忽略這個回應',
    noCodeInResponse: '回應中沒有 code',
    noCode: '授權伺服器沒有回傳 code',
    serverFailed: (message: string) => `無法啟動 Callback 伺服器：${message}`,
    timeout: '等待瀏覽器授權逾時',
    cancelled: '已取消',
    cannotListen: (host: string, port: number, message: string) =>
      `無法在 ${host}:${port} 接收 Callback：${message}`,
    expired: 'OAuth 2.0 Token 已過期，請在 Auth 分頁按「取得 Token」重新授權',
    missing: '還沒有 OAuth 2.0 Token，請先在 Auth 分頁按「取得 Token」',
    openBrowser: '無法開啟瀏覽器',
    tokenUrl: (message: string) => `無法連到 Access Token URL：${message}`
  },
  aws: {
    empty: (label: string) => `AWS Signature 的 ${label} 是空的`,
    formData: 'AWS Signature 無法簽署 form-data Body（S3 除外）'
  },
  code: {
    oauth2:
      '還沒有有效的 OAuth 2.0 Token，程式碼中沒有 Authorization（可先送出一次或按「取得 Token」）',
    digest: 'Digest 驗證要先收到伺服器的 401 才能計算，程式碼中沒有 Authorization',
    aws: 'AWS Signature 每次送出時才簽署（有時效），程式碼中沒有簽章'
  },
  tls: {
    needUrl: '請先輸入網址',
    invalidUrl: (text: string) => `網址無效：${text}`,
    unencrypted: '未加密的連線',
    httpsOnly: '只能檢查 https:// 或 wss:// 的網址'
  },
  saveResult: {
    gone: '這個回應已不在暫存中，請重新送出後再儲存',
    tooLarge: (mb: number) => `回應超過 ${mb} MB，無法儲存結果`
  },
  file: {
    format: (name: string) => `{{${name}}} 的格式應為 {{$file:base64:檔案路徑}}`,
    unsupported: (name: string, format: string) =>
      `{{${name}}}：不支援的格式「${format}」（目前只有 base64）`,
    noWorkspace: (name: string) => `{{${name}}}：沒有開啟 Workspace，無法使用相對路徑`,
    untrusted: (paths: string[]) =>
      `要讀取 Workspace 以外的檔案：${paths.join('、')}（請先允許這個 Workspace 讀取外部檔案）`,
    notFile: (path: string) => `不是檔案：${path}`,
    notFound: (path: string) => `找不到檔案：${path}`,
    tooLarge: (mb: number, path: string) => `檔案超過 ${mb} MB：${path}`
  },
  scripts: {
    level: (kind: 'collection' | 'folder', name: string) =>
      `${kind === 'collection' ? 'Collection' : '資料夾'}「${name}」`,
    noEnvironment: '目前沒有選擇環境',
    notInCollection: '這個請求不在 Collection 中',
    untrusted: '這個 Workspace 的腳本尚未信任，沒有發送',
    preRequestError: (label: string | null, error: string) =>
      `${label ? `${label}的 ` : ''}Pre-request 腳本錯誤：${error}`,
    maxDepth: (max: number) => `runRequest 最多巢狀 ${max} 層`,
    requestNotFound: (path: string) => `找不到請求「${path}」`,
    badMethod: (method: string) => `sendRequest 不支援的 HTTP 方法：${method}`,
    badUrl: (url: string) => `sendRequest 的網址需要 http:// 或 https://：${url}`,
    binaryBody: '回應不是文字（二進位內容），腳本無法讀取',
    bodyTooLarge: (mb: number) => `回應超過 ${mb} MB，腳本無法讀取`,
    cannotRun: (message: string) => `無法執行腳本：${message}`,
    logHeader: (label: string) => `── ${label}的腳本 ──`,
    labelled: (label: string, error: string) => `${label}：${error}`,
    captureNoEnvironment: '目前沒有選擇環境，擷取的值沒有存到環境',
    envWriteFailed: (error: string) => `無法寫入環境變數：${error}`,
    collectionWriteFailed: (error: string) => `無法寫入 Collection 變數：${error}`
  },
  mock: {
    portInUse: (port: number) => `連接埠 ${port} 已被使用，請換一個`,
    portDenied: (port: number) => `沒有權限使用連接埠 ${port}（1024 以下的埠需要系統權限）`,
    startFailed: (message: string) => `無法啟動：${message}`,
    noRoute: '沒有符合的 Mock 路由',
    binary: (bytes: number) => `（二進位 ${bytes} bytes）`
  },
  dataFileTooLarge: '資料檔太大（上限 10 MB）',
  variableNotFound: (name: string) => `找不到變數「${name}」`
}
