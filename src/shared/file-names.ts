/**
 * Turns a user-supplied display name into a file/folder name that is valid on
 * macOS, Windows and Linux. Keeps Unicode (e.g. CJK) and spaces intact.
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what we strip
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
export const FILE_NAME_MAX = 100

export function sanitizeFileName(name: string, fallback = 'untitled'): string {
  let result = name
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(INVALID_CHARS, '-')
    .trim()
    // Windows does not allow trailing dots or spaces; leading dots create hidden files.
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')

  if (result.length > FILE_NAME_MAX) {
    result = Array.from(result).slice(0, FILE_NAME_MAX).join('').trim()
  }
  if (result === '' || /^-+$/.test(result)) {
    result = fallback
  }
  if (WINDOWS_RESERVED.test(result)) {
    // Windows reserves the base name regardless of extension (e.g. "nul.txt"), so suffix the base.
    result = result.replace(/^[^.]*/, (base) => `${base}_`)
  }
  return result
}
