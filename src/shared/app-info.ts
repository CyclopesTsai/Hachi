/**
 * App identity — the single source of truth.
 *
 * Values live in `app-info.json` so that non-TypeScript tooling
 * (electron-builder config, scripts) can read the exact same data.
 * Change the Bundle ID / copyright there, not here.
 */
import info from './app-info.json'

export const APP_NAME: string = info.appName
export const PACKAGE_NAME: string = info.packageName
export const APP_ID: string = info.appId
export const APP_COPYRIGHT: string = info.copyright
/** Folder name under the user's Documents directory used as the default Workspace location. */
export const WORKSPACE_DIR_NAME: string = info.workspaceDirName
