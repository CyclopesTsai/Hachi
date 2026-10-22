import type { Messages } from '../zh-TW'
import { plural } from './plural'

export const transfer: Messages['transfer'] = {
  formats: {
    postman: 'Postman Collection v2.1',
    'bruno-yaml': 'Bruno folder (YAML)',
    bruno: 'Bruno folder (.bru)',
    'openapi-html': 'OpenAPI document (HTML)',
    'openapi-json': 'OpenAPI 3.0 (JSON)'
  },
  hints: {
    postman: 'A single JSON file for Postman or Hachi',
    'bruno-yaml':
      'The default format since Bruno 3.1 (opencollection.yml), with all environments (only the names of secrets)',
    bruno:
      'Opens in older Bruno too (.bru files), with all environments (only the names of secrets)',
    'openapi-html': 'API documentation to open in a browser (Redoc built in, works offline)',
    'openapi-json': 'An OpenAPI spec file for other tools'
  },
  curlTitle: 'Import cURL',
  curlDescription:
    'Paste a cURL command (e.g. “Copy as cURL” in the browser’s developer tools); it opens as a new unsaved tab.',
  curlLabel: 'cURL command',
  import: 'Import',
  exportTitle: 'Export Collection',
  format: 'Format',
  environment: 'Environment for the server URL and sample values',
  noEnvironment: 'No environment (Collection variables only)',
  noSecrets: 'Secret values are never written to the document.',
  chooseFolder: 'Choose Folder…',
  export: 'Export…',
  brunoTitle: 'Import Bruno Collections',
  brunoDescription: (folder, count) =>
    `“${folder}” holds ${count} Collections; check the ones to import. Environments are named “Collection name / environment name”.`,
  selectAll: 'Select all',
  importCount: (n) => `Import ${n}`,
  dropTitle: 'Drop files here',
  dropHint:
    'Postman Collections / Environments, Bruno Collections (.json), or text files with a cURL command (for Bruno folders use “+” → Import Bruno Folder…)',
  report: {
    createdCollection: (name) => `Created the Collection “${name}”`,
    counts: (requests, folders, variables) =>
      `${plural(requests, 'request')}, ${plural(folders, 'folder')}, ${plural(variables, 'variable')}`,
    createdEnvironments: (names) =>
      `Created environments: ${names.map((n) => `“${n}”`).join(', ')}`,
    createdEnvironment: (name) => `Created the environment “${name}”`,
    variables: (n) => plural(n, 'variable'),
    failed: 'Import failed',
    results: 'Import Results',
    done: 'Imported',
    curlImported: 'cURL Imported',
    openedAsDraft: 'Opened as a new unsaved tab',
    noWebSocket: (names) => `This format has no WebSocket; not exported: ${names.join(', ')}`,
    unreadable: (names) =>
      `These files could not be read and were not exported: ${names.join(', ')}`,
    exported: 'Exported',
    savedTo: (path) => `Saved to ${path}`,
    tooLarge: 'The file is too large (50 MB at most)',
    curlFile: 'The cURL command opened as a new unsaved tab',
    rest: (n) => `${n} more files`,
    tooMany: (max) => `At most ${max} files at a time`
  }
}
