import { app, session, shell } from 'electron'

/** Permissions the renderer may use. Everything else (camera, geolocation, …) is denied. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Applies app-wide hardening to every WebContents:
 * - no new windows (http(s) links open in the system browser instead)
 * - no navigation away from our own renderer page
 * - no <webview>
 * - deny-by-default permission requests
 */
export function applySecurityPolicies(isTrustedUrl: (url: string) => boolean): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalHttpUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  )
}
