/**
 * Mock Server helpers shared by main and the renderer (decision 133). Pure.
 */
import type { MockRoute, MockWsEndpoint, WsMatchMode } from './schemas/mock'

/** A Mock Server in the sidebar list. */
export interface MockSummary {
  id: string
  name: string
  /** Unreadable file (can only be deleted). */
  error?: string
}

export interface MockStatus {
  id: string
  running: boolean
  /** Where it listens while running, e.g. http://127.0.0.1:4010. */
  url: string | null
  /** Why it could not start / stopped. */
  error: string | null
}

/** One line of a running Mock Server's log (pushed on `mock:event`). */
export interface MockLogEntry {
  mockId: string
  time: number
  kind: 'http' | 'ws-open' | 'ws-in' | 'ws-out' | 'ws-close'
  method: string
  path: string
  /** Route / endpoint that answered; null = none matched. */
  routeId: string | null
  status: number | null
  /** WebSocket message text (shortened). */
  text?: string
  remote: string
}

export type MockEvent = { status: MockStatus } | { log: MockLogEntry[] }

const segments = (path: string) => path.split('/').filter((s) => s !== '')

/** Path pattern match: `:name` = one segment, a final `*` = the rest (possibly empty). */
export function pathMatches(pattern: string, path: string): boolean {
  const p = segments(pattern.trim())
  const s = segments(path)
  for (let i = 0; i < p.length; i++) {
    const part = p[i] as string
    if (part === '*' && i === p.length - 1) return true
    const seg = s[i]
    if (seg === undefined) return false
    if (part.startsWith(':') && part.length > 1) continue
    if (part !== seg) return false
  }
  return p.length === s.length
}

/** The first enabled route for a request. */
export function findRoute(
  routes: readonly MockRoute[],
  method: string,
  path: string
): MockRoute | null {
  const upper = method.toUpperCase()
  return (
    routes.find(
      (r) =>
        r.enabled &&
        (r.method === 'ANY' || r.method === upper || (upper === 'HEAD' && r.method === 'GET')) &&
        pathMatches(r.path, path)
    ) ?? null
  )
}

export function findWsEndpoint(
  endpoints: readonly MockWsEndpoint[],
  path: string
): MockWsEndpoint | null {
  return endpoints.find((e) => e.enabled && pathMatches(e.path, path)) ?? null
}

/** Whether a WebSocket reply rule matches a received message. */
export function wsRuleMatches(mode: WsMatchMode, pattern: string, message: string): boolean {
  switch (mode) {
    case 'equals':
      return message === pattern
    case 'contains':
      return message.includes(pattern)
    case 'regex':
      try {
        return new RegExp(pattern).test(message)
      } catch {
        return false
      }
  }
}

/** The path part of a request URL as a mock route (`{{baseUrl}}/users/{{id}}` → `/users/:id`). */
export function mockPathOf(url: string): string {
  let rest = url.trim()
  // Leading `{{variable}}` (base URL) or scheme + host.
  rest = rest.replace(/^\{\{[^}]+\}\}/, '')
  rest = rest.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, '')
  if (!rest.startsWith('/') && rest !== '') {
    const slash = rest.indexOf('/')
    rest = slash < 0 ? '' : rest.slice(slash) // host without a scheme
  }
  rest = rest.replace(/[?#].*$/, '')
  rest = rest.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, ':$1')
  return rest === '' ? '/' : rest
}
