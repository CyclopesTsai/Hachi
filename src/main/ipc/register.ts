import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { APP_ID, APP_NAME } from '@shared/app-info'
import { HachiError } from '@shared/errors'
import type { HttpResult } from '@shared/http'
import type { HttpSendInput, WorkspaceInfo } from '@shared/ipc/api'
import { INVOKE, type InvokeChannel } from '@shared/ipc/channels'
import { selectDirectory, selectFile, selectSavePath } from '../dialogs'
import type { CollectionService } from '../services/collection-service'
import type { ConfigService } from '../services/config-service'
import type { EnvironmentService } from '../services/environment-service'
import type { HistoryService } from '../services/history-service'
import type { SessionService } from '../services/session-service'
import type { HttpService } from '../services/http/http-service'
import type { WorkspaceService } from '../services/workspace-service'
import { createHandler, forbidden, type Handler } from './handler'

export interface IpcContext {
  config: ConfigService
  workspaces: WorkspaceService
  collections: CollectionService
  http: HttpService
  environments: EnvironmentService
  history: HistoryService
  sessions: SessionService
  /** Sends a request and records it in the history. */
  sendHttp(input: HttpSendInput): Promise<HttpResult>
  setCloseGuard(dirty: boolean): void
  confirmClose(): void
  getWindow(): BrowserWindow | null
  defaultWorkspaceDir: string
  isTrustedSender(frameUrl: string | undefined): boolean
  openWorkspaceWithDialog(): Promise<WorkspaceInfo | null>
}

type HandlerMap = { [C in InvokeChannel]: Handler<C> }

/** Registers every invoke channel. The mapped type forces a handler for each channel. */
export function registerIpcHandlers(ctx: IpcContext): void {
  const workspacePath = (): string => {
    const current = ctx.workspaces.getCurrent()
    if (!current) throw new HachiError('NO_WORKSPACE', 'No Workspace is open')
    return current.path
  }

  const handlers: HandlerMap = {
    [INVOKE.appGetInfo]: () => ({
      name: APP_NAME,
      version: app.getVersion(),
      appId: APP_ID,
      platform: process.platform,
      isPackaged: app.isPackaged
    }),
    [INVOKE.appGetDefaultWorkspaceDir]: () => ctx.defaultWorkspaceDir,
    [INVOKE.appSetCloseGuard]: (input) => ctx.setCloseGuard(input.dirty),
    [INVOKE.appConfirmClose]: () => ctx.confirmClose(),
    [INVOKE.configGet]: () => ctx.config.get(),
    [INVOKE.configUpdate]: async (input) => {
      if (input.theme) {
        nativeTheme.themeSource = input.theme
        await ctx.config.setTheme(input.theme)
      }
      if (input.proxy) await ctx.config.setProxy(input.proxy)
      if (input.ui) await ctx.config.setUi(input.ui)
      if (input.history) {
        await ctx.config.setHistory(input.history)
        await ctx.history.applyLimit(ctx.workspaces.getCurrent()?.path ?? null)
      }
      return ctx.config.get()
    },
    [INVOKE.workspaceGetCurrent]: () => ctx.workspaces.getCurrent(),
    [INVOKE.workspaceCreate]: (input) => ctx.workspaces.create(input),
    [INVOKE.workspaceOpen]: (input) => ctx.workspaces.open(input.path),
    [INVOKE.workspaceOpenWithDialog]: () => ctx.openWorkspaceWithDialog(),
    [INVOKE.workspaceListRecent]: () => ctx.workspaces.listRecent(),
    [INVOKE.workspaceRemoveRecent]: (input) => ctx.workspaces.removeRecent(input.path),
    [INVOKE.workspaceRename]: (input) => ctx.workspaces.rename(input.name),
    [INVOKE.workspaceDelete]: async (input) => {
      const recent = await ctx.workspaces.delete(input.path)
      await ctx.history.forget(input.path)
      await ctx.sessions.remove(input.path)
      return recent
    },
    [INVOKE.workspaceGetSettings]: () => ctx.workspaces.getSettings(),
    [INVOKE.workspaceSaveSettings]: (input) => ctx.workspaces.saveSettings(input),
    [INVOKE.dialogSelectDirectory]: (input) => selectDirectory(ctx.getWindow(), input),
    [INVOKE.dialogSelectFile]: (input) => selectFile(ctx.getWindow(), input),
    [INVOKE.treeGet]: () => ctx.collections.getTree(),
    [INVOKE.treeReload]: async (input) => {
      if (input.scope === 'item') return ctx.collections.refreshItem(input.id)
      await ctx.workspaces.reloadCurrent()
      return ctx.collections.refresh()
    },
    [INVOKE.itemCreate]: (input) => ctx.collections.create(input),
    [INVOKE.itemRename]: (input) => ctx.collections.rename(input.id, input.name),
    [INVOKE.itemDuplicate]: (input) => ctx.collections.duplicate(input.id),
    [INVOKE.itemDelete]: (input) => ctx.collections.delete(input.id),
    [INVOKE.itemMove]: (input) => ctx.collections.move(input.id, input.parentId, input.index),
    [INVOKE.requestGet]: (input) => ctx.collections.getRequest(input.id),
    [INVOKE.requestSave]: (input) => ctx.collections.saveRequest(input.id, input.request),
    [INVOKE.requestSaveAs]: (input) =>
      ctx.collections.createRequest(input.parentId, input.name, input.request),
    [INVOKE.requestGetInherited]: (input) => ctx.collections.getInheritedFor(input.parentId),
    [INVOKE.containerGet]: (input) => ctx.collections.getContainer(input.id),
    [INVOKE.containerSave]: (input) =>
      ctx.collections.saveContainer(input.id, {
        headers: input.headers,
        auth: input.auth,
        variables: input.variables
      }),
    [INVOKE.httpSend]: (input) => ctx.sendHttp(input),
    [INVOKE.httpCancel]: (input) => ctx.http.cancel(input.runId),
    [INVOKE.httpGetBody]: (input) => ctx.http.getBodyText(input.runId),
    [INVOKE.httpSaveResponse]: async (input) => {
      const stored = ctx.http.requireStored(input.runId)
      const target = await selectSavePath(ctx.getWindow(), {
        title: 'Save Response',
        defaultPath: path.join(app.getPath('downloads'), stored.suggestedName)
      })
      if (!target) return null
      await writeFile(target, stored.body)
      return target
    },
    [INVOKE.envList]: () => ctx.environments.list(),
    [INVOKE.envGet]: (input) => ctx.environments.get(input.id),
    [INVOKE.envCreate]: (input) => ctx.environments.create(input.name),
    [INVOKE.envSave]: (input) =>
      ctx.environments.save(input.id, { name: input.name, variables: input.variables }),
    [INVOKE.envDuplicate]: (input) => ctx.environments.duplicate(input.id),
    [INVOKE.envDelete]: (input) => ctx.environments.delete(input.id),
    [INVOKE.historyList]: async () => {
      const ws = workspacePath()
      return { entries: await ctx.history.list(ws), usage: await ctx.history.usage(ws) }
    },
    [INVOKE.historyDelete]: (input) => ctx.history.remove(workspacePath(), input.id),
    [INVOKE.historyClear]: () => ctx.history.clear(workspacePath()),
    [INVOKE.historyGetUsage]: () => ctx.history.usage(ctx.workspaces.getCurrent()?.path ?? null),
    [INVOKE.sessionGet]: () => ctx.sessions.get(workspacePath()),
    [INVOKE.sessionSave]: (input) => ctx.sessions.save(workspacePath(), input)
  }

  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    const wrapped = createHandler(channel, handlers[channel] as Handler<typeof channel>)
    ipcMain.handle(channel, (event, input: unknown) =>
      ctx.isTrustedSender(event.senderFrame?.url) ? wrapped(input) : forbidden()
    )
  }
}
