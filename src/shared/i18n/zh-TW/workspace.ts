/** Workspace menu, rename / delete dialogs, cookies, environments, history, tabs. */
export const workspace = {
  menu: {
    rename: '重新命名 Workspace…',
    settings: 'Workspace 設定…',
    switch: '切換 Workspace…',
    delete: '刪除 Workspace…'
  },
  reveal: { darwin: '在 Finder 中顯示', win32: '在檔案總管中顯示', other: '在檔案管理員中顯示' },
  renameTitle: '重新命名 Workspace',
  renameDescription: '只會變更顯示名稱，資料夾位置不變。',
  nameLabel: 'Workspace 名稱',
  deleteTitle: (name: string) => `刪除 Workspace「${name}」？`,
  deleteDescription: '整個資料夾（包含所有 Collections、環境與歷史紀錄）會移到系統垃圾桶：',
  moveToTrash: '移到垃圾桶',
  cookies: {
    session: '工作階段',
    filter: '篩選 Cookie',
    filterPlaceholder: '篩選網域或名稱',
    refresh: '重新整理',
    clearAll: '全部清除',
    none: '還沒有 Cookie。',
    noMatch: '沒有符合的 Cookie。',
    clearDomain: '清除這個網域',
    deleteLabel: (name: string) => `刪除 ${name}`,
    description:
      '回應的 Set-Cookie 會自動保存，之後的請求自動帶上（可在請求的 Settings 關閉）。只存在這台電腦。'
  }
}

export const env = {
  deleteTitle: (name: string) => `刪除環境「${name}」？`,
  toTrash: '環境檔會移到系統垃圾桶，需要時可以從垃圾桶還原。',
  runtimeTitle: (count: number) => `暫存變數（${count}）`,
  runtimeHint: '腳本與擷取設定的值，只存在記憶體（App 結束後消失），優先於環境與 Collection 變數',
  clearAll: '全部清除',
  emptyString: '（空字串）',
  deleteLabel: (name: string) => `刪除 ${name}`,
  environments: '環境',
  add: '新增環境',
  list: '環境清單',
  inUse: '目前使用中',
  duplicate: '複製',
  delete: '刪除',
  name: '環境名稱',
  unsaved: '有未儲存的修改',
  active: '使用中',
  setActive: '設為目前環境',
  empty: '還沒有任何環境。建立環境（例如 dev、staging、prod）來切換不同的變數值。',
  create: '建立環境',
  none: '無環境',
  manage: '管理環境…',
  newName: 'New Environment'
}

export const history = {
  error: '錯誤',
  errorDetail: (error: string) => `錯誤：${error}`,
  closeReason: (reason: string) => `：${reason}`,
  counts: (sent: number, received: number) => `送出 ${sent} 則 · 收到 ${received} 則`,
  environment: (name: string) => `環境：${name}`,
  emptyUrl: '（空白 URL）',
  deleteEntry: '刪除這筆紀錄',
  count: (n: number) => `${n} 筆（這個 Workspace）`,
  clearTitle: '清除這個 Workspace 的歷史紀錄',
  clearLabel: '清除歷史紀錄',
  empty: '還沒有紀錄。每次發送請求都會自動記錄在這裡（不含回應內容）。',
  clearConfirmTitle: '清除歷史紀錄？',
  clearConfirm: (n: number) => `會刪除這個 Workspace 的全部 ${n} 筆紀錄，無法復原。`,
  clear: '清除',
  today: '今天',
  yesterday: '昨天',
  usage: (total: number, max: number) => `歷史紀錄：${total} / ${max} 筆（所有 Workspace 共用）`,
  usageWorkspace: (n: number) => `目前 Workspace：${n} 筆`,
  usageFull: '已達上限：新的紀錄會取代最舊的紀錄',
  usageHint: '上限可在 App 設定調整；點一下開啟歷史紀錄',
  usageShort: (percent: number) => `歷史 ${percent}%`
}

export const tabs = {
  connected: '連線中',
  previewTitle: (title: string) => `${title}（預覽：編輯或雙擊後固定）`,
  closeLabel: (title: string) => `關閉 ${title}`,
  unsaved: '有未儲存的修改',
  close: '關閉',
  closeOthers: '關閉其他分頁',
  closeAll: '關閉所有分頁',
  pin: '固定分頁',
  open: '開啟的分頁',
  add: '新增',
  addTitle: '新增請求（尚未儲存，可直接使用）',
  http: 'HTTP 請求',
  environments: '環境',
  mock: (name: string) => `Mock：${name}`,
  runner: (name: string) => `執行：${name}`,
  saveAsTitle: '儲存請求',
  saveAsDescription: '選擇要放進哪個 Collection / 資料夾。',
  saveAsName: '名稱',
  saveAsLocation: '位置',
  saveAsNoCollection: '請先在左側建立一個 Collection。'
}

export const vars = {
  thisRun: '本次執行',
  sources: { runtime: '暫存變數', data: '資料檔', environment: '環境', collection: 'Collection' },
  named: (source: string, name: string) => `${source}「${name}」`,
  secret: (value: string) => `${value}（機密）`,
  emptyString: '（空字串）',
  dynamic: (description: string) => `動態變數：${description}`,
  dynamicDescriptions: {
    $guid: 'UUID v4',
    $timestamp: '目前的 Unix 時間（秒）',
    $isoTimestamp: '目前的 ISO 8601 時間',
    $randomInt: '0–1000 的隨機整數',
    $randomUUID: 'UUID v4（同 $guid）',
    $randomString: '16 個隨機英數字',
    $randomAlphaNumeric: '1 個隨機英數字',
    $randomEmail: '隨機的 Email 地址（example.com）',
    $randomBoolean: 'true 或 false'
  },
  file: (path: string) => `送出時讀取檔案並轉成 base64：${path}`,
  fileFormat: '格式應為 {{$file:base64:檔案路徑}}',
  missing: '找不到這個變數，會照原樣送出',
  readOnly: (detail: string) => `${detail}（這裡不能修改）`,
  valueOf: (name: string) => `${name} 的值`,
  show: '顯示值',
  hide: '隱藏值',
  editHint: 'Enter 儲存、Esc 取消',
  secretHint: '（機密值只存在 .hachi-secrets.json）',
  table: {
    name: '變數名稱',
    value: '值',
    secretTitle: '機密變數：值只存在這台電腦的 .hachi-secrets.json，不會寫進可提交的檔案',
    secret: '機密',
    secretValue: '機密值',
    reveal: '顯示機密值',
    hintBefore: '勾選',
    hintAfter: '的變數為機密：值只存在這台電腦，不會被提交到 git。'
  },
  enabled: '啟用',
  deleteRow: '刪除此列'
}

/** The editor's search box and CodeMirror's own texts. */
export const editor = {
  countMax: (current: number, total: number) => (current ? `${current}/${total}+` : `${total}+ 筆`),
  count: (current: number, total: number) => (current ? `${current}/${total}` : `${total} 筆`),
  none: '沒有結果',
  search: '搜尋',
  replace: '取代',
  replaceAll: '全部取代',
  showReplace: '顯示取代',
  hideReplace: '隱藏取代',
  previous: '上一個（Shift+Enter）',
  next: '下一個（Enter）',
  close: '關閉（Esc）',
  /** CodeMirror's own phrases; null: its English defaults. */
  phrases: {
    Find: '搜尋',
    Replace: '取代',
    next: '下一個',
    previous: '上一個',
    replace: '取代',
    'replace all': '全部取代',
    close: '關閉',
    'current match': '目前的符合項目',
    'on line': '位於第',
    'replaced match on line $': '已取代第 $ 行的符合項目',
    'replaced $ matches': '已取代 $ 個符合項目',
    'Go to line': '前往行號',
    go: '前往'
  } as Record<string, string> | null
}
