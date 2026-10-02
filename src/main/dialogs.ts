import {
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'

/** Native folder picker. Returns the chosen absolute path, or null if cancelled. */
export async function selectDirectory(
  parent: BrowserWindow | null,
  options: { title?: string; defaultPath?: string } = {}
): Promise<string | null> {
  const dialogOptions: OpenDialogOptions = {
    title: options.title,
    defaultPath: options.defaultPath,
    properties: ['openDirectory', 'createDirectory']
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)
  return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null)
}

/** Native file picker. Returns the chosen absolute path, or null if cancelled. */
export async function selectFile(
  parent: BrowserWindow | null,
  options: { title?: string } = {}
): Promise<string | null> {
  const dialogOptions: OpenDialogOptions = { title: options.title, properties: ['openFile'] }
  const result = parent
    ? await dialog.showOpenDialog(parent, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)
  return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null)
}

/** Native save dialog. Returns the chosen absolute path, or null if cancelled. */
export async function selectSavePath(
  parent: BrowserWindow | null,
  options: { title?: string; defaultPath?: string } = {}
): Promise<string | null> {
  const dialogOptions: SaveDialogOptions = {
    title: options.title,
    defaultPath: options.defaultPath,
    properties: ['createDirectory', 'showOverwriteConfirmation']
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions)
  return result.canceled || !result.filePath ? null : result.filePath
}
