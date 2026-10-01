import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'

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
