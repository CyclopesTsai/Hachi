import type { Messages } from '../zh-TW'

export const scriptMain: Messages['scriptMain'] = {
  engine: {
    interrupted: (seconds) => `The script ran longer than ${seconds} s and was stopped`,
    memory: (mb) => `The script used more than the memory limit (${mb} MB)`,
    stackOverflow: 'The script recursed too deeply (stack overflow)',
    atLine: (line) => ` (line ${line})`,
    noHost: 'Scripts cannot send requests here',
    maxRequests: (max) => `A script can send at most ${max} requests per run`,
    pendingForever: 'The script is waiting for a Promise that never settles',
    totalTimeout: (seconds) =>
      `The script took longer than ${seconds} s in all (including waiting for requests) and was stopped`
  },
  host: {
    noAnswer: 'The script did not answer and was stopped',
    cannotRun: (error) => `Cannot run the script: ${error}`,
    unknownError: 'unknown error',
    exited: 'The script process ended unexpectedly',
    restarted: 'The script process was restarted'
  },
  sandbox: {
    invalidPath: 'Invalid path: {0}',
    truncated: '… (truncated)',
    tooManyLogs: 'Too much output; later console messages were left out',
    noEnvironment: 'No environment is selected, so environment variables cannot be set',
    noCollection: 'This request is not in a Collection, so Collection variables cannot be set',
    tooManyChanges: 'Too many variable changes (at most {0})',
    emptyName: 'Variable names cannot be blank',
    valueTooLong: 'The variable value is too long (1 MB at most): {0}',
    readOnlyRequest: 'Post-response scripts cannot change the request',
    bodyNotEditable: 'Only JSON / Raw bodies can be changed in scripts',
    noResponse: 'There is no response yet in a Pre-request script',
    cannotReadBody: 'Cannot read the response body',
    sendRequestSpec: 'sendRequest needs a URL or request options',
    sendRequestFormdata: 'sendRequest does not support formdata bodies',
    sendRequestBody: 'The response is not text or is too large for scripts to read',
    unsupported: 'Hachi does not support {0}',
    skipped: 'Skipped test: {0}',
    btoaLatin1: 'btoa: only Latin-1 characters are accepted',
    atobInvalid: 'atob: not valid Base64',
    requireUnsupported: "Hachi does not support require('{0}') (only crypto-js)",
    legacyFalse: 'tests["{0}"] is false'
  }
}
