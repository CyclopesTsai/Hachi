import type { Messages } from '../zh-TW'

export const common: Messages['common'] = {
  ok: 'OK',
  cancel: 'Cancel',
  save: 'Save',
  close: 'Close',
  delete: 'Delete',
  rename: 'Rename',
  browse: 'Browse…',
  loading: 'Loading…',
  unlimited: '0 = no limit',
  optional: ' (optional)',
  operationFailed: 'Something went wrong',
  bootFailed: 'Hachi could not start',
  needWorkspaceToImport: 'Create or open a Workspace before importing',
  languageNames: { 'zh-TW': '繁體中文', en: 'English' },
  list: (items) => items.join(', '),
  unresolvedVars: (names) => `Variables not found: ${names.map((n) => `{{${n}}}`).join(', ')}`
}
