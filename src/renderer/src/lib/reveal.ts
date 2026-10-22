import { errorMessage, unwrap } from './ipc'
import { useAppStore } from '@renderer/stores/app-store'
import { msg } from '@shared/i18n'

/** "Show in Finder" in each platform's words. */
export function revealLabel(platform: string | undefined): string {
  const m = msg().workspace.reveal
  if (platform === 'darwin') return m.darwin
  if (platform === 'win32') return m.win32
  return m.other
}

/** Opens the Workspace folder (null) or shows an item's folder / file. */
export async function reveal(itemId: string | null): Promise<void> {
  try {
    await unwrap(window.hachi.app.reveal({ itemId }))
  } catch (error) {
    useAppStore.getState().setNotice(errorMessage(error))
  }
}
