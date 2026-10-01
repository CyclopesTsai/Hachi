import { describe, expect, it, vi } from 'vitest'
import { HachiError } from '@shared/errors'
import { INVOKE } from '@shared/ipc/channels'
import { createHandler, createSenderValidator } from './handler'

const ws = { id: '1', name: 'W', path: '/w' }

describe('createHandler', () => {
  it('passes validated input to the handler and wraps the result', async () => {
    const fn = vi.fn().mockResolvedValue(ws)
    const handle = createHandler(INVOKE.workspaceCreate, fn)
    await expect(handle({ name: '  W ', parentDir: '/docs' })).resolves.toEqual({
      ok: true,
      data: ws
    })
    // zod trims the name before the handler sees it
    expect(fn).toHaveBeenCalledWith({ name: 'W', parentDir: '/docs' })
  })

  it.each([
    ['missing fields', {}],
    ['relative path', { name: 'W', parentDir: 'docs' }],
    ['unknown keys', { name: 'W', parentDir: '/docs', extra: true }],
    ['empty name', { name: '   ', parentDir: '/docs' }],
    ['NUL byte in path', { name: 'W', parentDir: '/do\0cs' }],
    ['wrong type', 'oops']
  ])('rejects %s without calling the handler', async (_label, input) => {
    const fn = vi.fn()
    const result = await createHandler(INVOKE.workspaceCreate, fn)(input)
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(fn).not.toHaveBeenCalled()
  })

  it('accepts Windows absolute paths', async () => {
    const handle = createHandler(INVOKE.workspaceOpen, () => ws)
    await expect(handle({ path: 'C:\\Users\\me\\Hachi' })).resolves.toMatchObject({ ok: true })
  })

  it('rejects input for channels that take none', async () => {
    const handle = createHandler(INVOKE.configGet, () => {
      throw new Error('should not run')
    })
    await expect(handle({ sneaky: 1 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' }
    })
  })

  it('forwards HachiError codes', async () => {
    const handle = createHandler(INVOKE.workspaceOpen, () => {
      throw new HachiError('NOT_A_WORKSPACE', 'nope')
    })
    await expect(handle({ path: '/x' })).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_A_WORKSPACE', message: 'nope' }
    })
  })

  it('hides unexpected error details behind INTERNAL', async () => {
    const log = vi.fn()
    const handle = createHandler(
      INVOKE.workspaceOpen,
      () => {
        throw new Error('secret stack info')
      },
      log
    )
    const result = await handle({ path: '/x' })
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(log).toHaveBeenCalledOnce()
  })
})

describe('createSenderValidator', () => {
  it('accepts the dev server origin only', () => {
    const isTrusted = createSenderValidator('http://localhost:5173/')
    expect(isTrusted('http://localhost:5173/index.html#/x')).toBe(true)
    expect(isTrusted('http://localhost:5174/')).toBe(false)
    expect(isTrusted('https://evil.example/')).toBe(false)
    expect(isTrusted(undefined)).toBe(false)
    expect(isTrusted('not a url')).toBe(false)
  })

  it('accepts only the bundled index.html in production', () => {
    const isTrusted = createSenderValidator(
      'file:///Applications/Hachi.app/out/renderer/index.html'
    )
    expect(isTrusted('file:///Applications/Hachi.app/out/renderer/index.html')).toBe(true)
    expect(isTrusted('file:///Applications/Hachi.app/out/renderer/index.html?x=1')).toBe(true)
    expect(isTrusted('file:///tmp/evil.html')).toBe(false)
    expect(isTrusted('http://localhost:5173/')).toBe(false)
  })
})
