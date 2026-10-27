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
    wsMessagesHint: (min, max) => `per tab (${min}–${max}; the oldest are removed beyond that)`,
    clientCerts: 'Client certificates',
    clientCertsCount: (enabled, total) =>
      total === 0 ? 'None' : enabled === total ? `${total}` : `${total} (${enabled} enabled)`,
    clientCertsManage: 'Manage…'
  },
  clientCerts: {
    title: 'Client Certificates',
    description:
      'Presented by host when sending https:// and wss:// requests (mTLS). Only the file paths are kept, on this computer, never in the Workspace.',
    empty: 'No client certificates yet.',
    add: 'Add Certificate',
    addTitle: 'Add Client Certificate',
    editTitle: (host) => `Edit Client Certificate: ${host}`,
    edit: 'Edit',
    remove: 'Delete',
    removeConfirm: (host) =>
      `Delete the client certificate setting for ${host}? (The certificate files stay.)`,
    enabled: 'Enabled',
    anyPort: 'any port',
    host: 'Host',
    hostHint: 'api.example.com, or *.example.com (subdomains only)',
    badHost: 'Invalid host',
    port: 'Port',
    portPlaceholder: 'Any',
    badPort: 'The port must be 1–65535, or empty',
    type: 'Type',
    types: { pem: 'PEM (certificate + key)', pfx: 'PKCS#12 (.p12 / .pfx)' },
    certFile: 'Certificate',
    keyFile: 'Private key',
    pfxFile: '.p12 / .pfx file',
    choose: 'Choose…',
    noFile: 'None chosen',
    passphrase: 'Passphrase',
    passphraseHint:
      'For an encrypted key or a PKCS#12 file with a password; stored as plain text in this computer’s settings file (app-config.json).',
    checking: 'Checking…',
    done: 'Done',
    pickTitle: {
      cert: 'Choose the Certificate',
      key: 'Choose the Private Key',
      pfx: 'Choose the PKCS#12 File'
    },
    rule: 'When several match, the most specific wins: a full host name before *., a set port before any port.'
  },
  legal: {
    notice: (name, license) =>
      `${name} is free software, licensed under ${license} (GNU Affero General Public License version 3 or later), with no warranty.`,
    license: 'License',
    source: 'Source code'
  }
}
