import type { Messages } from '../zh-TW'

export const transferMain: Messages['transferMain'] = {
  unknown: 'unknown',
  pathError: (path, message) => `${path}: ${message}`,
  withWhere: (message, shown, total) =>
    `${message} (${shown.join(', ')}${total > shown.length ? `, ${total} in all` : ''})`,
  methodUnsupported: (method) => `Unsupported HTTP method “${method}”; changed to GET`,
  grantUnsupported: (grant) => `Unsupported OAuth 2.0 grant type “${grant}”; changed to None`,
  authUnsupported: (type) => `Unsupported Auth type “${type}”; changed to None`,
  graphqlVarsInvalid: 'GraphQL variables are not valid JSON; not imported',
  bodyUnsupported: (mode) => `Unsupported body type “${mode}”; changed to none`,
  scriptUnsupported: (list) => `The script uses calls Hachi does not support: ${list.join(', ')}`,
  binaryExample: (name) => `The example “${name}” is binary; its body was not exported`,
  bruno: {
    badBrunoJson: 'bruno.json is not valid JSON',
    noFiles: 'No Bruno files found (bruno.json, opencollection.yml, .bru or .yml)',
    awsProfile:
      'Hachi does not support the AWS Signature profile name; enter the access key instead',
    assertSkipped: (name, value) =>
      `Skipped a Bruno assertion with no counterpart: ${name}: ${value}`,
    requestType: (type) => `Unsupported Bruno request type “${type}”; skipped`,
    formFile:
      'Form-data file paths come from the original computer (Bruno uses relative paths); you may need to choose the files again',
    graphql: 'The GraphQL request became a JSON body',
    folderVars: 'Hachi does not support folder variables; not imported',
    exampleTooLarge: 'The example’s response is larger than 1 MB; not imported',
    subfolder:
      'You chose a folder inside a Collection: only this folder is imported, without the Headers / Auth / variables / environments above it',
    reenterSecrets:
      'Bruno does not store secret values in files; enter them again in the environment',
    notBrunoJson: 'Not a collection JSON exported by Bruno',
    regexCapture: 'Bruno has no regex captures of the body; changed to the whole body',
    envCapture: 'Captures saved to the environment become runtime variables in Bruno',
    assertsSkipped: 'Some assertions have no Bruno counterpart; skipped',
    hachiScript:
      'The script uses hachi.* calls, which Bruno cannot run; change them to bru / req / res',
    ssl: 'Bruno has no counterpart for the request’s SSL setting; not exported',
    httpVersion: 'Bruno has no counterpart for the request’s HTTP version setting; not exported',
    clientCertificates:
      'The collection sets client certificates; not imported: Hachi keeps them in the App settings (Settings → Client Certificates), add them there',
    settings:
      'Bruno’s .bru files have no counterpart for the request’s timeout / SSL / redirect settings; not exported',
    secretCollectionVars: 'Values of secret Collection variables are not exported (left empty)',
    envSecretNames:
      'Secret environment variables are exported by name only (Bruno does not store their values in files either)',
    badLine: (n, line) => `Cannot read line ${n}: ${line}`,
    unclosedBlock: (name) => `The block “${name}” is not closed`,
    badBlockLine: (block, line) => `Cannot read in the block “${block}”: ${line}`
  },
  postman: {
    v1: 'This is the Postman v1 format; export it again from Postman as Collection v2.1',
    version: 'Unsupported Collection format version (Postman Collection v2.0 / v2.1 is needed)',
    unknownFile:
      'Unrecognized file: Postman Collections (v2.0 / v2.1) and Postman Environments are supported',
    tokenInQuery: 'OAuth 2.0 tokens in the query are not supported; using the header',
    disabledScript: 'Disabled scripts were not imported',
    multiFiles: 'A form-data field has several files; only the first was imported',
    formFile:
      'Form-data file paths come from the original computer; you may need to choose the files again',
    graphql: 'The GraphQL body became a JSON body',
    binaryBody: 'Binary (file) bodies are not supported; changed to none',
    pathVars:
      'The URL has path variables (:name), which Hachi does not have; use {{variables}} instead',
    exampleTooLarge: (name) =>
      `The response of the example “${name}” is larger than 1 MB; not imported`,
    tooManyItems: (max) => `Cannot import more than ${max} items`,
    tooDeep: (max) =>
      `Folders nested deeper than ${max} levels; the deeper items were not imported`,
    folderVars: 'Postman folder variables are not supported; not imported',
    unknownItem: 'Unrecognized item; skipped',
    timeout: 'Postman does not support the request’s timeout; not exported',
    noProxy: 'Postman does not support “don’t use the App’s proxy”; not exported',
    sharedHeaders:
      'Postman has no shared headers: Collection / folder headers were added to every request',
    secrets: 'Secret values are not exported (left empty)'
  },
  curl: {
    unclosedDollar: "Unclosed quote ($'…')",
    unclosedSingle: "Unclosed quote (')",
    unclosedDouble: 'Unclosed quote (")',
    badHeader: (value) => `Cannot read the header: ${value}`,
    bodyFromFile: (value) =>
      `Bodies read from files (${value}) are not supported; paste the content instead`,
    badForm: (value) => `Cannot read the form field: ${value}`,
    formFromFile: (key) => `Form fields read from files (${key}) are not supported`,
    cookieFromFile: (value) => `Cookies read from files (${value}) are not supported`,
    proxy: 'cURL proxy settings are not imported (Hachi uses the App’s proxy settings)',
    auth: (name) => `--${name} authentication is not supported; set it up again in the Auth tab`,
    upload: (value) => `File uploads (-T ${value}) are not supported`,
    ignored: (option) => `Ignored the unsupported option ${option}`,
    tooLong: 'The command is too long',
    notCurl: 'Not a cURL command (it must start with curl)',
    missingValue: (option) => `${option} needs a value`,
    extraUrl: (word) => `Ignored an extra URL: ${word}`,
    noUrl: 'No URL found',
    dataAndForm: 'Both -d and -F are given; only the -F fields were imported'
  },
  openapi: {
    jsonBody: 'The JSON body is not valid JSON (it may contain variables); attached as text',
    noUrl: 'No URL; not exported',
    serverVars: (server) =>
      `The server URL has variables without values: ${server} (choose an environment when exporting)`,
    duplicate: (first, method, path) =>
      `Same path and method as “${first}” (${method} ${path}); not exported`
  },
  service: {
    tooManyFiles: (max) => `Too many files (at most ${max} Bruno files)`,
    folderTooLarge: 'The folder is too large (50 MB at most)',
    cannotReadFolder: 'Cannot read the folder',
    tooManyVars: (max) => `More than ${max} variables; only the first ${max} were imported`,
    badJson: 'Not a valid JSON file',
    fileNotFound: 'File not found',
    fileTooLarge: 'The file is too large (50 MB at most)',
    expired: 'The choice has expired; choose the folder again',
    notScanned: 'Not a Collection that was found in the folder'
  }
}
