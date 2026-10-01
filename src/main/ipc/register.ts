import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { APP_ID, APP_NAME } from '@shared/app-info'
import type { WorkspaceInfo } from '@shared/ipc/api'
import { INVOKE, type InvokeChannel } from '@shared/ipc/channels'
import { selectDirectory } from '../dialogs'
import type { ConfigService } from '../services/config-service'
import type { WorkspaceService } from '../services/workspace-service'
import { createHandler, forbidden, type Handler } from './handler'

export interface IpcContext {
  config: ConfigService
  workspaces: WorkspaceService
  getWindow(): BrowserWindow | null
  defaultWorkspaceDir: string
  isTrustedSender(frameUrl: string | undefined): boolean
  openWorkspaceWithDialog(): Promise<WorkspaceInfo | null>
}

type HandlerMap = { [C in InvokeChannel]: Handler<C> }

/** Registers every invoke channel. The mapped type forces a handler for each channel. */
export function registerIpcHandlers(ctx: IpcContext): void {
  const handlers: HandlerMap = {
    [INVOKE.appGetInfo]: () => ({
      name: APP_NAME,
      version: app.getVersion(),
      appId: APP_ID,
      platform: process.platform,
      isPackaged: app.isPackaged
    }),
    [INVOKE.appGetDefaultWorkspaceDir]: () => ctx.defaultWorkspaceDir,
    [INVOKE.configGet]: () => ctx.config.get(),
    [INVOKE.configUpdate]: async (input) => {
      if (input.theme) {
        nativeTheme.themeSource = input.theme
        return ctx.config.setTheme(input.theme)
      }
      return ctx.config.get()
    },
    [INVOKE.workspaceGetCurrent]: () => ctx.workspaces.getCurrent(),
    [INVOKE.workspaceCreate]: (input) => ctx.workspaces.create(input),
    [INVOKE.workspaceOpen]: (input) => ctx.workspaces.open(input.path),
    [INVOKE.workspaceOpenWithDialog]: () => ctx.openWorkspaceWithDialog(),
    [INVOKE.workspaceListRecent]: () => ctx.workspaces.listRecent(),
    [INVOKE.workspaceRemoveRecent]: (input) => ctx.workspaces.removeRecent(input.path),
    [INVOKE.dialogSelectDirectory]: (input) => selectDirectory(ctx.getWindow(), input)
  }

  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    const wrapped = createHandler(channel, handlers[channel] as Handler<typeof channel>)
    ipcMain.handle(channel, (event, input: unknown) =>
      ctx.isTrustedSender(event.senderFrame?.url) ? wrapped(input) : forbidden()
    )
  }
}
