/**
 * AWS Signature Version 4 (decision 128): signs a built request with the
 * `Authorization: AWS4-HMAC-SHA256 …` header. Signed headers: host, content-type and
 * every x-amz-* header. S3 gets `x-amz-content-sha256` and single-encoded paths.
 */
import { createHash, createHmac } from 'node:crypto'

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  region: string
  service: string
}

export interface AwsSignInput {
  method: string
  url: string
  headers: readonly [string, string][]
  /** Request body text; 'UNSIGNED' for a body that can't be hashed (multipart, S3 only). */
  body: string | null | 'UNSIGNED'
  credentials: AwsCredentials
  /** Fixed in tests. */
  now?: Date
}

const sha256 = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex')
const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data, 'utf8').digest()

/** RFC 3986 encoding (encodeURIComponent leaves !'()* alone). */
const encode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function canonicalPath(pathname: string, s3: boolean): string {
  const segments = pathname.split('/').map((s) => encode(safeDecode(s)))
  // Other services want each segment encoded twice (AWS docs); S3 once.
  return (s3 ? segments : segments.map(encode)).join('/') || '/'
}

function canonicalQuery(search: string): string {
  if (search.length <= 1) return ''
  const pairs = search
    .slice(1)
    .split('&')
    .filter((p) => p !== '')
    .map((p): [string, string] => {
      const i = p.indexOf('=')
      const [k, v] = i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)]
      const dec = (x: string) => safeDecode(x.replace(/\+/g, ' '))
      return [encode(dec(k)), encode(dec(v))]
    })
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
  return pairs.map(([k, v]) => `${k}=${v}`).join('&')
}

/** Headers to add to the request (x-amz-date, Authorization, …). */
export function signAwsSigV4(input: AwsSignInput): [string, string][] {
  const { credentials: c } = input
  const url = new URL(input.url)
  const s3 = c.service.toLowerCase() === 's3'
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)

  const payloadHash =
    input.body === 'UNSIGNED' ? 'UNSIGNED-PAYLOAD' : sha256(input.body === null ? '' : input.body)
  const added: [string, string][] = [['X-Amz-Date', amzDate]]
  if (s3) added.push(['X-Amz-Content-Sha256', payloadHash])
  if (c.sessionToken !== '') added.push(['X-Amz-Security-Token', c.sessionToken])

  const toSign = new Map<string, string[]>([['host', [url.host]]])
  for (const [name, value] of [...input.headers, ...added]) {
    const lower = name.toLowerCase()
    if (lower !== 'content-type' && !lower.startsWith('x-amz-')) continue
    const list = toSign.get(lower) ?? []
    list.push(value.trim().replace(/\s+/g, ' '))
    toSign.set(lower, list)
  }
  const names = [...toSign.keys()].sort()
  const signedHeaders = names.join(';')
  const canonicalHeaders = names.map((n) => `${n}:${(toSign.get(n) ?? []).join(',')}\n`).join('')

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname, s3),
    canonicalQuery(url.search),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')
  const scope = `${day}/${c.region}/${c.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const key = hmac(
    hmac(hmac(hmac(`AWS4${c.secretAccessKey}`, day), c.region), c.service),
    'aws4_request'
  )
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex')
  return [
    ...added,
    [
      'Authorization',
      `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    ]
  ]
}
