/** The HTTP request editor and the response area. */
export const http = {
  unsavedRequest: '尚未儲存的請求',
  unsaved: '有未儲存的修改',
  codeTitle: '產生 cURL / fetch / axios / Python 程式碼',
  saveTitle: '儲存（CmdOrCtrl+S）',
  saveTo: '儲存到…',
  method: 'HTTP 方法',
  urlPlaceholder: 'https://api.example.com/users  或  {{baseUrl}}/users',
  send: '發送',
  queryParam: 'Query 參數',
  paramsHint: '啟用的參數會在發送時加到 URL 後面（URL 欄位裡已寫的 query 也會保留）。',
  body: {
    chooseFileTitle: '選擇要上傳的檔案',
    chooseFile: '選擇檔案',
    noFile: '尚未選擇',
    type: 'Body 類型',
    jsonError: (error: string) => `JSON 格式錯誤：${error}`,
    format: '格式化',
    wrap: '自動換行',
    variables: '可用的變數',
    none: '這個請求不帶 Body。',
    fieldType: '欄位類型',
    fileHint: '檔案欄位會儲存檔案的完整路徑；在其他電腦上開啟這個 Workspace 時，該路徑不一定存在。'
  },
  headers: {
    inherited: '從上層繼承（唯讀，請到來源修改；同名的 Header 以這裡設定的為準）',
    overridden: '已被覆寫',
    from: (name: string) => `來自 ${name}`
  },
  settings: {
    on: '：開',
    off: '：關',
    workspaceDefault: 'Workspace 預設',
    timeoutDefault: (timeout: string) => `（${timeout}）`,
    noLimit: '不限',
    timeoutUnit: 'ms（0 = 不限）',
    ssl: 'SSL 憑證驗證',
    sslOn: '開',
    sslOff: '關（不驗證憑證）',
    redirects: '跟隨重新導向',
    redirectsOn: '跟隨',
    redirectsOff: '不跟隨',
    maxRedirects: (n: number) => `最多 ${n} 次`,
    useProxy: '使用 App 的 Proxy 設定',
    proxyNow: (mode: 'none' | 'system' | 'custom') =>
      `目前：${mode === 'none' ? '未設定' : mode === 'system' ? '系統 Proxy' : '自訂'}`,
    useCookieJar: '使用 Workspace 的 Cookie Jar',
    cookieJarHint: '自動帶上並保存 Cookie'
  },
  response: {
    errors: {
      INVALID_URL: 'URL 格式不正確',
      TIMEOUT: '請求逾時',
      CANCELLED: '已取消請求',
      TLS: 'SSL / TLS 憑證驗證失敗（可在請求的 Settings 關閉 SSL 驗證）',
      PROXY: 'Proxy 連線失敗',
      NETWORK: '無法連線到伺服器',
      TOO_LARGE: '回應超過 100 MB，已中止接收',
      FILE_NOT_FOUND: '找不到檔案（Form-data 或 {{$file:…}}），請求沒有發送',
      FILE_ACCESS: '無法讀取檔案，請求沒有發送',
      TOO_MANY_REDIRECTS: '重新導向次數超過上限（可在 Workspace 設定調整）',
      SCRIPT: '腳本錯誤，請求沒有發送',
      AUTH: '驗證失敗，請求沒有發送',
      UNKNOWN: '發送失敗'
    },
    download: '下載',
    show: '顯示',
    empty: '（回應沒有內容）',
    unknownType: '未知類型',
    binary: (type: string, size: string) =>
      `二進位內容（${type}，${size}），無法直接顯示，請下載後開啟。`,
    large: (size: string) => `回應內容較大（${size}），預設不顯示以免畫面卡頓。`,
    noCookies: '這個回應沒有設定 Cookie。',
    unresolved: '找不到變數，已照原樣送出：',
    sending: '發送中…',
    idle: '按下「發送」查看回應',
    checkPlatforms: '檢查各平台（macOS / iOS、Windows、Mozilla）…',
    redirects: (n: number) => `重新導向 ${n} 次`,
    view: 'Body 檢視方式',
    expandAll: '全部展開',
    collapseAll: '全部收合',
    wrap: '自動換行',
    htmlPreview: 'HTML 預覽',
    jsonTree: 'JSON 樹狀檢視',
    items: (n: number) => `${n} 項`,
    keys: (n: number) => `${n} 個 key`,
    collapse: (path: string) => `收合 ${path}`,
    expand: (path: string) => `展開 ${path}`,
    showMore: (more: number, total: number) => `再顯示 ${more} 項（共 ${total} 項）`
  },
  host: {
    fileError: (error: string) => `無法讀取這個檔案：${error}`,
    fileErrorHint: '請修正 JSON 內容後按「重新讀取」，或從左側刪除。',
    cannotOpen: (error: string) => `無法開啟：${error}`,
    empty: '從左側選擇一個請求，或按右鍵新增項目。'
  },
  container: {
    collection: 'Collection 設定',
    folder: '資料夾設定',
    collectionHint:
      '這裡的 Headers、Auth、變數與腳本會套用到這個 Collection 內的所有請求（請求自己的設定優先；同名變數以環境變數優先）。',
    folderHint: '這裡的 Headers、Auth 與腳本會套用到這個資料夾內的所有請求（請求自己的設定優先）。',
    scriptFlow: '腳本順序',
    sequential: '依序（Postman）',
    sandwich: '三明治（Bruno）',
    flowInherited: (sandwich: boolean) => `${sandwich ? '三明治' : '依序'}（Collection 設定）`,
    sandwichHint:
      'Pre-request：Collection → 資料夾 → 請求；Post-response：請求 → 資料夾 → Collection',
    sequentialHint: 'Pre-request 與 Post-response 都是 Collection → 資料夾 → 請求'
  },
  prompt: {
    reloadTitle: '放棄未儲存的修改？',
    disconnectTitle: '中斷連線並關閉？',
    saveTitle: '要儲存修改嗎？',
    reloadDescription: '重新讀取會以磁碟上的檔案內容取代下列分頁未儲存的修改：',
    disconnectDescription: '下列 WebSocket 分頁仍在連線中，關閉後連線會中斷，訊息紀錄也會清除：',
    saveDescription: '下列分頁有未儲存的修改或仍在連線中：',
    newRequest: '（新請求，儲存時會詢問位置）',
    connected: (dirty: boolean) => `（連線中${dirty ? '，有未儲存的修改' : ''}）`,
    draftsLost: '選擇「不儲存」時，新請求的內容會遺失。',
    discardReload: '放棄並重新讀取',
    disconnectClose: '中斷並關閉',
    dontSave: '不儲存',
    saveAll: '全部儲存'
  },
  scriptTrust: {
    title: '信任這個 Workspace 的腳本？',
    description: (workspace: string | null) =>
      `這個請求有 Pre-request / Post-response 腳本。${workspace ? `「${workspace}」` : '這個 Workspace '}的腳本可能來自匯入的檔案或 git，請確認來源可信。`,
    sandbox: '腳本在沙箱中執行，無法讀寫檔案；可以用 sendRequest 送出其他請求。',
    variables: '腳本可以讀取與修改變數（包含機密值），修改會顯示在回應的 Tests 分頁。',
    remembered: '選擇只記在這台電腦，之後可在 Workspace 設定取消。',
    skip: '這次不執行腳本',
    trust: '信任並執行'
  },
  fileTrust: {
    title: '允許讀取 Workspace 以外的檔案？',
    description: (workspace: string | null) =>
      `這個請求用 {{$file:…}} 讀取下列檔案，內容會送到請求的伺服器。${workspace ? `「${workspace}」` : '這個 Workspace '}的請求可能來自匯入的檔案或 git，請確認來源可信。`,
    hint: 'Workspace 資料夾內的檔案不需要允許。選擇只記在這台電腦，之後可在 Workspace 設定取消。',
    allow: '允許並送出'
  },
  saveResult: {
    title: '儲存結果',
    description:
      '把這次的請求與回應存在請求底下（唯讀，會跟著 Workspace 進 git）。機密變數的值會換回 {{名稱}}，Authorization、Cookie 等憑證 Header 會隱藏。',
    name: '名稱',
    saveRequestFirst: '請先儲存請求，才能把結果存在它底下',
    tooLarge: (mb: number) => `回應超過 ${mb} MB，無法儲存結果`,
    button: '儲存結果',
    buttonTitle: '把這次的請求與回應存在請求底下'
  },
  example: {
    noBody: '（沒有 Body）',
    file: (value: string) => `（檔案）${value}`,
    bodyTitle: (mode: string) => `Body（${mode}）`,
    empty: '（回應沒有內容）',
    image: '回應的圖片',
    binary: (type: string, size: string) => `二進位內容（${type}，${size}），無法直接顯示。`,
    readOnly: '儲存的結果（唯讀）',
    openRequest: '開啟請求'
  },
  code: {
    title: '產生程式碼',
    description: '以目前編輯中的內容（含沿用的 Headers / Auth 與目前環境的變數）產生。',
    language: '語言',
    reveal: '顯示機密值',
    copied: '已複製',
    copy: '複製',
    urlError: (error: string) => `${error}（程式碼使用輸入的網址）`,
    revealed: '機密變數已替換成實際的值，分享程式碼前請留意。',
    kept: '機密變數保留為 {{名稱}}，勾選「顯示機密值」可替換成實際的值。',
    curl: ' cURL 指令以 macOS / Linux 的 shell 引號規則產生。'
  }
}
