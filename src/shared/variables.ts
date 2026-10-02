/**
 * `{{variable}}` substitution. Pure: used by main when sending (resolution) and by
 * the renderer for highlighting. See docs/schema.md ("變數替換").
 *
 * - Layers are given highest precedence first (Environment, then Collection).
 * - Disabled variables and variables with an empty name are ignored.
 * - A value may reference other variables; references are followed up to
 *   MAX_DEPTH levels and cycles are left unreplaced.
 * - Unknown names are left as `{{name}}` and reported in `unresolved`.
 * - Dynamic variables (DYNAMIC_VARIABLES, e.g. `{{$guid}}`) are generated on every
 *   occurrence, unless a user variable with the same name exists.
 */
import type { InheritedSettings } from './http'
import type { Auth, KeyValue, Variable } from './schemas/collection'
import type { HttpRequest } from './schemas/http-request'

export const VARIABLE_PATTERN = /\{\{([^{}]+)\}\}/g
export const MAX_DEPTH = 10

export const DYNAMIC_VARIABLES = {
  $guid: 'UUID v4',
  $timestamp: '目前的 Unix 時間（秒）',
  $isoTimestamp: '目前的 ISO 8601 時間',
  $randomInt: '0–1000 的隨機整數',
  $randomUUID: 'UUID v4（同 $guid）',
  $randomString: '16 個隨機英數字',
  $randomAlphaNumeric: '1 個隨機英數字',
  $randomEmail: '隨機的 Email 地址（example.com）',
  $randomBoolean: 'true 或 false'
} as const
export type DynamicVariableName = keyof typeof DYNAMIC_VARIABLES

export function isDynamicVariable(name: string): name is DynamicVariableName {
  return Object.hasOwn(DYNAMIC_VARIABLES, name)
}

export type VariableSource = 'environment' | 'collection'

export interface VariableLayer {
  source: VariableSource
  /** Environment or Collection name, for display. */
  sourceName: string
  variables: readonly Variable[]
}

export interface ResolvedVariable {
  name: string
  value: string
  secret: boolean
  source: VariableSource
  sourceName: string
}

export type VariableMap = ReadonlyMap<string, ResolvedVariable>

/** Merges layers into one lookup table; earlier layers win. */
export function buildVariableMap(layers: readonly VariableLayer[]): VariableMap {
  const map = new Map<string, ResolvedVariable>()
  for (const layer of layers) {
    for (const v of layer.variables) {
      const name = v.key.trim()
      if (!v.enabled || name === '' || map.has(name)) continue
      map.set(name, {
        name,
        value: v.value,
        secret: v.secret,
        source: layer.source,
        sourceName: layer.sourceName
      })
    }
  }
  return map
}

export interface DynamicValues {
  guid(): string
  now(): Date
  random(): number
}

const systemDynamic: DynamicValues = {
  guid: () => globalThis.crypto.randomUUID(),
  now: () => new Date(),
  random: () => Math.random()
}

const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomChars(count: number, d: DynamicValues): string {
  let text = ''
  for (let i = 0; i < count; i++) {
    text += ALPHANUMERIC[Math.floor(d.random() * ALPHANUMERIC.length)] ?? 'a'
  }
  return text
}

function dynamicValue(name: DynamicVariableName, d: DynamicValues): string {
  switch (name) {
    case '$guid':
    case '$randomUUID':
      return d.guid()
    case '$timestamp':
      return String(Math.floor(d.now().getTime() / 1000))
    case '$isoTimestamp':
      return d.now().toISOString()
    case '$randomInt':
      return String(Math.floor(d.random() * 1001))
    case '$randomString':
      return randomChars(16, d)
    case '$randomAlphaNumeric':
      return randomChars(1, d)
    case '$randomEmail':
      return `user_${randomChars(8, d)}@example.com`
    case '$randomBoolean':
      return d.random() < 0.5 ? 'true' : 'false'
  }
}

export interface VariableToken {
  /** Offsets of `{{` and just after `}}`. */
  from: number
  to: number
  name: string
}

/** Every `{{name}}` in a string (for highlighting). */
export function findVariableTokens(text: string): VariableToken[] {
  const tokens: VariableToken[] = []
  for (const m of text.matchAll(VARIABLE_PATTERN)) {
    const name = (m[1] ?? '').trim()
    if (name !== '') tokens.push({ from: m.index, to: m.index + m[0].length, name })
  }
  return tokens
}

export interface ResolverOptions {
  /** Leave `{{name}}` of secret variables in place (e.g. generated code). Not "unresolved". */
  keepSecrets?: boolean
}

/** Resolves strings against a variable map, collecting the names it could not resolve. */
export class VariableResolver {
  readonly unresolved = new Set<string>()

  constructor(
    private readonly map: VariableMap,
    private readonly dynamic: DynamicValues = systemDynamic,
    private readonly options: ResolverOptions = {}
  ) {}

  resolve(text: string): string {
    return this.expand(text, [])
  }

  private expand(text: string, stack: string[]): string {
    if (!text.includes('{{')) return text
    return text.replace(VARIABLE_PATTERN, (whole, inner: string) => {
      const name = inner.trim()
      if (name === '') return whole
      const variable = this.map.get(name)
      if (variable) {
        if (variable.secret && this.options.keepSecrets) return whole
        if (stack.includes(name) || stack.length >= MAX_DEPTH) {
          this.unresolved.add(name)
          return whole
        }
        return this.expand(variable.value, [...stack, name])
      }
      if (isDynamicVariable(name)) return dynamicValue(name, this.dynamic)
      this.unresolved.add(name)
      return whole
    })
  }

  /** Resolves keys and values of key / value rows (disabled rows are left alone). */
  rows<T extends KeyValue>(rows: readonly T[]): T[] {
    return rows.map((row) =>
      row.enabled ? { ...row, key: this.resolve(row.key), value: this.resolve(row.value) } : row
    )
  }

  auth(auth: Auth): Auth {
    switch (auth.type) {
      case 'bearer':
        return { ...auth, token: this.resolve(auth.token) }
      case 'basic':
        return {
          ...auth,
          username: this.resolve(auth.username),
          password: this.resolve(auth.password)
        }
      case 'apiKey':
        return { ...auth, key: this.resolve(auth.key), value: this.resolve(auth.value) }
      default:
        return auth
    }
  }

  /** Every field that goes on the wire: URL, params, headers, body, auth. */
  request(request: HttpRequest): HttpRequest {
    const body = request.body
    return {
      ...request,
      url: this.resolve(request.url),
      params: this.rows(request.params),
      headers: this.rows(request.headers),
      auth: this.auth(request.auth),
      body: {
        ...body,
        // Only the active mode is sent, so only its content is resolved.
        json: body.mode === 'json' ? this.resolve(body.json) : body.json,
        raw: body.mode === 'raw' ? this.resolve(body.raw) : body.raw,
        rawContentType:
          body.mode === 'raw' ? this.resolve(body.rawContentType) : body.rawContentType,
        urlencoded: body.mode === 'urlencoded' ? this.rows(body.urlencoded) : body.urlencoded,
        formData:
          body.mode === 'formData'
            ? body.formData.map((f) =>
                f.enabled
                  ? {
                      ...f,
                      key: this.resolve(f.key),
                      value: this.resolve(f.value),
                      filePath: this.resolve(f.filePath)
                    }
                  : f
              )
            : body.formData
      }
    }
  }

  /** Headers / auth inherited from folders and the collection. */
  inherited(inherited: InheritedSettings): InheritedSettings {
    return {
      headers: this.rows(inherited.headers),
      auth: inherited.auth ? { ...inherited.auth, auth: this.auth(inherited.auth.auth) } : null
    }
  }
}

/** Masks a secret value for display. */
export function maskSecret(value: string): string {
  return value === '' ? '' : '•'.repeat(Math.min(Math.max(value.length, 4), 12))
}
