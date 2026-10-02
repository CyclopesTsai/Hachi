import { describe, expect, it } from 'vitest'
import { CurlParseError, parseCurl, tokenizeCmd, tokenizePosix } from './curl'

let n = 0
const parse = (text: string) => parseCurl(text, () => `id-${++n}`)
const headers = (text: string) => parse(text).request.headers.map((h) => [h.key, h.value])

describe('tokenizePosix', () => {
  it('handles quotes, escapes, $-quoting, continuations and comments', () => {
    expect(
      tokenizePosix(`curl 'a b' "c \\"d\\" \\$e" f\\ g \\\n  h $'i\\nj\\x41\\u00e9' # note`)
    ).toEqual(['curl', 'a b', 'c "d" $e', 'f g', 'h', 'i\njAé'])
    expect(tokenizePosix(`a "x\\y" ''`)).toEqual(['a', 'x\\y', ''])
  })

  it('rejects unterminated quotes', () => {
    expect(() => tokenizePosix("curl 'oops")).toThrow(CurlParseError)
    expect(() => tokenizePosix('curl "oops')).toThrow(CurlParseError)
  })
})

describe('tokenizeCmd', () => {
  it('handles ^ escapes, ^ line continuations and C runtime quoting', () => {
    expect(
      tokenizeCmd(
        'curl ^"https://a.test/?q=1^&r=2^" ^\n  -H ^"x: 1^" ^\n  --data-raw ^"^{\\^"a\\^":1^}^"'
      )
    ).toEqual(['curl', 'https://a.test/?q=1&r=2', '-H', 'x: 1', '--data-raw', '{"a":1}'])
  })
})

describe('parseCurl', () => {
  it('parses a simple GET', () => {
    const { request, warnings } = parse('curl https://api.test/users?page=2')
    expect(request).toMatchObject({
      method: 'GET',
      url: 'https://api.test/users?page=2',
      name: 'GET api.test/users',
      auth: { type: 'inherit' },
      body: { mode: 'none' }
    })
    expect(warnings).toEqual([])
  })

  it('reads JSON bodies, removing the implied Content-Type', () => {
    const { request } = parse(`curl -X POST https://api.test/users \\
      -H 'Content-Type: application/json' -H 'Authorization: Bearer t' \\
      -d '{"name":"Hachi"}'`)
    expect(request.method).toBe('POST')
    expect(request.body).toMatchObject({ mode: 'json', json: '{"name":"Hachi"}' })
    expect(request.headers.map((h) => h.key)).toEqual(['Authorization'])
  })

  it('defaults to POST and detects JSON without a Content-Type', () => {
    const { request } = parse(`curl https://a.test --data-raw '[1,2]'`)
    expect(request.method).toBe('POST')
    expect(request.body.mode).toBe('json')
  })

  it('turns form data into urlencoded rows (decoded; --data-urlencode kept as typed)', () => {
    const { request } = parse(
      `curl https://a.test -d 'a=1&b=hello%20world' --data-urlencode 'msg=a&b c' -d c=x+y`
    )
    expect(request.body.mode).toBe('urlencoded')
    expect(request.body.urlencoded.map((r) => [r.key, r.value])).toEqual([
      ['a', '1'],
      ['b', 'hello world'],
      ['msg', 'a&b c'],
      ['c', 'x y']
    ])
  })

  it('keeps other bodies as raw with their Content-Type', () => {
    const xml = parse(`curl https://a.test -H 'content-type: text/xml' -d '<a/>'`).request
    expect(xml.body).toMatchObject({ mode: 'raw', raw: '<a/>', rawContentType: 'text/xml' })
    expect(xml.headers).toEqual([])
    const plain = parse(`curl https://a.test -d 'just text'`).request
    expect(plain.body).toMatchObject({
      mode: 'raw',
      raw: 'just text',
      rawContentType: 'application/x-www-form-urlencoded'
    })
  })

  it('reads multipart forms', () => {
    const { request } = parse(
      `curl https://a.test -F 'title=cat;type=text/plain' -F 'file=@"/tmp/my cat.png";type=image/png' --form-string 'raw=@literal'`
    )
    expect(request.method).toBe('POST')
    expect(request.body.formData.map((f) => [f.key, f.type, f.value, f.filePath])).toEqual([
      ['title', 'text', 'cat', ''],
      ['file', 'file', '', '/tmp/my cat.png'],
      ['raw', 'text', '@literal', '']
    ])
  })

  it('maps auth, cookies, user agent, referer, timeout and -k', () => {
    const { request } = parse(
      `curl -sSLk -u 'me:p@ss:word' -b 'a=1' --cookie 'b=2' -A 'Bot/1' -e https://ref.test -m 2.5 https://a.test`
    )
    expect(request.auth).toEqual({ type: 'basic', username: 'me', password: 'p@ss:word' })
    expect(request.headers.map((h) => [h.key, h.value])).toEqual([
      ['User-Agent', 'Bot/1'],
      ['Referer', 'https://ref.test'],
      ['Cookie', 'a=1; b=2']
    ])
    expect(request.settings).toMatchObject({ timeoutMs: 2500, validateSSL: false })
    expect(parse('curl --oauth2-bearer tok https://a.test').request.auth).toEqual({
      type: 'bearer',
      token: 'tok'
    })
  })

  it('supports combined short options with values, -G, -I and --json', () => {
    expect(parse('curl -XPUT https://a.test').request.method).toBe('PUT')
    expect(parse('curl -sXDELETE https://a.test').request.method).toBe('DELETE')
    expect(headers('curl -HAccept:text/html https://a.test')).toEqual([['Accept', 'text/html']])
    const get = parse(`curl -G https://a.test -d q=hachi -d n=1`).request
    expect(get.method).toBe('GET')
    expect(get.params.map((p) => [p.key, p.value])).toEqual([
      ['q', 'hachi'],
      ['n', '1']
    ])
    expect(parse('curl -I https://a.test').request.method).toBe('HEAD')
    const json = parse(`curl --json '{"a":1}' https://a.test`).request
    expect(json.body.mode).toBe('json')
    expect(json.headers.map((h) => h.key)).toEqual(['Accept'])
  })

  it('handles browser "Copy as cURL" output', () => {
    const posix = parse(`curl 'https://a.test/api' \\
  -H 'accept: */*' \\
  -H 'sec-ch-ua: "Chromium";v="140"' \\
  --data-raw $'{"note":"it\\'s"}' \\
  --compressed`).request
    expect(posix.body).toMatchObject({ mode: 'json', json: `{"note":"it's"}` })
    expect(posix.headers.map((h) => h.key)).toEqual(['accept', 'sec-ch-ua'])
    const cmd = parse(
      'curl ^"https://a.test/api^" ^\n  -H ^"accept: */*^" ^\n  --data-raw ^"^{\\^"a\\^":1^}^" ^\n  --compressed'
    ).request
    expect(cmd.url).toBe('https://a.test/api')
    expect(cmd.body).toMatchObject({ mode: 'json', json: '{"a":1}' })
  })

  it('warns about what it cannot import', () => {
    const { warnings } = parse(
      `curl -x http://proxy:8080 -d @body.json --digest --foo https://a.test extra`
    )
    expect(warnings).toEqual([
      'cURL 的 Proxy 設定不會匯入（Hachi 使用 App 的 Proxy 設定）',
      '不支援從檔案讀取 Body（@body.json），請手動貼上內容',
      '不支援 --digest 驗證，請在 Auth 分頁重新設定',
      '忽略不支援的選項 --foo',
      '忽略多餘的網址：extra'
    ])
  })

  it('names the request after the URL as typed', () => {
    expect(parse(`curl -X PUT '{{baseUrl}}/Echo/?a=1'`).request.name).toBe('PUT {{baseUrl}}/Echo')
    expect(parse('curl HTTPS://API.test').request.name).toBe('GET API.test')
  })

  it('accepts a leading prompt and curl.exe', () => {
    expect(parse('$ curl https://a.test').request.url).toBe('https://a.test')
    expect(parse('curl.exe https://a.test').request.url).toBe('https://a.test')
  })

  it('rejects input that is not a usable cURL command', () => {
    expect(() => parse('wget https://a.test')).toThrow(/不是 cURL/)
    expect(() => parse('curl -s')).toThrow(/找不到網址/)
    expect(() => parse('curl -H')).toThrow(/缺少值/)
    expect(() => parse('curl -X PURGE https://a.test')).not.toThrow()
    expect(parse('curl -X PURGE https://a.test').warnings[0]).toMatch(/PURGE/)
  })
})
