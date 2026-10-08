import { describe, expect, it } from 'vitest'
import { signAwsSigV4, type AwsCredentials } from './aws-sigv4'

// AWS Signature Version 4 test suite (aws-sig-v4-test-suite).
const credentials: AwsCredentials = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  sessionToken: '',
  region: 'us-east-1',
  service: 'service'
}
const now = new Date('2015-08-30T12:36:00Z')
const header = (headers: [string, string][], name: string) =>
  headers.find(([k]) => k.toLowerCase() === name)?.[1]

describe('AWS Signature V4', () => {
  it('signs get-vanilla', () => {
    const signed = signAwsSigV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: [],
      body: null,
      credentials,
      now
    })
    expect(header(signed, 'x-amz-date')).toBe('20150830T123600Z')
    expect(header(signed, 'authorization')).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    )
  })

  it('signs get-vanilla-query-order-key-case (sorted query)', () => {
    const signed = signAwsSigV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1',
      headers: [],
      body: null,
      credentials,
      now
    })
    expect(header(signed, 'authorization')).toContain(
      'Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500'
    )
  })

  it('signs post-x-www-form-urlencoded (body hash, content-type signed)', () => {
    const signed = signAwsSigV4({
      method: 'POST',
      url: 'https://example.amazonaws.com/',
      headers: [['Content-Type', 'application/x-www-form-urlencoded']],
      body: 'Param1=value1',
      credentials,
      now
    })
    expect(header(signed, 'authorization')).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a'
    )
  })

  it('adds the session token, and the payload hash for S3', () => {
    const signed = signAwsSigV4({
      method: 'PUT',
      url: 'https://bucket.s3.amazonaws.com/a b.txt',
      headers: [['Content-Type', 'text/plain']],
      body: 'UNSIGNED',
      credentials: { ...credentials, service: 's3', sessionToken: 'TOKEN' },
      now
    })
    expect(header(signed, 'x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD')
    expect(header(signed, 'x-amz-security-token')).toBe('TOKEN')
    expect(header(signed, 'authorization')).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )
  })
})
