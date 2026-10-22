import type { Messages } from '../zh-TW'
import { plural } from './plural'

export const settings: Messages['settings'] = {
  workspace: {
    title: 'Workspace Settings',
    description:
      'Defaults for requests (each request can override them in its Settings tab). Stored in workspace.json.',
    ssl: 'SSL certificates',
    sslCheck: 'Verify server certificates',
    redirects: 'Redirects',
    redirectsFollow: 'Follow automatically',
    maxRedirects: 'Max redirects',
    maxRedirectsHint: (max) => `0–${max}`,
    gitAutoFetch: 'Fetch automatically when the Workspace opens',
    gitAutoFetchHint: 'When off, Hachi only contacts the remote when you Fetch or Pull.',
    scriptTimeout: 'Script time limit (s)',
    scriptTimeoutHint: 'Per script, including sendRequest / sleep waits',
    scripts: 'Scripts',
    trustScripts: 'Trust the scripts of this Workspace',
    trustScriptsHint:
      'Remembered on this computer only. Untrusted: Hachi asks before sending a request with scripts.',
    files: 'Outside files',
    trustFiles: 'Let {{$file:…}} read files outside the Workspace',
    trustFilesHint:
      'Remembered on this computer only. Files inside the Workspace folder can always be read.'
  },
  app: {
    title: 'App Settings',
    description: 'Kept on this computer (not in the Workspace) and used by every Workspace.',
    language: 'Language',
    languageSystem: 'Same as the system',
    theme: 'Appearance',
    themes: { system: 'Same as the system', light: 'Light', dark: 'Dark' },
    proxyMode: 'Proxy mode',
    proxyModes: { none: 'No proxy', system: 'Use the system proxy settings', custom: 'Custom' },
    proxyUser: 'Username (optional)',
    proxyPassword: 'Password (optional)',
    proxyPasswordHint:
      'The password is stored as plain text in this computer’s settings file (app-config.json), never in the Workspace.',
    proxyBypass: 'Hosts that skip the proxy (one per line; *.example.com works)',
    historyLimit: 'History limit',
    historyLimitHint: (min, max) => `entries (${min}–${max}, shared by all Workspaces)`,
    historyUsage: (total) =>
      `${plural(total, 'entry', 'entries')} now. Above the limit, the oldest entries of all Workspaces are removed.`,
    historyConfirm: (limit, remove) =>
      `With a limit of ${limit}, ${remove === 1 ? 'the oldest entry' : `the ${remove} oldest entries`} of all Workspaces will be removed. Continue?`,
    wsMessages: 'WebSocket messages',
    wsMessagesHint: (min, max) => `per tab (${min}–${max}; the oldest are removed beyond that)`
  },
  legal: {
    notice: (name, license) =>
      `${name} is free software, licensed under ${license} (GNU Affero General Public License version 3 or later), with no warranty.`,
    license: 'License',
    source: 'Source code'
  }
}
