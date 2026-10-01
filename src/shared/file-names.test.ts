import { describe, expect, it } from 'vitest'
import { FILE_NAME_MAX_BYTES, copyName, sanitizeFileName, slugify } from './file-names'

describe('sanitizeFileName', () => {
  it.each([
    ['My API', 'My API'],
    ['  spaced   out  ', 'spaced out'],
    ['使用者 API', '使用者 API'],
    ['a/b\\c:d*e?f"g<h>i|j', 'a-b-c-d-e-f-g-h-i-j'],
    ['trailing dots...', 'trailing dots'],
    ['.hidden', 'hidden'],
    ['CON', 'CON_'],
    ['nul.txt', 'nul_.txt'],
    ['', 'untitled'],
    ['///', 'untitled'],
    ['tab\tnew\nline', 'tab new line']
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected)
  })

  it('limits the UTF-8 byte length without splitting characters', () => {
    const bytes = (t: string) => new TextEncoder().encode(t).length
    const emoji = sanitizeFileName('😀'.repeat(100))
    expect(bytes(emoji)).toBeLessThanOrEqual(FILE_NAME_MAX_BYTES)
    expect(emoji).toBe('😀'.repeat(FILE_NAME_MAX_BYTES / 4))
    const cjk = sanitizeFileName('測'.repeat(100))
    expect(bytes(cjk)).toBeLessThanOrEqual(FILE_NAME_MAX_BYTES)
    expect(cjk).toBe('測'.repeat(Math.floor(FILE_NAME_MAX_BYTES / 3)))
  })

  it('uses the given fallback', () => {
    expect(sanitizeFileName('', 'request')).toBe('request')
  })
})

describe('slugify', () => {
  it.each([
    ['Get Users', 'get-users'],
    ['取得使用者', '取得使用者'],
    ['即時 通知', '即時-通知'],
    ['  Many   Spaces  ', 'many-spaces'],
    ['a/b: 測試?', 'a-b-測試'],
    ['--Dashes--', 'dashes'],
    ['CON', 'con_'],
    ['..', 'untitled'],
    ['', 'untitled']
  ])('%j → %j', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })
})

describe('copyName', () => {
  it('appends "copy", then numbers, skipping names in use', () => {
    expect(copyName('Login', ['Login'])).toBe('Login copy')
    expect(copyName('Login', ['Login', 'Login copy'])).toBe('Login copy 2')
    expect(copyName('Login', ['login COPY', 'Login copy 2'])).toBe('Login copy 3')
  })
})
