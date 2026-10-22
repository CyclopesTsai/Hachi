/** Buttons and words used everywhere. */
export const common = {
  ok: '確定',
  cancel: '取消',
  save: '儲存',
  close: '關閉',
  delete: '刪除',
  rename: '重新命名',
  browse: '瀏覽…',
  loading: '載入中…',
  unlimited: '0 = 不限',
  optional: '（選填）',
  /** App launch / generic failures. */
  operationFailed: '操作失敗',
  bootFailed: 'Hachi 啟動失敗',
  needWorkspaceToImport: '請先建立或開啟 Workspace 再匯入',
  /** Language names, always in their own language. */
  languageNames: { 'zh-TW': '繁體中文', en: 'English' },
  /** A list in running text: 「a、b」. */
  list: (items: string[]) => items.join('、'),
  unresolvedVars: (names: string[]) => `找不到的變數：${names.map((n) => `{{${n}}}`).join('、')}`
}
