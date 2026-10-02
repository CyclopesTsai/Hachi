import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, utf8Bytes } from './ws'

describe('binary helpers', () => {
  it('parses hex in common notations', () => {
    expect([...hexToBytes('0a ff 10')]).toEqual([10, 255, 16])
    expect([...hexToBytes('0x0A,0xFF\n10')]).toEqual([10, 255, 16])
    expect([...hexToBytes('')]).toEqual([])
    expect(() => hexToBytes('abc')).toThrow(/pairs/)
    expect(() => hexToBytes('zz')).toThrow()
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('00 0f ff')
  })

  it('round-trips Base64, accepting URL-safe input', () => {
    const bytes = new Uint8Array([251, 255, 0, 1, 2])
    const b64 = bytesToBase64(bytes)
    expect(b64).toBe('+/8AAQI=')
    expect([...base64ToBytes(b64)]).toEqual([...bytes])
    expect([...base64ToBytes('-_8AAQI')]).toEqual([...bytes])
    expect(() => base64ToBytes('a')).toThrow()
    expect(() => base64ToBytes('@@@@')).toThrow()
    const big = new Uint8Array(100_000).map((_, i) => i % 256)
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big)
  })

  it('counts UTF-8 bytes', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('中文')).toBe(6)
  })
})
