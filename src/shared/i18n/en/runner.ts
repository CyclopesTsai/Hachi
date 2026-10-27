import type { Messages } from '../zh-TW'
import { plural } from './plural'

export const runner: Messages['runner'] = {
  status: {
    running: 'Running',
    done: 'Done',
    cancelled: 'Cancelled',
    stopped: 'Stopped',
    error: 'Error'
  },
  errors: {
    TIMEOUT: 'Timeout',
    NETWORK: 'Connection failed',
    TLS: 'SSL / TLS',
    PROXY: 'Proxy',
    SCRIPT: 'Script error',
    INVALID_URL: 'Invalid URL',
    TOO_LARGE: 'Response too large',
    FILE_NOT_FOUND: 'File not found',
    TOO_MANY_REDIRECTS: 'Too many redirects',
    HTTP_VERSION: 'HTTP version',
    CANCELLED: 'Cancelled',
    UNKNOWN: 'Other'
  },
  requests: (picked, total) => `Requests (${picked} / ${total})`,
  selectAll: 'All',
  selectNone: 'None',
  wsSkipped: 'WebSockets are not run',
  unsavedNote: 'Some requests have unsaved changes; the Runner uses their saved versions.',
  environment: 'Environment',
  noEnvironment: 'No environment',
  endMode: 'Stop after',
  iterations: 'Iterations',
  duration: 'Duration',
  iterationsPerWorker: 'Iterations (per worker)',
  durationSec: 'Duration (seconds)',
  concurrency: 'Concurrency',
  totalRounds: (iterations, concurrency, total) =>
    `Rounds in all = ${iterations} × ${concurrency} = ${total}`,
  durationNote: (concurrency, seconds) =>
    `${concurrency === 1 ? 'The worker keeps' : `${concurrency} workers each keep`} running until ${plural(seconds, 'second')}; then no new round starts, and rounds already started finish`,
  concurrencyNote:
    '. With concurrency, each worker has its own variables and environment / Collection changes are not written to files',
  delay: 'Delay between requests (ms)',
  delayLabel: 'Delay between requests',
  stopOnFailure: 'Stop on failure (errors, script errors, or any failing test / assertion)',
  keepBodies: 'Response bodies',
  keepBodiesHint: 'When kept: up to 1 MB each, 200 MB in all',
  keepNone: 'Don’t keep',
  keepAll: 'Keep all',
  dataFile: 'Data file (CSV / JSON)',
  dataFileHint: 'Round n uses row (n mod rows); use the fields as {{column}} or pm.iterationData',
  dataRows: (rows, columns) => `${plural(rows, 'row')} · fields: ${columns.join(', ')}`,
  removeData: 'Remove the data file',
  chooseFile: 'Choose File…',
  dataExample: 'Data file examples',
  csvExample: 'CSV (the first row holds the names):',
  jsonExample: 'JSON (an array of objects):',
  exampleNote1:
    'Both examples have 2 rows: rounds 1, 3, 5… use alice and rounds 2, 4, 6… use bob. In requests write',
  exampleNote2: ', in scripts use',
  exampleNote3: '.',
  columns: {
    index: ['#', 'Order of completion'],
    round: [
      'Round',
      'Which round: a number shared by all workers, given in the order rounds start (not tied to a worker). One round = each checked request once, in order; with a data file, round n uses row n'
    ],
    worker: [
      'Worker',
      'Which worker ran it. Concurrency = the number of workers running at the same time; each runs its iterations one after another, with its own variables'
    ],
    request: ['Request', null],
    status: ['Status', null],
    time: ['Time', null],
    size: ['Size', null],
    tests: ['Tests', 'Passed / tests and assertions in all; — means the request has none']
  },
  stats: {
    avg: 'Avg',
    min: 'Min',
    max: 'Max',
    stdDev: 'Std dev',
    request: 'Request',
    count: 'Count',
    ok: 'OK',
    failed: 'Failed',
    errorRate: 'Error rate',
    testsPassed: 'Tests passed',
    total: 'Total'
  },
  detail: 'Details',
  detailMissing:
    'The details of this one were not kept (only the first 2000, and 2000 failures after that).',
  detailLine: (time, size, round, worker) =>
    `· ${time} · ${size} · round ${round} · worker ${worker}`,
  errorWithMessage: (label, message) => `${label}: ${message}`,
  response: 'Response',
  requestHeaders: 'Request Headers',
  dataRow: 'Data Row',
  none: '(none)',
  idle: 'Set it up, then press “Start”',
  countsDuration: (requests, rounds, elapsed, duration) =>
    `${plural(requests, 'request')} · ${plural(rounds, 'round')} · ${elapsed} / ${duration}`,
  counts: (requests, total, rounds, totalRounds, elapsed) =>
    `${requests} / ${plural(total, 'request')} · ${rounds} / ${plural(totalRounds, 'round')} · ${elapsed}`,
  skipped: (names) => `Skipped (WebSocket or unreadable): ${names.join(', ')}`,
  statusCodes: 'Status codes',
  errorKinds: 'Error kinds',
  latencyChart: 'Time (per second)',
  rpsChart: 'Requests finished per second',
  rpsUnit: '',
  requestsSeries: 'Requests',
  chartData: 'Chart data',
  chartColumns: ['Second', 'Requests', 'p50 (ms)', 'p95 (ms)'],
  results: 'Results',
  filterResults: 'Filter results',
  all: 'All',
  failedOnly: 'Failures only',
  page: (current, pages, total) => `Page ${current} / ${pages} (${total})`,
  previous: 'Previous page',
  next: 'Next page',
  title: (name) => `Collection Runner: ${name}`,
  export: 'Export Results',
  exportHtml: 'HTML Report…',
  exportJson: 'JSON (complete)…',
  stop: 'Stop',
  start: 'Start',
  pickOne: 'Check at least one request',
  second: (n) => `Second ${n}`
}
