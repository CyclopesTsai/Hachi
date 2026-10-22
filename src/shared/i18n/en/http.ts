import type { Messages } from '../zh-TW'

export const http: Messages['http'] = {
  unsavedRequest: 'Unsaved request',
  unsaved: 'Unsaved changes',
  codeTitle: 'Generate cURL / fetch / axios / Python code',
  saveTitle: 'Save (CmdOrCtrl+S)',
  saveTo: 'Save to…',
  method: 'HTTP method',
  urlPlaceholder: 'https://api.example.com/users  or  {{baseUrl}}/users',
  send: 'Send',
  queryParam: 'Query parameter',
  paramsHint:
    'Enabled parameters are added to the URL when sending (a query already in the URL is kept).',
  body: {
    chooseFileTitle: 'Choose a file to upload',
    chooseFile: 'Choose File',
    noFile: 'None chosen',
    type: 'Body type',
    jsonError: (error) => `Invalid JSON: ${error}`,
    format: 'Format',
    wrap: 'Wrap lines',
    variables: 'Variables',
    none: 'This request has no body.',
    fieldType: 'Field type',
    fileHint:
      'File fields store the full path of the file; when this Workspace is opened on another computer, the path may not exist.'
  },
  headers: {
    inherited: 'Inherited (read-only; change them where they come from. A header set here wins.)',
    overridden: 'Overridden',
    from: (name) => `From ${name}`
  },
  settings: {
    on: ': on',
    off: ': off',
    workspaceDefault: 'Workspace default',
    timeoutDefault: (timeout) => ` (${timeout})`,
    noLimit: 'no limit',
    timeoutUnit: 'ms (0 = no limit)',
    ssl: 'SSL certificates',
    sslOn: 'Verify',
    sslOff: 'Don’t verify',
    redirects: 'Follow redirects',
    redirectsOn: 'Follow',
    redirectsOff: 'Don’t follow',
    maxRedirects: (n) => `at most ${n}`,
    useProxy: 'Use the App’s proxy settings',
    proxyNow: (mode) =>
      `Now: ${mode === 'none' ? 'not set' : mode === 'system' ? 'system proxy' : 'custom'}`,
    useCookieJar: 'Use the Workspace’s cookie jar',
    cookieJarHint: 'Sends and keeps cookies automatically'
  },
  response: {
    errors: {
      INVALID_URL: 'Invalid URL',
      TIMEOUT: 'The request timed out',
      CANCELLED: 'Request cancelled',
      TLS: 'SSL / TLS certificate verification failed (you can turn it off in the request’s Settings)',
      PROXY: 'Could not connect through the proxy',
      NETWORK: 'Could not connect to the server',
      TOO_LARGE: 'The response is larger than 100 MB; stopped receiving it',
      FILE_NOT_FOUND: 'File not found (form-data or {{$file:…}}); the request was not sent',
      FILE_ACCESS: 'Could not read the file; the request was not sent',
      TOO_MANY_REDIRECTS: 'Too many redirects (the limit is in the Workspace settings)',
      SCRIPT: 'Script error; the request was not sent',
      AUTH: 'Authentication failed; the request was not sent',
      UNKNOWN: 'Sending failed'
    },
    download: 'Download',
    show: 'Show',
    empty: '(The response has no body)',
    unknownType: 'unknown type',
    binary: (type, size) => `Binary content (${type}, ${size}); download it to open it.`,
    large: (size) =>
      `The response is large (${size}), so it is not shown by default to keep things responsive.`,
    noCookies: 'This response sets no cookies.',
    unresolved: 'Variables not found, sent as they are: ',
    sending: 'Sending…',
    idle: 'Press “Send” to see the response',
    checkPlatforms: 'Check every platform (macOS / iOS, Windows, Mozilla)…',
    redirects: (n) => `${n} ${n === 1 ? 'redirect' : 'redirects'}`,
    view: 'Body view',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    wrap: 'Wrap lines',
    htmlPreview: 'HTML preview',
    jsonTree: 'JSON tree',
    items: (n) => `${n} ${n === 1 ? 'item' : 'items'}`,
    keys: (n) => `${n} ${n === 1 ? 'key' : 'keys'}`,
    collapse: (path) => `Collapse ${path}`,
    expand: (path) => `Expand ${path}`,
    showMore: (more, total) => `Show ${more} more (${total} in all)`
  },
  host: {
    fileError: (error) => `Cannot read this file: ${error}`,
    fileErrorHint: 'Fix the JSON and press “Reload”, or delete it on the left.',
    cannotOpen: (error) => `Cannot open: ${error}`,
    empty: 'Choose a request on the left, or right-click to add one.'
  },
  container: {
    collection: 'Collection Settings',
    folder: 'Folder Settings',
    collectionHint:
      'Headers, Auth, variables and scripts here apply to every request in this Collection (a request’s own settings win; for variables of the same name, the environment wins).',
    folderHint:
      'Headers, Auth and scripts here apply to every request in this folder (a request’s own settings win).',
    scriptFlow: 'Script order',
    sequential: 'Sequential (Postman)',
    sandwich: 'Sandwich (Bruno)',
    flowInherited: (sandwich) => `${sandwich ? 'Sandwich' : 'Sequential'} (Collection setting)`,
    sandwichHint:
      'Pre-request: Collection → folder → request; Post-response: request → folder → Collection',
    sequentialHint: 'Pre-request and Post-response both run Collection → folder → request'
  },
  prompt: {
    reloadTitle: 'Discard unsaved changes?',
    disconnectTitle: 'Disconnect and close?',
    saveTitle: 'Save your changes?',
    reloadDescription:
      'Reloading replaces the unsaved changes of these tabs with the files on disk:',
    disconnectDescription:
      'These WebSocket tabs are still connected; closing them disconnects and clears their message logs:',
    saveDescription: 'These tabs have unsaved changes or are still connected:',
    newRequest: ' (new request; you will be asked where to save it)',
    connected: (dirty) => ` (connected${dirty ? ', with unsaved changes' : ''})`,
    draftsLost: 'With “Don’t Save”, the new requests are lost.',
    discardReload: 'Discard and Reload',
    disconnectClose: 'Disconnect and Close',
    dontSave: 'Don’t Save',
    saveAll: 'Save All'
  },
  scriptTrust: {
    title: 'Trust the scripts of this Workspace?',
    description: (workspace) =>
      `This request has Pre-request / Post-response scripts. The scripts of ${workspace ? `“${workspace}”` : 'this Workspace'} may come from imported files or git; make sure you trust where they come from.`,
    sandbox:
      'Scripts run in a sandbox and cannot read or write files; they can send other requests with sendRequest.',
    variables:
      'Scripts can read and change variables (secrets included); changes are listed in the response’s Tests tab.',
    remembered:
      'Your choice is remembered on this computer only; undo it in the Workspace settings.',
    skip: 'Skip Scripts This Time',
    trust: 'Trust and Run'
  },
  fileTrust: {
    title: 'Allow reading files outside the Workspace?',
    description: (workspace) =>
      `This request reads the files below with {{$file:…}} and sends their contents to the request’s server. The requests of ${workspace ? `“${workspace}”` : 'this Workspace'} may come from imported files or git; make sure you trust where they come from.`,
    hint: 'Files inside the Workspace folder need no permission. Your choice is remembered on this computer only; undo it in the Workspace settings.',
    allow: 'Allow and Send'
  },
  saveResult: {
    title: 'Save as Example',
    description:
      'Keeps this request and its response under the request (read-only, committed with the Workspace). Secret values go back to {{name}}, and credential headers such as Authorization and Cookie are hidden.',
    name: 'Name',
    saveRequestFirst: 'Save the request first to keep examples under it',
    tooLarge: (mb) => `The response is larger than ${mb} MB and cannot be saved`,
    button: 'Save Example',
    buttonTitle: 'Keep this request and its response under the request'
  },
  example: {
    noBody: '(no body)',
    file: (value) => `(file) ${value}`,
    bodyTitle: (mode) => `Body (${mode})`,
    empty: '(The response has no body)',
    image: 'Image of the response',
    binary: (type, size) => `Binary content (${type}, ${size}); cannot be shown.`,
    readOnly: 'Example (read-only)',
    openRequest: 'Open Request'
  },
  code: {
    title: 'Generate Code',
    description:
      'Made from what is in the editor now (with inherited Headers / Auth and the current environment’s variables).',
    language: 'Language',
    reveal: 'Show secret values',
    copied: 'Copied',
    copy: 'Copy',
    urlError: (error) => `${error} (the code uses the URL as typed)`,
    revealed:
      'Secret variables are replaced with their real values; be careful before sharing the code.',
    kept: 'Secret variables stay as {{name}}; check “Show secret values” to use the real values.',
    curl: ' cURL commands use the quoting rules of macOS / Linux shells.'
  }
}
