/**
 * Interface languages (issue #6): Traditional Chinese and English. Every text shown to the
 * user comes from the message tables here; `zh-TW` is the source and `en` must have exactly
 * the same shape (the type checker reports a missing or extra key).
 *
 * Each process (main, renderer, the script process) keeps its current language with
 * `setLanguage`; code reads texts with `msg()`. Texts that take values are functions.
 */
import { en } from './en'
import { zhTW, type Messages } from './zh-TW'

export type { Messages } from './zh-TW'

export const LANGUAGES = ['zh-TW', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
/** The App setting: follow the system, or one language. */
export type LanguageSetting = 'system' | Language

const TABLES: Record<Language, Messages> = { 'zh-TW': zhTW, en }

let current: Language = 'zh-TW'

export function setLanguage(language: Language): void {
  current = language
}

export function getLanguage(): Language {
  return current
}

/** The messages of the current language. */
export function msg(): Messages {
  return TABLES[current]
}

export function messagesFor(language: Language): Messages {
  return TABLES[language]
}

/** Any Chinese system language gets Traditional Chinese; everything else English. */
export function systemLanguage(preferred: readonly string[]): Language {
  return preferred[0]?.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

export function effectiveLanguage(setting: LanguageSetting, system: Language): Language {
  return setting === 'system' ? system : setting
}

/** BCP 47 tag for `Intl` (dates, numbers) and `<html lang>`. */
export function localeOf(language: Language = current): string {
  return language === 'zh-TW' ? 'zh-TW' : 'en-US'
}
