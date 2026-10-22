import { describe, expect, it } from 'vitest'
import { effectiveLanguage, localeOf, messagesFor, systemLanguage } from '.'

// CJK punctuation, ideographs and full-width forms (written as escapes: U+3000 is a space).
const CJK = new RegExp('[\\u3000-\\u303f\\u4e00-\\u9fff\\uff00-\\uffef]')

/** Every leaf as `path: kind` (string / function), so both tables can be compared. */
function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'string' || typeof value === 'function') return [`${path}: ${typeof value}`]
  if (value === null || typeof value !== 'object') return [`${path}: ${String(value)}`]
  return Object.keys(value)
    .sort()
    .flatMap((key) => shape((value as Record<string, unknown>)[key], `${path}.${key}`))
}

/** The English texts with their paths (functions by their source). */
function texts(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (typeof value === 'function') return [[path, value.toString()]]
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, v]) => texts(v, `${path}.${key}`))
}

describe('message tables', () => {
  it('English has exactly the keys of Traditional Chinese', () => {
    // English keeps CodeMirror's own phrases (null), the only intended difference.
    const keys = (language: 'zh-TW' | 'en') =>
      shape(messagesFor(language)).filter((line) => !line.startsWith('.editor.phrases'))
    expect(keys('en')).toEqual(keys('zh-TW'))
  })

  it('English has no Chinese text (except the language names)', () => {
    const chinese = texts(messagesFor('en')).filter(
      ([path, text]) => !path.startsWith('.common.languageNames.') && CJK.test(text)
    )
    expect(chinese).toEqual([])
  })

  // electron-vite's ESM shim looks for the last `import "…"` in a bundle with a regex: a text
  // ending in "import" followed by the next string's quote is taken for one (build breaks).
  it('no text looks like an import statement to the bundler', () => {
    const lookAlike = /(^|[\s;])import\s*(["'`]|$)/
    for (const language of ['zh-TW', 'en'] as const) {
      const found = texts(messagesFor(language)).filter(([, text]) => lookAlike.test(text))
      expect(found).toEqual([])
    }
  })
})

describe('languages', () => {
  it('maps any Chinese system language to Traditional Chinese, the rest to English', () => {
    expect(systemLanguage(['zh-Hant-TW', 'en-US'])).toBe('zh-TW')
    expect(systemLanguage(['zh-CN'])).toBe('zh-TW')
    expect(systemLanguage(['ZH'])).toBe('zh-TW')
    expect(systemLanguage(['en-GB', 'zh-TW'])).toBe('en')
    expect(systemLanguage(['ja-JP'])).toBe('en')
    expect(systemLanguage([])).toBe('en')
  })

  it('uses the setting unless it follows the system', () => {
    expect(effectiveLanguage('system', 'en')).toBe('en')
    expect(effectiveLanguage('zh-TW', 'en')).toBe('zh-TW')
    expect(effectiveLanguage('en', 'zh-TW')).toBe('en')
    expect(localeOf('en')).toBe('en-US')
    expect(localeOf('zh-TW')).toBe('zh-TW')
  })
})
