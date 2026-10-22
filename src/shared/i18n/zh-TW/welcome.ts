/** Welcome screen: create / open a Workspace. */
export const welcome = {
  errors: {
    ALREADY_EXISTS: '這個位置已經有 Workspace 了，請改用「開啟既有 Workspace」。',
    DIR_NOT_EMPTY: '目標資料夾已存在且不是空的，請換一個名稱或位置。',
    NOT_A_WORKSPACE: '這個資料夾不是 Hachi Workspace（找不到 workspace.json）。',
    INVALID_FILE: 'workspace.json 內容損毀或格式不正確。',
    UNSUPPORTED_VERSION: '這個 Workspace 由較新版本的 Hachi 建立，請先更新 Hachi。'
  } as Partial<Record<string, string>>,
  chooseLocation: '選擇 Workspace 存放位置',
  name: '名稱',
  namePlaceholder: '例如：My API',
  location: '存放位置',
  willCreate: '將建立資料夾：',
  creating: '建立中…',
  create: '建立 Workspace',
  noRecent: '尚無最近開啟的 Workspace。',
  current: '目前',
  folderMissing: '找不到資料夾',
  deleteTitle: '刪除 Workspace（移到垃圾桶）',
  deleteLabel: (name: string) => `刪除 ${name}`,
  removeTitle: '從清單移除（不刪除檔案）',
  removeLabel: (name: string) => `從清單移除 ${name}`,
  introFirstRun:
    '歡迎使用 Hachi！先建立第一個 Workspace，所有 Collections、環境變數與歷史紀錄都會存放在其中。',
  intro: '建立新的 Workspace，或開啟既有的 Workspace。',
  createTitle: '建立新的 Workspace',
  createDescription: '每個 Workspace 對應磁碟上的一個資料夾，資料皆以 JSON 檔儲存。',
  recentTitle: '最近開啟',
  recentDescription: '或從磁碟選擇一個既有的 Workspace 資料夾。',
  open: '開啟既有 Workspace…',
  back: (name: string) => `返回「${name}」`,
  language: '語言'
}
