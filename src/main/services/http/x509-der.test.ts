import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  embeddedSctCount,
  embeddedSctTimes,
  signatureAlgorithm,
  signatureAlgorithmOid
} from './x509-der'

const cert = (name: string) =>
  new X509Certificate(readFileSync(path.join(import.meta.dirname, '__fixtures__', name)))

describe('x509 DER fields (decision 142)', () => {
  it('reads the signature algorithm', () => {
    expect(signatureAlgorithmOid(cert('chain-leaf.pem').raw)).toBe('1.2.840.113549.1.1.11')
    expect(signatureAlgorithm(cert('chain-leaf.pem').raw)).toEqual({
      name: 'SHA-256 with RSA',
      weak: false
    })
    expect(signatureAlgorithm(cert('sct-leaf.pem').raw)).toEqual({
      name: 'ECDSA with SHA-256',
      weak: false
    })
  })

  it('counts the embedded SCTs', () => {
    expect(embeddedSctCount(cert('sct-leaf.pem').raw)).toBe(2)
    expect(embeddedSctCount(cert('chain-leaf.pem').raw)).toBeNull()
    expect(embeddedSctCount(cert('chain-root.pem').raw)).toBeNull()
  })

  it('reads when each SCT was issued', () => {
    const leaf = cert('sct-leaf.pem')
    const times = embeddedSctTimes(leaf.raw)
    expect(times).toHaveLength(2)
    // Logged when the precertificate was issued, around its notBefore.
    for (const t of times) {
      expect(Math.abs(t - Date.parse(leaf.validFrom))).toBeLessThan(86_400_000)
    }
    expect(embeddedSctTimes(cert('chain-leaf.pem').raw)).toEqual([])
  })

  it('gives null for anything that is not a certificate', () => {
    expect(signatureAlgorithmOid(new Uint8Array([0x30, 0x80, 0x01]))).toBeNull()
    expect(embeddedSctCount(new Uint8Array([]))).toBeNull()
    expect(embeddedSctCount(Buffer.from('not DER'))).toBeNull()
  })
})
