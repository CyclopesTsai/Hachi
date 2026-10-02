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
/** SPDX license expression of Hachi itself. */
export const APP_LICENSE: string = info.license
/** Where the Corresponding Source can be obtained (AGPL / GPLv3 requirement). */
export const APP_SOURCE_URL: string = info.sourceUrl
export const APP_LICENSE_URL: string = info.licenseUrl

/**
 * "Appropriate Legal Notices" (AGPL-3.0 section 5(d)) shown in the About window and
 * in the app's settings: copyright, no warranty, license, and where to get the source.
 */
export const LEGAL_NOTICE: string = [
  `${info.copyright}`,
  `${info.appName} is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.`,
  `${info.appName} is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.`,
  `License: ${info.licenseUrl}`,
  `Source code: ${info.sourceUrl}`
].join('\n\n')
