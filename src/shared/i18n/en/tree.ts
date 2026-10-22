import type { Messages } from '../zh-TW'

export const tree: Messages['tree'] = {
  kinds: { collection: 'Collection', folder: 'folder', request: 'request' },
  deleteTitle: (kind, name) => `Delete ${kind} “${name}”?`,
  deleteChildren: (count) =>
    `${count === 1 ? 'The item' : `The ${count} items`} inside ${count === 1 ? 'is' : 'are'} deleted too. `,
  deleteExamples: (count) =>
    `${count === 1 ? 'Its saved example is' : `Its ${count} saved examples are`} deleted too. `,
  toTrash: 'The files go to the system Trash; you can restore them from there.',
  deleteExampleTitle: (name) => `Delete the example “${name}”?`,
  sidebar: 'Sidebar',
  search: 'Search names',
  searchTitle: 'Search the names of Collections, folders and requests',
  locate: 'Show the current tab',
  locateTitle: 'Find the current tab in the tree',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  newFolder: 'New Folder',
  newHttp: 'New HTTP Request',
  newWebSocket: 'New WebSocket',
  newCollection: 'New Collection',
  pickCollection:
    'Nothing is selected on the left. Which Collection should it go into? (Select a Collection or folder first to put it there directly.)',
  add: 'Add',
  addTitle: 'Add…',
  reloadWorkspace: 'Reload Workspace',
  reloadWorkspaceTitle: 'Reload the whole Workspace (picks up files changed outside Hachi)',
  importFile: 'Import File (Postman / Bruno JSON)…',
  importBrunoFolder: 'Import Bruno Folder…',
  importCurl: 'Import cURL…',
  noMatch: (query) => `No names contain “${query}”.`,
  empty: 'No Collections yet.',
  createCollection: 'Create Collection',
  name: 'Name',
  unsaved: 'Unsaved changes',
  fileError: 'File error',
  run: 'Run…',
  duplicate: 'Duplicate',
  export: 'Export…',
  reload: 'Reload',
  deleteMenu: 'Delete…',
  open: 'Open'
}
