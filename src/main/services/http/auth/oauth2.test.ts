import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { oauth2AuthSchema, type OAuth2Auth } from '@shared/schemas/collection'
import { OAuth2Service, parseCallbackUrl, parseTokenResponse, type TokenRequest } from './oauth2'

const auth = (extra: Partial<OAuth2Auth> = {}): OAuth2Auth =>
  oauth2AuthSchema.parse({
    type: 'oauth2',
    accessTokenUrl: 'https://auth.test/token',
    clientId: 'my id',
    clientSecret: 's3cret',
    ...extra
  })

type Reply = { status: number; body: string }

function service(
  reply: (request: TokenRequest, n: number) => Reply,
  openBrowser: (url: string) => Promise<void> = fail
) {
  const requests: TokenRequest[] = []
  const svc = new OAuth2Service({
    postForm: async (request) => {
      requests.push(request)
      await new Promise((r) => setTimeout(r, 5))
      return reply(request, requests.length)
    },
    openBrowser
  })
  return { svc, requests }
}

async function fail(): Promise<void> {
  throw new Error('no browser in this test')
}

const token = (n: number, extra: object = {}) => ({
  status: 200,
  body: JSON.stringify({ access_token: `t${n}`, token_type: 'Bearer', expires_in: 3600, ...extra })
})
const form = (request: TokenRequest) => Object.fromEntries(new URLSearchParams(request.body))

describe('OAuth 2.0 (decision 128)', () => {
  it('fetches a client credentials token once and keeps it', async () => {
    const { svc, requests } = service((_r, n) => token(n))
    const [a, b] = await Promise.all([svc.tokenFor(auth()), svc.tokenFor(auth())])
    expect(a.accessToken).toBe('t1')
    expect(b.accessToken).toBe('t1')
    expect((await svc.tokenFor(auth())).accessToken).toBe('t1')
    expect(requests).toHaveLength(1)
    // RFC 6749 §2.3.1: id and secret are form-encoded before Base64.
    expect(requests[0]?.headers).toContainEqual([
      'Authorization',
      `Basic ${Buffer.from('my%20id:s3cret').toString('base64')}`
    ])
    expect(form(requests[0] as TokenRequest)).toEqual({ grant_type: 'client_credentials' })
    expect(svc.status(auth())).toMatchObject({ state: 'valid', refreshable: false })
  })

  it('sends the password grant with credentials in the body', async () => {
    const { svc, requests } = service((_r, n) => token(n))
    await svc.tokenFor(
      auth({
        grantType: 'password',
        username: 'u',
        password: 'p',
        scope: 'a b',
        clientAuth: 'body'
      })
    )
    expect(form(requests[0] as TokenRequest)).toEqual({
      grant_type: 'password',
      username: 'u',
      password: 'p',
      scope: 'a b',
      client_id: 'my id',
      client_secret: 's3cret'
    })
  })

  it('refreshes an expired token with its refresh token', async () => {
    const { svc, requests } = service((_r, n) =>
      n === 1 ? token(1, { expires_in: 1, refresh_token: 'r1' }) : token(n)
    )
    await svc.tokenFor(auth())
    expect(svc.status(auth()).state).toBe('expired')
    expect((await svc.tokenFor(auth())).accessToken).toBe('t2')
    expect(form(requests[1] as TokenRequest)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'r1'
    })
    // The old refresh token is kept when the server does not send a new one.
    expect(svc.cached(auth())?.refreshToken).toBe('r1')
  })

  it('reports token endpoint errors readably', async () => {
    const { svc } = service(() => ({
      status: 401,
      body: JSON.stringify({ error: 'invalid_client', error_description: 'Bad secret' })
    }))
    await expect(svc.tokenFor(auth())).rejects.toThrow(
      '取得 OAuth 2.0 Token 失敗（HTTP 401）：invalid_client：Bad secret'
    )
    expect(svc.status(auth()).state).toBe('none')
    expect(parseTokenResponse(200, 'access_token=x&token_type=bearer').accessToken).toBe('x')
    expect(() => parseTokenResponse(200, '{}')).toThrow('回應中沒有 access_token')
  })

  it('needs "取得 Token" for authorization code', async () => {
    const { svc } = service((_r, n) => token(n))
    await expect(svc.tokenFor(auth({ grantType: 'authorization_code' }))).rejects.toThrow(
      '請先在 Auth 分頁按「取得 Token」'
    )
  })

  it('runs the authorization code flow with PKCE on a loopback callback', async () => {
    let challenge = ''
    const openBrowser = async (url: string) => {
      const u = new URL(url)
      expect(u.origin + u.pathname).toBe('https://auth.test/authorize')
      expect(u.searchParams.get('response_type')).toBe('code')
      expect(u.searchParams.get('code_challenge_method')).toBe('S256')
      challenge = u.searchParams.get('code_challenge') ?? ''
      const redirect = new URL(u.searchParams.get('redirect_uri') ?? '')
      expect(redirect.hostname).toBe('127.0.0.1')
      // A request with the wrong state is ignored; the right one completes the flow.
      await fetch(`${redirect}?code=wrong&state=nope`)
      redirect.searchParams.set('code', 'the-code')
      redirect.searchParams.set('state', u.searchParams.get('state') ?? '')
      const page = await fetch(redirect)
      expect(await page.text()).toContain('已完成授權')
    }
    const { svc, requests } = service((r) => {
      const f = form(r)
      const verifier = createHash('sha256')
        .update(f.code_verifier ?? '')
        .digest('base64url')
      return f.code === 'the-code' && verifier === challenge
        ? token(9, { refresh_token: 'r' })
        : { status: 400, body: '{"error":"invalid_grant"}' }
    }, openBrowser)
    const settings = auth({
      grantType: 'authorization_code',
      authUrl: 'https://auth.test/authorize',
      clientSecret: ''
    })
    await svc.obtain(settings)
    expect(svc.status(settings)).toMatchObject({ state: 'valid', refreshable: true })
    // A public client (no secret) sends its id in the body.
    expect(form(requests[0] as TokenRequest)).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'my id'
    })
    expect(requests[0]?.headers.some(([k]) => k === 'Authorization')).toBe(false)
  })

  it('reports an authorization error and can be cancelled', async () => {
    const denied = service(
      () => token(1),
      async (url) => {
        const u = new URL(url)
        const redirect = new URL(u.searchParams.get('redirect_uri') ?? '')
        redirect.searchParams.set('error', 'access_denied')
        await fetch(redirect)
      }
    )
    const settings = auth({ grantType: 'authorization_code', authUrl: 'https://auth.test/a' })
    await expect(denied.svc.obtain(settings)).rejects.toThrow('授權失敗：access_denied')

    const waiting = service(
      () => token(1),
      async () => undefined
    )
    const pending = waiting.svc.obtain(settings)
    await new Promise((r) => setTimeout(r, 50))
    expect(waiting.svc.cancel(settings)).toBe(true)
    await expect(pending).rejects.toThrow('已取消')
  })

  it('only accepts loopback callback URLs', () => {
    expect(parseCallbackUrl('')).toEqual({ host: '127.0.0.1', port: 0, path: '/callback' })
    expect(parseCallbackUrl('http://localhost:8080/cb')).toEqual({
      host: 'localhost',
      port: 8080,
      path: '/cb'
    })
    expect(() => parseCallbackUrl('https://example.com/cb')).toThrow('Callback URL 需要是')
  })
})
