import type { Messages } from '../zh-TW'

export const welcome: Messages['welcome'] = {
  errors: {
    ALREADY_EXISTS: 'There is already a Workspace here. Use “Open Workspace” instead.',
    DIR_NOT_EMPTY: 'The folder already exists and is not empty. Choose another name or location.',
    NOT_A_WORKSPACE: 'This folder is not a Hachi Workspace (no workspace.json).',
    INVALID_FILE: 'workspace.json is damaged or not in the expected format.',
    UNSUPPORTED_VERSION: 'This Workspace was made by a newer Hachi. Update Hachi first.'
  },
  chooseLocation: 'Choose where to keep the Workspace',
  name: 'Name',
  namePlaceholder: 'e.g. My API',
  location: 'Location',
  willCreate: 'Creates the folder: ',
  creating: 'Creating…',
  create: 'Create Workspace',
  noRecent: 'No recent Workspaces yet.',
  current: 'Current',
  folderMissing: 'Folder not found',
  deleteTitle: 'Delete Workspace (move to Trash)',
  deleteLabel: (name) => `Delete ${name}`,
  removeTitle: 'Remove from the list (keeps the files)',
  removeLabel: (name) => `Remove ${name} from the list`,
  introFirstRun:
    'Welcome to Hachi! Start by creating your first Workspace: it holds your Collections, environments and history.',
  intro: 'Create a new Workspace, or open one you already have.',
  createTitle: 'Create a Workspace',
  createDescription: 'Each Workspace is a folder on your disk; everything is stored as JSON files.',
  recentTitle: 'Recent',
  recentDescription: 'Or choose an existing Workspace folder on your disk.',
  open: 'Open Workspace…',
  back: (name) => `Back to “${name}”`,
  language: 'Language'
}
