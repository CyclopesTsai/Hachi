import type { Messages } from '../zh-TW'

export const workspace: Messages['workspace'] = {
  menu: {
    rename: 'Rename Workspace…',
    settings: 'Workspace Settings…',
    switch: 'Switch Workspace…',
    delete: 'Delete Workspace…'
  },
  reveal: {
    darwin: 'Show in Finder',
    win32: 'Show in File Explorer',
    other: 'Show in File Manager'
  },
  renameTitle: 'Rename Workspace',
  renameDescription: 'Changes only the displayed name; the folder stays where it is.',
  nameLabel: 'Workspace name',
  deleteTitle: (name) => `Delete the Workspace “${name}”?`,
  deleteDescription:
    'The whole folder (all Collections, environments and history) goes to the system Trash:',
  moveToTrash: 'Move to Trash',
  cookies: {
    session: 'Session',
    filter: 'Filter cookies',
    filterPlaceholder: 'Filter by domain or name',
    refresh: 'Refresh',
    clearAll: 'Clear all',
    none: 'No cookies yet.',
    noMatch: 'No matching cookies.',
    clearDomain: 'Clear this domain',
    deleteLabel: (name) => `Delete ${name}`,
    description:
      'Set-Cookie headers of responses are kept and sent with later requests (turn this off in a request’s Settings). Stored on this computer only.'
  }
}

export const env: Messages['env'] = {
  deleteTitle: (name) => `Delete the environment “${name}”?`,
  toTrash: 'The environment file goes to the system Trash; you can restore it from there.',
  runtimeTitle: (count) => `Runtime variables (${count})`,
  runtimeHint:
    'Set by scripts and captures; kept in memory only (gone when the App quits), and they win over environment and Collection variables',
  clearAll: 'Clear all',
  emptyString: '(empty)',
  deleteLabel: (name) => `Delete ${name}`,
  environments: 'Environments',
  add: 'New environment',
  list: 'Environments',
  inUse: 'In use',
  duplicate: 'Duplicate',
  delete: 'Delete',
  name: 'Environment name',
  unsaved: 'Unsaved changes',
  active: 'In use',
  setActive: 'Use this environment',
  empty:
    'No environments yet. Create some (e.g. dev, staging, prod) to switch between sets of variable values.',
  create: 'Create environment',
  none: 'No environment',
  manage: 'Manage environments…',
  newName: 'New Environment'
}

export const history: Messages['history'] = {
  error: 'Error',
  errorDetail: (error) => `Error: ${error}`,
  closeReason: (reason) => `: ${reason}`,
  counts: (sent, received) => `${sent} sent · ${received} received`,
  environment: (name) => `Environment: ${name}`,
  emptyUrl: '(no URL)',
  deleteEntry: 'Delete this entry',
  count: (n) => `${n} ${n === 1 ? 'entry' : 'entries'} (this Workspace)`,
  clearTitle: 'Clear the history of this Workspace',
  clearLabel: 'Clear history',
  empty: 'Nothing yet. Every request you send is recorded here (without the response body).',
  clearConfirmTitle: 'Clear the history?',
  clearConfirm: (n) =>
    `${n === 1 ? 'The only entry' : `All ${n} entries`} of this Workspace will be deleted. This cannot be undone.`,
  clear: 'Clear',
  today: 'Today',
  yesterday: 'Yesterday',
  usage: (total, max) => `History: ${total} / ${max} entries (shared by all Workspaces)`,
  usageWorkspace: (n) => `This Workspace: ${n}`,
  usageFull: 'Full: new entries replace the oldest',
  usageHint: 'Change the limit in App Settings; click to open the history',
  usageShort: (percent) => `History ${percent}%`
}

export const tabs: Messages['tabs'] = {
  connected: 'Connected',
  previewTitle: (title) => `${title} (preview: edit or double-click to keep it)`,
  closeLabel: (title) => `Close ${title}`,
  unsaved: 'Unsaved changes',
  close: 'Close',
  closeOthers: 'Close Other Tabs',
  closeAll: 'Close All Tabs',
  pin: 'Keep Tab Open',
  open: 'Open tabs',
  add: 'New',
  addTitle: 'New request (unsaved; usable right away)',
  http: 'HTTP Request',
  environments: 'Environments',
  mock: (name) => `Mock: ${name}`,
  runner: (name) => `Run: ${name}`,
  saveAsTitle: 'Save Request',
  saveAsDescription: 'Choose the Collection / folder to put it in.',
  saveAsName: 'Name',
  saveAsLocation: 'Location',
  saveAsNoCollection: 'Create a Collection on the left first.'
}

export const vars: Messages['vars'] = {
  thisRun: 'this run',
  sources: {
    runtime: 'Runtime variable',
    data: 'Data file',
    environment: 'Environment',
    collection: 'Collection'
  },
  named: (source, name) => `${source} “${name}”`,
  secret: (value) => `${value} (secret)`,
  emptyString: '(empty)',
  dynamic: (description) => `Dynamic variable: ${description}`,
  dynamicDescriptions: {
    $guid: 'UUID v4',
    $timestamp: 'Current Unix time (seconds)',
    $isoTimestamp: 'Current time in ISO 8601',
    $randomInt: 'Random integer from 0 to 1000',
    $randomUUID: 'UUID v4 (same as $guid)',
    $randomString: '16 random letters and digits',
    $randomAlphaNumeric: '1 random letter or digit',
    $randomEmail: 'Random email address (example.com)',
    $randomBoolean: 'true or false'
  },
  file: (path) => `Read when sending and turned into base64: ${path}`,
  fileFormat: 'Expected {{$file:base64:path to the file}}',
  missing: 'No such variable; sent as it is',
  readOnly: (detail) => `${detail} (cannot be changed here)`,
  valueOf: (name) => `Value of ${name}`,
  show: 'Show value',
  hide: 'Hide value',
  editHint: 'Enter saves, Esc cancels',
  secretHint: ' (secret values are kept in .hachi-secrets.json only)',
  table: {
    name: 'Variable',
    value: 'Value',
    secretTitle:
      'Secret: the value is kept in this computer’s .hachi-secrets.json only, never in files you commit',
    secret: 'Secret',
    secretValue: 'Secret value',
    reveal: 'Show secret values',
    hintBefore: 'Variables marked',
    hintAfter: 'are secret: their values stay on this computer and are never committed to git.'
  },
  enabled: 'Enabled',
  deleteRow: 'Delete this row'
}

export const editor: Messages['editor'] = {
  countMax: (current, total) => (current ? `${current}/${total}+` : `${total}+`),
  count: (current, total) => (current ? `${current}/${total}` : String(total)),
  none: 'No results',
  search: 'Find',
  replace: 'Replace',
  replaceAll: 'Replace All',
  showReplace: 'Show replace',
  hideReplace: 'Hide replace',
  previous: 'Previous (Shift+Enter)',
  next: 'Next (Enter)',
  close: 'Close (Esc)',
  phrases: null
}
