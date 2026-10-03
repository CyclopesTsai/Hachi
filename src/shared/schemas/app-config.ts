import { z } from 'zod'
import { HISTORY_LIMIT_DEFAULT, HISTORY_LIMIT_MAX, HISTORY_LIMIT_MIN } from './history'
import type { VersionedFormat } from './versioned'

/** Stored at `<userData>/app-config.json`. See docs/schema.md. */
export const APP_CONFIG_VERSION = 1
export const MAX_RECENT_WORKSPACES = 10

export const themeSchema = z.enum(['system', 'light', 'dark'])
export type Theme = z.infer<typeof themeSchema>

export const windowStateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(200),
  height: z.number().int().min(200),
  isMaximized: z.boolean().default(false),
  isFullScreen: z.boolean().default(false)
})
export type WindowState = z.infer<typeof windowStateSchema>

export const recentWorkspaceSchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  lastOpenedAt: z.string()
})
export type RecentWorkspace = z.infer<typeof recentWorkspaceSchema>

export const PROXY_MODES = ['none', 'system', 'custom'] as const

/**
 * App-wide proxy (per machine, not per Workspace — it depends on the network,
 * not on the project). Stored in userData, never in a Workspace.
 */
export const proxySettingsSchema = z.object({
  mode: z.enum(PROXY_MODES).default('none'),
  /** For mode "custom": http://host:port or https://host:port */
  url: z.string().max(2048).default(''),
  /** Hosts that bypass the proxy: "localhost", "example.com", "*.internal", ".corp" */
  bypass: z.array(z.string().max(255)).max(200).default(['localhost', '127.0.0.1', '::1']),
  username: z.string().max(512).default(''),
  /** Stored locally in plain text for now; may move to the system keychain later. */
  password: z.string().max(512).default('')
})
export type ProxySettings = z.infer<typeof proxySettingsSchema>

/** Display preferences. */
export const uiSettingsSchema = z.object({
  /** Soft-wrap long lines in the request body editor (display only). */
  requestBodyWrap: z.boolean().default(false),
  /** Soft-wrap long lines in the response body viewer (display only). */
  responseBodyWrap: z.boolean().default(false)
})
export type UiSettings = z.infer<typeof uiSettingsSchema>

export const WS_MESSAGE_LIMIT_MIN = 10
export const WS_MESSAGE_LIMIT_MAX = 5000

/** WebSocket message log of each tab (kept in memory only). */
export const websocketSettingsSchema = z.object({
  messageLimit: z.number().int().min(WS_MESSAGE_LIMIT_MIN).max(WS_MESSAGE_LIMIT_MAX).default(100)
})
export type WebsocketSettings = z.infer<typeof websocketSettingsSchema>

/** History is limited across all Workspaces together (see docs/schema.md). */
export const historySettingsSchema = z.object({
  maxEntries: z
    .number()
    .int()
    .min(HISTORY_LIMIT_MIN)
    .max(HISTORY_LIMIT_MAX)
    .default(HISTORY_LIMIT_DEFAULT)
})
export type HistorySettings = z.infer<typeof historySettingsSchema>

/** Workspaces whose scripts the user trusts on this computer (decision 84), by folder path. */
export const scriptSettingsSchema = z.object({
  trustedWorkspaces: z.array(z.string().min(1)).max(1000).default([])
})
export type ScriptSettings = z.infer<typeof scriptSettingsSchema>

export const appConfigSchema = z.object({
  version: z.literal(APP_CONFIG_VERSION),
  theme: themeSchema.default('system'),
  recentWorkspaces: z.array(recentWorkspaceSchema).max(MAX_RECENT_WORKSPACES).default([]),
  lastWorkspacePath: z.string().min(1).nullable().default(null),
  window: windowStateSchema.nullable().default(null),
  proxy: proxySettingsSchema.prefault({}),
  ui: uiSettingsSchema.prefault({}),
  history: historySettingsSchema.prefault({}),
  websocket: websocketSettingsSchema.prefault({}),
  scripts: scriptSettingsSchema.prefault({})
})
export type AppConfig = z.infer<typeof appConfigSchema>

export const appConfigFormat: VersionedFormat<typeof appConfigSchema> = {
  name: 'app-config.json',
  currentVersion: APP_CONFIG_VERSION,
  schema: appConfigSchema
}

export function defaultAppConfig(): AppConfig {
  return appConfigSchema.parse({ version: APP_CONFIG_VERSION })
}
