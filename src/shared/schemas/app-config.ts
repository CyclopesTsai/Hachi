import { z } from 'zod'
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
  isMaximized: z.boolean().default(false)
})
export type WindowState = z.infer<typeof windowStateSchema>

export const recentWorkspaceSchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  lastOpenedAt: z.string()
})
export type RecentWorkspace = z.infer<typeof recentWorkspaceSchema>

export const appConfigSchema = z.object({
  version: z.literal(APP_CONFIG_VERSION),
  theme: themeSchema.default('system'),
  recentWorkspaces: z.array(recentWorkspaceSchema).max(MAX_RECENT_WORKSPACES).default([]),
  lastWorkspacePath: z.string().min(1).nullable().default(null),
  window: windowStateSchema.nullable().default(null)
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
