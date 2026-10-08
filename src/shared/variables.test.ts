import { describe, expect, it } from 'vitest'
import type { Variable } from './schemas/collection'
import { httpRequestSchema } from './schemas/http-request'
import {
  MAX_DEPTH,
  VariableResolver,
  applyVariableChanges,
  buildVariableMap,
  findVariableTokens,
  maskSecret,
  type DynamicValues,
  type VariableLayer
} from './variables'

const v = (key: string, value: string, extra: Partial<Variable> = {}): Variable => ({
  id: key,
  key,
  value,
  enabled: true,
  secret: false,
  ...extra
})

const env = (...variables: Variable[]): VariableLayer => ({
  source: 'environment',
  sourceName: 'dev',
  variables
})
const coll = (...variables: Variable[]): VariableLayer => ({
  source: 'collection',
  sourceName: 'Users API',
  variables
})

const fixed: DynamicValues = {
  guid: () => '00000000-0000-4000-8000-000000000000',
  now: () => new Date('2026-10-02T03:04:05.678Z'),
  random: () => 0.5
}

function resolver(...layers: VariableLayer[]) {
  return new VariableResolver(buildVariableMap(layers), fixed)
}

describe('buildVariableMap', () => {
  it('gives earlier layers precedence (environment over collection)', () => {
    const map = buildVariableMap([env(v('host', 'dev.example')), coll(v('host', 'prod.example'))])
    expect(map.get('host')).toMatchObject({ value: 'dev.example', source: 'environment' })
  })

  it('falls back to later layers and skips disabled / blank variables', () => {
    const map = buildVariableMap([
      env(v('host', 'x', { enabled: false }), v('  ', 'blank')),
      coll(v('host', 'from-collection'))
    ])
    expect(map.get('host')?.value).toBe('from-collection')
    expect(map.size).toBe(1)
  })

  it('trims names and keeps the secret flag', () => {
    const map = buildVariableMap([env(v(' token ', 's3cret', { secret: true }))])
    expect(map.get('token')).toMatchObject({ secret: true, sourceName: 'dev' })
  })
})

describe('VariableResolver.resolve', () => {
  it('replaces known variables, tolerating spaces inside the braces', () => {
    const r = resolver(env(v('host', 'api.example.com'), v('ver', '2')))
    expect(r.resolve('https://{{host}}/v{{ ver }}/users')).toBe('https://api.example.com/v2/users')
    expect([...r.unresolved]).toEqual([])
  })

  it('leaves unknown variables as-is and reports them once', () => {
    const r = resolver(env(v('host', 'h')))
    expect(r.resolve('{{host}}/{{missing}}/{{missing}}')).toBe('h/{{missing}}/{{missing}}')
    expect([...r.unresolved]).toEqual(['missing'])
  })

  it('follows nested references across layers', () => {
    const r = resolver(env(v('base', 'https://{{host}}/api')), coll(v('host', 'example.com')))
    expect(r.resolve('{{base}}/users')).toBe('https://example.com/api/users')
  })

  it('stops at cycles without hanging', () => {
    const r = resolver(env(v('a', 'x{{b}}'), v('b', 'y{{a}}')))
    expect(r.resolve('{{a}}')).toBe('xy{{a}}')
    expect(r.unresolved.has('a')).toBe(true)
  })

  it('stops at self references', () => {
    const r = resolver(env(v('a', '{{a}}!')))
    expect(r.resolve('{{a}}')).toBe('{{a}}!')
  })

  it(`limits nesting depth to ${MAX_DEPTH}`, () => {
    const chain = Array.from({ length: MAX_DEPTH + 5 }, (_, i) => v(`v${i}`, `{{v${i + 1}}}`))
    const r = resolver(env(...chain, v(`v${MAX_DEPTH + 5}`, 'end')))
    expect(r.resolve('{{v0}}')).toBe(`{{v${MAX_DEPTH}}}`)
    expect(r.unresolved.size).toBe(1)
  })

  it('generates dynamic variables on every occurrence', () => {
    let n = 0
    const r = new VariableResolver(buildVariableMap([]), {
      ...fixed,
      guid: () => `g${++n}`
    })
    expect(r.resolve('{{$guid}} {{$guid}}')).toBe('g1 g2')
    expect(r.resolve('{{$timestamp}}|{{$isoTimestamp}}|{{$randomInt}}')).toBe(
      `${Math.floor(Date.parse('2026-10-02T03:04:05.678Z') / 1000)}|2026-10-02T03:04:05.678Z|500`
    )
    expect(r.unresolved.size).toBe(0)
  })

  it('generates the Phase 5 dynamic variables (decision 78)', () => {
    let n = 0
    const values = [0, 0.99, 0.2, 0.7]
    const r = new VariableResolver(buildVariableMap([]), {
      ...fixed,
      guid: () => 'uuid',
      random: () => values[n++ % values.length] as number
    })
    expect(r.resolve('{{$randomUUID}}')).toBe('uuid')
    expect(r.resolve('{{$randomString}}')).toMatch(/^[a-z0-9]{16}$/)
    expect(r.resolve('{{$randomAlphaNumeric}}')).toMatch(/^[a-z0-9]$/)
    expect(r.resolve('{{$randomEmail}}')).toMatch(/^user_[a-z0-9]{8}@example\.com$/)
    expect(['true', 'false']).toContain(r.resolve('{{$randomBoolean}}'))
    expect(r.unresolved.size).toBe(0)
  })

  it('can keep secret variables as {{name}} (code generation)', () => {
    const map = buildVariableMap([
      env(
        v('token', 's3cret', { secret: true }),
        v('auth', 'Bearer {{token}}'),
        v('host', 'a.test')
      )
    ])
    const r = new VariableResolver(map, fixed, { keepSecrets: true })
    expect(r.resolve('{{host}} {{auth}} {{token}}')).toBe('a.test Bearer {{token}} {{token}}')
    expect(r.unresolved.size).toBe(0)
    expect(new VariableResolver(map, fixed).resolve('{{auth}}')).toBe('Bearer s3cret')
  })

  it('lets user variables override dynamic names', () => {
    expect(resolver(env(v('$guid', 'mine'))).resolve('{{$guid}}')).toBe('mine')
  })

  it('ignores empty braces and text without variables', () => {
    const r = resolver()
    expect(r.resolve('{{}} {{ }} plain { {x} }')).toBe('{{}} {{ }} plain { {x} }')
    expect(r.unresolved.size).toBe(0)
  })

  it('does not re-scan substituted values for new tokens built by concatenation', () => {
    const r = resolver(env(v('open', '{{'), v('name', 'x')))
    // "{{" comes from a value, so "{{name}}" is not formed in the input itself.
    expect(r.resolve('{{open}}name}}')).toBe('{{name}}')
  })
})

describe('VariableResolver.request', () => {
  const request = httpRequestSchema.parse({
    version: 1,
    id: 'r',
    type: 'http',
    name: 'Get {{host}}',
    method: 'POST',
    url: '{{base}}/users',
    params: [
      { id: 'p1', key: '{{k}}', value: '{{v}}', enabled: true },
      { id: 'p2', key: 'off', value: '{{missingOff}}', enabled: false }
    ],
    headers: [{ id: 'h1', key: 'X-Trace', value: '{{$guid}}', enabled: true }],
    body: { mode: 'json', json: '{"token":"{{token}}"}', raw: '{{untouched}}' },
    auth: { type: 'bearer', token: '{{token}}' }
  })

  it('resolves url, params, headers, the active body mode and auth', () => {
    const r = resolver(
      env(v('base', 'https://x'), v('token', 'T', { secret: true })),
      coll(v('k', 'page'), v('v', '2'))
    )
    const out = r.request(request)
    expect(out.url).toBe('https://x/users')
    expect(out.params[0]).toMatchObject({ key: 'page', value: '2' })
    expect(out.params[1]?.value).toBe('{{missingOff}}') // disabled rows untouched
    expect(out.headers[0]?.value).toBe('00000000-0000-4000-8000-000000000000')
    expect(out.body.json).toBe('{"token":"T"}')
    expect(out.body.raw).toBe('{{untouched}}') // inactive mode
    expect(out.auth).toEqual({ type: 'bearer', token: 'T' })
    expect(out.name).toBe('Get {{host}}') // the name is not sent
    expect([...r.unresolved]).toEqual([])
  })

  it('resolves basic / apiKey auth and inherited settings', () => {
    const r = resolver(env(v('u', 'alice'), v('p', 'pw'), v('hv', 'H')))
    expect(r.auth({ type: 'basic', username: '{{u}}', password: '{{p}}' })).toEqual({
      type: 'basic',
      username: 'alice',
      password: 'pw'
    })
    expect(r.auth({ type: 'apiKey', key: 'X-{{u}}', value: '{{p}}', in: 'query' })).toEqual({
      type: 'apiKey',
      key: 'X-alice',
      value: 'pw',
      in: 'query'
    })
    const inherited = r.inherited({
      headers: [
        { id: 'i', key: 'X', value: '{{hv}}', enabled: true, sourceId: 'c', sourceName: 'C' }
      ],
      auth: { auth: { type: 'bearer', token: '{{p}}' }, sourceId: 'c', sourceName: 'C' },
      scripts: []
    })
    expect(inherited.headers[0]?.value).toBe('H')
    expect(inherited.auth?.auth).toEqual({ type: 'bearer', token: 'pw' })
  })

  it('resolves form-data text, file paths and urlencoded rows', () => {
    const r = resolver(env(v('dir', '/tmp'), v('name', 'n')))
    const form = r.request({
      ...request,
      body: {
        ...request.body,
        mode: 'formData',
        formData: [
          {
            id: 'f',
            key: '{{name}}',
            enabled: true,
            type: 'file',
            value: '',
            filePath: '{{dir}}/a.txt'
          }
        ]
      }
    })
    expect(form.body.formData[0]).toMatchObject({ key: 'n', filePath: '/tmp/a.txt' })
    const encoded = r.request({
      ...request,
      body: {
        ...request.body,
        mode: 'urlencoded',
        urlencoded: [{ id: 'u', key: 'a', value: '{{name}}', enabled: true }]
      }
    })
    expect(encoded.body.urlencoded[0]?.value).toBe('n')
  })
})

describe('findVariableTokens', () => {
  it('returns offsets and trimmed names', () => {
    expect(findVariableTokens('a{{ x }}b{{y}}{{}}')).toEqual([
      { from: 1, to: 8, name: 'x' },
      { from: 9, to: 14, name: 'y' }
    ])
  })
})

describe('maskSecret', () => {
  it('hides the value but keeps a rough length', () => {
    expect(maskSecret('')).toBe('')
    expect(maskSecret('ab')).toBe('••••')
    expect(maskSecret('x'.repeat(40))).toBe('•'.repeat(12))
  })
})

describe('applyVariableChanges', () => {
  it('updates (and enables) existing variables, adds new ones, removes unset ones', () => {
    let n = 0
    const result = applyVariableChanges(
      [
        v('token', 'old', { secret: true }),
        v('off', 'x', { enabled: false }),
        v('gone', '1'),
        v('gone', '2')
      ],
      [
        { name: 'token', value: 'new' },
        { name: 'off', value: 'y' },
        { name: 'gone', value: null },
        { name: 'added', value: 'z' }
      ],
      () => `new-${++n}`
    )
    expect(result).toEqual([
      v('token', 'new', { secret: true }),
      v('off', 'y'),
      { id: 'new-1', key: 'added', value: 'z', enabled: true, secret: false }
    ])
  })
})
