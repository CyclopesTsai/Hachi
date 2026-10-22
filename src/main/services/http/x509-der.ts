/**
 * Reads the few certificate fields X509Certificate does not expose (decision 142): the
 * signature algorithm and the Certificate Transparency SCTs embedded in the certificate.
 * Just enough DER to walk a certificate; anything unexpected gives null.
 */

interface Element {
  tag: number
  /** Where the content starts and ends (exclusive). */
  start: number
  end: number
}

function element(buf: Uint8Array, offset: number, limit: number): Element | null {
  if (offset + 2 > limit) return null
  const tag = buf[offset] as number
  let length = buf[offset + 1] as number
  let start = offset + 2
  if (length & 0x80) {
    const bytes = length & 0x7f
    if (bytes === 0 || bytes > 4 || start + bytes > limit) return null
    length = 0
    for (let i = 0; i < bytes; i++) length = length * 256 + (buf[start + i] as number)
    start += bytes
  }
  const end = start + length
  return end > limit ? null : { tag, start, end }
}

function children(buf: Uint8Array, parent: Element): Element[] {
  const out: Element[] = []
  for (let offset = parent.start; offset < parent.end;) {
    const child = element(buf, offset, parent.end)
    if (!child) return []
    out.push(child)
    offset = child.end
  }
  return out
}

function oid(buf: Uint8Array, e: Element): string {
  const bytes = buf.subarray(e.start, e.end)
  if (bytes.length === 0) return ''
  const first = bytes[0] as number
  const arc = first < 80 ? Math.floor(first / 40) : 2
  const parts = [arc, first - arc * 40]
  let value = 0
  for (const b of bytes.subarray(1)) {
    value = value * 128 + (b & 0x7f)
    if (!(b & 0x80)) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

const TAG = { sequence: 0x30, oid: 0x06, octetString: 0x04, extensions: 0xa3 }

/** [tbsCertificate, signatureAlgorithm] of a DER certificate. */
function top(der: Uint8Array): [Element, Element] | null {
  const cert = element(der, 0, der.length)
  if (cert?.tag !== TAG.sequence) return null
  const [tbs, alg] = children(der, cert)
  return tbs && alg ? [tbs, alg] : null
}

/** The certificate's signature algorithm OID, e.g. 1.2.840.113549.1.1.11. */
export function signatureAlgorithmOid(der: Uint8Array): string | null {
  const parts = top(der)
  const first = parts ? children(der, parts[1])[0] : undefined
  return first?.tag === TAG.oid ? oid(der, first) : null
}

const SIGNATURE_NAMES: Record<string, string> = {
  '1.2.840.113549.1.1.4': 'MD5 with RSA',
  '1.2.840.113549.1.1.5': 'SHA-1 with RSA',
  '1.2.840.113549.1.1.10': 'RSA-PSS',
  '1.2.840.113549.1.1.11': 'SHA-256 with RSA',
  '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
  '1.2.840.113549.1.1.13': 'SHA-512 with RSA',
  '1.2.840.10045.4.1': 'ECDSA with SHA-1',
  '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
  '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
  '1.3.101.112': 'Ed25519'
}

/** Readable name of a signature algorithm; `weak` for MD5 / SHA-1. */
export function signatureAlgorithm(der: Uint8Array): { name: string; weak: boolean } | null {
  const id = signatureAlgorithmOid(der)
  if (!id) return null
  return {
    name: SIGNATURE_NAMES[id] ?? id,
    weak: ['1.2.840.113549.1.1.4', '1.2.840.113549.1.1.5', '1.2.840.10045.4.1'].includes(id)
  }
}

const SCT_LIST_OID = '1.3.6.1.4.1.11129.2.4.2'

/** The embedded SCTs (each TLS-encoded); null when the certificate has no SCT extension. */
function embeddedScts(der: Uint8Array): Uint8Array[] | null {
  const parts = top(der)
  if (!parts) return null
  const extensions = children(der, parts[0]).find((e) => e.tag === TAG.extensions)
  const list = extensions ? children(der, extensions)[0] : undefined
  if (!list) return null
  for (const ext of children(der, list)) {
    const fields = children(der, ext)
    const id = fields[0]
    if (id?.tag !== TAG.oid || oid(der, id) !== SCT_LIST_OID) continue
    const value = fields[fields.length - 1]
    if (value?.tag !== TAG.octetString) return null
    // The extension value is itself an OCTET STRING holding the TLS-encoded list.
    const inner = element(der, value.start, value.end)
    if (inner?.tag !== TAG.octetString) return null
    const bytes = der.subarray(inner.start, inner.end)
    if (bytes.length < 2) return null
    const total = ((bytes[0] as number) << 8) | (bytes[1] as number)
    const end = Math.min(bytes.length, total + 2)
    const scts: Uint8Array[] = []
    for (let offset = 2; offset + 2 <= end;) {
      const length = ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number)
      scts.push(bytes.subarray(offset + 2, Math.min(end, offset + 2 + length)))
      offset += 2 + length
    }
    return scts
  }
  return null
}

/**
 * How many SCTs are embedded in the certificate; null when it has no SCT extension.
 * (SCTs sent in the TLS handshake or a stapled OCSP response are not visible here.)
 */
export function embeddedSctCount(der: Uint8Array): number | null {
  return embeddedScts(der)?.length ?? null
}

/**
 * When each embedded SCT was issued (epoch ms): version (1 byte), log id (32 bytes),
 * then a 64-bit timestamp in milliseconds. Empty when there are none.
 */
export function embeddedSctTimes(der: Uint8Array): number[] {
  return (embeddedScts(der) ?? []).flatMap((sct) => {
    if (sct.length < 41) return []
    let ms = 0
    for (let i = 33; i < 41; i++) ms = ms * 256 + (sct[i] as number)
    return [ms]
  })
}
