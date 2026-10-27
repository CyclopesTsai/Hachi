/**
 * Client certificates (mTLS, decision 147): reading the files, and telling why a server
 * refused the connection.
 */
import net from 'node:net'
import tls from 'node:tls'
import { clientCertFiles, clientCertHostLabel, matchClientCertificate } from '@shared/client-certs'
import type { ResponseClientCert } from '@shared/http'
import { msg } from '@shared/i18n'
import type { ClientCertificate } from '@shared/schemas/app-config'
import { DIAGNOSIS_TIMEOUT_MS, tunnel, type Route } from './tls-diagnosis'

/** What tls.connect needs to present the certificate. */
export interface ClientCertTls {
  cert?: Buffer
  key?: Buffer
  pfx?: Buffer
  passphrase?: string
}

/** A certificate file that cannot be used (missing, wrong passphrase, not a certificate…). */
export class ClientCertError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClientCertError'
  }
}

/** The entry a connection used, as the response bar shows it. */
export type ClientCertUse = ResponseClientCert

export const certUse = (entry: ClientCertificate): ClientCertUse => ({
  host: clientCertHostLabel(entry),
  files: clientCertFiles(entry)
})

type ReadFile = (path: string) => Promise<Buffer>

function loadError(entry: ClientCertificate, error: unknown): ClientCertError {
  const m = msg().httpMain.clientCert
  const host = clientCertHostLabel(entry)
  const e = error as { code?: unknown; message?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  const text = typeof e.message === 'string' ? e.message : String(error)
  if (/INCORRECT_PASSWORD|BAD_DECRYPT|mac verify failure/i.test(`${code} ${text}`)) {
    return new ClientCertError(m.wrongPassphrase(host))
  }
  if (/KEY_VALUES_MISMATCH/i.test(`${code} ${text}`))
    return new ClientCertError(m.keyMismatch(host))
  return new ClientCertError(m.badFile(host, text.split('\n')[0] ?? text))
}

async function readCertFile(entry: ClientCertificate, file: string, read: ReadFile) {
  const m = msg().httpMain.clientCert
  const host = clientCertHostLabel(entry)
  if (file.trim() === '') throw new ClientCertError(m.noFile(host))
  try {
    return await read(file)
  } catch (error) {
    const code = (error as { code?: unknown }).code
    throw new ClientCertError(
      code === 'ENOENT' ? m.notFound(host, file) : m.cannotRead(host, file, String(error))
    )
  }
}

/** Reads an entry's files and checks they work together. Throws ClientCertError. */
export async function loadClientCertificate(
  entry: ClientCertificate,
  read: ReadFile
): Promise<ClientCertTls> {
  const passphrase = entry.passphrase === '' ? {} : { passphrase: entry.passphrase }
  const options: ClientCertTls =
    entry.type === 'pfx'
      ? { pfx: await readCertFile(entry, entry.pfxPath, read), ...passphrase }
      : {
          cert: await readCertFile(entry, entry.certPath, read),
          key: await readCertFile(entry, entry.keyPath, read),
          ...passphrase
        }
  try {
    // Parses the files, decrypts the key and checks it belongs to the certificate.
    tls.createSecureContext(options)
  } catch (error) {
    throw loadError(entry, error)
  }
  return options
}

export interface ClientCertMatch {
  entry: ClientCertificate
  tls: ClientCertTls | null
  error: ClientCertError | null
}

/**
 * The enabled entries of one send, files already read (a redirect may lead to any host,
 * and connections pick their certificate synchronously). A broken entry only fails the
 * connections it matches.
 */
export class ClientCertSet {
  private constructor(private readonly loaded: Map<ClientCertificate, ClientCertMatch>) {}

  static async load(list: readonly ClientCertificate[], read: ReadFile): Promise<ClientCertSet> {
    const enabled = list.filter((e) => e.enabled)
    const results = await Promise.all(
      enabled.map(async (entry): Promise<ClientCertMatch> => {
        try {
          return { entry, tls: await loadClientCertificate(entry, read), error: null }
        } catch (error) {
          if (!(error instanceof ClientCertError)) throw error
          return { entry, tls: null, error }
        }
      })
    )
    return new ClientCertSet(new Map(results.map((r) => [r.entry, r])))
  }

  static readonly empty = new ClientCertSet(new Map())

  match(hostname: string, port: number): ClientCertMatch | null {
    const entry = matchClientCertificate([...this.loaded.keys()], hostname, port)
    return entry ? (this.loaded.get(entry) ?? null) : null
  }
}

/** Why a server ended the TLS connection, from its alert; null when it says nothing about certificates. */
export type ClientCertVerdict = 'required' | 'likelyRequired' | 'rejected' | 'likelyRejected'

const REJECTED_ALERTS =
  /ALERT_(BAD_CERTIFICATE|UNSUPPORTED_CERTIFICATE|CERTIFICATE_REVOKED|CERTIFICATE_EXPIRED|CERTIFICATE_UNKNOWN|UNKNOWN_CA|ACCESS_DENIED|DECRYPT_ERROR)$/

/** From an OpenSSL / BoringSSL error code of a failed connection. */
export function verdictFromCode(code: string, sent: boolean): ClientCertVerdict | null {
  if (/ALERT_CERTIFICATE_REQUIRED$/.test(code)) return sent ? 'rejected' : 'required'
  if (REJECTED_ALERTS.test(code)) return sent ? 'rejected' : 'required'
  // Also sent for unrelated reasons (no common cipher…): "likely".
  if (/ALERT_HANDSHAKE_FAILURE$/.test(code)) return sent ? 'likelyRejected' : 'likelyRequired'
  return null
}

/** The message for a verdict; `use` is the entry that was sent (null: none). */
export function verdictMessage(
  verdict: ClientCertVerdict,
  use: ClientCertUse | null,
  host: string
): string {
  const m = msg().httpMain.clientCert
  switch (verdict) {
    case 'required':
      return m.required(host)
    case 'likelyRequired':
      return m.likelyRequired(host)
    case 'rejected':
      return m.rejected(use?.host ?? host, use?.files ?? '')
    case 'likelyRejected':
      return m.likelyRejected(use?.host ?? host, use?.files ?? '')
  }
}

/** After the handshake, how long to wait for the server to refuse the certificate. */
const REFUSAL_WAIT_MS = 1500

/**
 * After a failed request: connects again (with the same certificate, or none) and
 * watches whether the server ends the connection over the client certificate. TLS 1.3
 * servers refuse after the handshake, which undici only reports as "other side closed".
 */
export async function probeClientCert(
  host: string,
  port: number,
  route: Route
): Promise<ClientCertVerdict | null> {
  const sent = !!route.clientCert
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DIAGNOSIS_TIMEOUT_MS)
  try {
    const raw = await tunnel(host, port, route, controller.signal)
    return await new Promise<ClientCertVerdict | null>((resolve) => {
      let connected = false
      let socket: tls.TLSSocket | null = null
      const done = (verdict: ClientCertVerdict | null) => {
        socket?.destroy()
        raw.destroy()
        resolve(verdict)
      }
      // Ended by the server right after the handshake, without a word.
      const ended = () => done(connected ? (sent ? 'likelyRejected' : 'likelyRequired') : null)
      try {
        socket = tls.connect({
          ...route.clientCert,
          socket: raw,
          servername: net.isIP(host) ? undefined : host,
          rejectUnauthorized: false
        })
      } catch {
        done(null)
        return
      }
      socket.once('secureConnect', () => {
        connected = true
        setTimeout(() => done(null), REFUSAL_WAIT_MS)
      })
      socket.once('error', (error) => {
        const code = (error as { code?: unknown }).code
        const verdict = typeof code === 'string' ? verdictFromCode(code, sent) : null
        if (verdict) done(verdict)
        else if (code === 'ECONNRESET') ended()
        else done(null)
      })
      socket.once('end', ended)
      controller.signal.addEventListener('abort', () => done(null))
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
