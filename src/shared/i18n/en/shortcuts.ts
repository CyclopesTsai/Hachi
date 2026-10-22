import type { Messages } from '../zh-TW'

export const shortcuts: Messages['shortcuts'] = {
  title: 'Keyboard Shortcuts',
  description:
    'Hachi keeps only a few shortcuts on purpose: sending, connecting, new tabs and the like have none, so nothing happens by accident.',
  menu: 'Menu',
  newWorkspace: 'New Workspace',
  openWorkspace: 'Open Workspace',
  saveTab: 'Save the current tab',
  closeTab: 'Close the current tab (the window when no tab is open)',
  quitKeyOther: 'Ctrl+Q (Linux)',
  quit: 'Quit Hachi',
  reload: 'Reload the screen (development only)',
  edit: 'Edit',
  undoRedo: 'Undo / Redo',
  cutCopyPaste: 'Cut / Copy / Paste',
  selectAll: 'Select all',
  tree: 'Tree on the left',
  moveSelection: 'Move the selection',
  openPinned: 'Open as a kept tab',
  deleteKeyMac: 'Delete or ⌘⌫',
  deleteKeyOther: 'Delete or Ctrl+Backspace',
  delete: 'Delete (asks first)',
  fields: 'Fields and dialogs',
  renameField: 'Rename field: confirm / cancel',
  dialog: 'Dialogs: submit / close',
  hover: 'Variable hover box: save / cancel',
  editors: 'Body, script and response editors',
  find: 'Find (plus CodeMirror’s standard keys: undo, multiple selections and so on)',
  findNext: 'Find box: next / previous (Enter in the replace field replaces)',
  closeFind: 'Close the find box',
  selectCopy: 'Select all / copy (read-only responses too)'
}
