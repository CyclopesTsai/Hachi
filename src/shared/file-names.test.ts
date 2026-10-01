import { describe, expect, it } from 'vitest'
import { FILE_NAME_MAX, sanitizeFileName } from './file-names'

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

  it('limits length without splitting surrogate pairs', () => {
    const result = sanitizeFileName('😀'.repeat(FILE_NAME_MAX + 10))
    expect(Array.from(result)).toHaveLength(FILE_NAME_MAX)
    expect(result).not.toMatch(/�/)
  })

  it('uses the given fallback', () => {
    expect(sanitizeFileName('', 'request')).toBe('request')
  })
})
