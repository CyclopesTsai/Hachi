import { errorMessage, unwrap } from './ipc'
import { useAppStore } from '@renderer/stores/app-store'

/** "Show in Finder" in each platform's words. */
export function revealLabel(platform: string | undefined): string {
  if (platform === 'darwin') return '在 Finder 中顯示'
  if (platform === 'win32') return '在檔案總管中顯示'
  return '在檔案管理員中顯示'
}

/** Opens the Workspace folder (null) or shows an item's folder / file. */
export async function reveal(itemId: string | null): Promise<void> {
  try {
    await unwrap(window.hachi.app.reveal({ itemId }))
  } catch (error) {
    useAppStore.getState().setNotice(errorMessage(error))
  }
}
