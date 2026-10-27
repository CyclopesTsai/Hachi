import type { Messages } from '../zh-TW'
import { plural } from './plural'

export const httpMain: Messages['httpMain'] = {
  hidden: '(hidden)',
  version: {
    noHttp2: 'The server does not support HTTP/2 (the request’s HTTP version is “HTTP/2 only”)',
    onlyHttp2: 'The server only accepts HTTP/2 (the request’s HTTP version is “HTTP/1.1 only”)',
    noProtocol: 'The server accepts neither HTTP/1.1 nor HTTP/2',
    noH2c:
      'http:// cannot use HTTP/2 (Hachi does not support h2c): use https://, or set the HTTP version to “Auto”'
  },
  oauth2: {
    empty: (label) => `The OAuth 2.0 ${label} is empty`,
    invalidUrl: (label, text) => `The OAuth 2.0 ${label} is not a valid URL: ${text}`,
    needHttp: (label) => `The OAuth 2.0 ${label} needs http:// or https://`,
    reasonJoin: ': ',
    noAccessToken: 'The response has no access_token',
    noContent: 'empty response',
    tokenFailed: (status, detail) =>
      `Could not get the OAuth 2.0 token (HTTP ${status}): ${detail}`,
    badCallback: (text) => `The Callback URL is not a valid URL: ${text}`,
    callbackLoopback: 'The Callback URL must be http://127.0.0.1, http://localhost or http://[::1]',
    pageOk: 'Authorized',
    pageFailed: 'Authorization failed',
    pageClose: 'You can close this tab and go back to Hachi.',
    failed: (error, description) =>
      `Authorization failed: ${error}${description ? `: ${description}` : ''}`,
    stateMismatch: 'The state does not match; this response was ignored',
    noCodeInResponse: 'The response has no code',
    noCode: 'The authorization server returned no code',
    serverFailed: (message) => `Cannot start the callback server: ${message}`,
    timeout: 'Timed out waiting for authorization in the browser',
    cancelled: 'Cancelled',
    cannotListen: (host, port, message) =>
      `Cannot receive the callback on ${host}:${port}: ${message}`,
    expired:
      'The OAuth 2.0 token has expired; click “Get Token” in the Auth tab to authorize again',
    missing: 'No OAuth 2.0 token yet; click “Get Token” in the Auth tab first',
    openBrowser: 'Cannot open the browser',
    tokenUrl: (message) => `Cannot reach the Access Token URL: ${message}`
  },
  aws: {
    empty: (label) => `The AWS Signature ${label} is empty`,
    formData: 'AWS Signature cannot sign form-data bodies (except for S3)'
  },
  code: {
    oauth2:
      'There is no valid OAuth 2.0 token yet, so the code has no Authorization (send once or click “Get Token” first)',
    digest: 'Digest authentication needs the server’s 401 first, so the code has no Authorization',
    aws: 'AWS Signature is signed when sending (it expires), so the code has no signature'
  },
  tls: {
    needUrl: 'Enter a URL first',
    invalidUrl: (text) => `Invalid URL: ${text}`,
    unencrypted: 'Unencrypted connection',
    httpsOnly: 'Only https:// or wss:// URLs can be checked'
  },
  saveResult: {
    gone: 'This response is no longer kept; send the request again before saving',
    tooLarge: (mb) => `The response is larger than ${mb} MB and cannot be saved`
  },
  file: {
    format: (name) => `{{${name}}} should look like {{$file:base64:path}}`,
    unsupported: (name, format) =>
      `{{${name}}}: unsupported format “${format}” (only base64 for now)`,
    noWorkspace: (name) => `{{${name}}}: no Workspace is open, so relative paths cannot be used`,
    untrusted: (paths) =>
      `Reads files outside the Workspace: ${paths.join(', ')} (allow this Workspace to read outside files first)`,
    notFile: (path) => `Not a file: ${path}`,
    notFound: (path) => `File not found: ${path}`,
    tooLarge: (mb, path) => `The file is larger than ${mb} MB: ${path}`
  },
  scripts: {
    level: (kind, name) => `${kind === 'collection' ? 'Collection' : 'Folder'} “${name}”`,
    noEnvironment: 'No environment is selected',
    notInCollection: 'This request is not in a Collection',
    untrusted: 'The scripts of this Workspace are not trusted yet; not sent',
    preRequestError: (label, error) =>
      `${label ? `${label}: ` : ''}Pre-request script error: ${error}`,
    maxDepth: (max) => `runRequest can be nested at most ${max} levels deep`,
    requestNotFound: (path) => `Request not found: “${path}”`,
    badMethod: (method) => `sendRequest does not support the HTTP method ${method}`,
    badUrl: (url) => `The sendRequest URL needs http:// or https://: ${url}`,
    binaryBody: 'The response is not text (binary), so scripts cannot read it',
    bodyTooLarge: (mb) => `The response is larger than ${mb} MB, so scripts cannot read it`,
    cannotRun: (message) => `Cannot run the script: ${message}`,
    logHeader: (label) => `── Script of ${label} ──`,
    labelled: (label, error) => `${label}: ${error}`,
    captureNoEnvironment: 'No environment is selected; the captured values were not saved to it',
    envWriteFailed: (error) => `Cannot write the environment variables: ${error}`,
    collectionWriteFailed: (error) => `Cannot write the Collection variables: ${error}`
  },
  mock: {
    portInUse: (port) => `Port ${port} is already in use; choose another one`,
    portDenied: (port) =>
      `No permission to use port ${port} (ports below 1024 need system permission)`,
    startFailed: (message) => `Cannot start: ${message}`,
    noRoute: 'No matching Mock route',
    binary: (bytes) => `(binary, ${plural(bytes, 'byte')})`
  },
  dataFileTooLarge: 'The data file is too large (10 MB at most)',
  variableNotFound: (name) => `Variable not found: “${name}”`
}
