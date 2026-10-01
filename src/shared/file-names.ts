// eslint-disable-next-line no-control-regex -- control characters are exactly what we strip
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
/**
 * File systems limit names by bytes (APFS / NTFS / ext4: ~255), not characters —
 * a CJK character is 3 UTF-8 bytes. 200 leaves room for "-2" suffixes and ".json".
 */
export const FILE_NAME_MAX_BYTES = 200
const encoder = new TextEncoder()

function truncateToBytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text
  let result = ''
  let bytes = 0
  for (const char of text) {
    const size = encoder.encode(char).length
    if (bytes + size > maxBytes) break
    result += char
    bytes += size
  }
  return result
}

/**
 * Turns a user-supplied display name into a file/folder name that is valid on
 * macOS, Windows and Linux. Keeps Unicode (e.g. CJK), case and spaces intact.
 * Used for Workspace folders.
 */
export function sanitizeFileName(name: string, fallback = 'untitled'): string {
  let result = name
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(INVALID_CHARS, '-')
    .trim()
    // Windows does not allow trailing dots or spaces; leading dots create hidden files.
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')

  result = truncateToBytes(result, FILE_NAME_MAX_BYTES).trim()
  if (result === '' || /^-+$/.test(result)) {
    result = fallback
  }
  if (WINDOWS_RESERVED.test(result)) {
    // Windows reserves the base name regardless of extension (e.g. "nul.txt"), so suffix the base.
    result = result.replace(/^[^.]*/, (base) => `${base}_`)
  }
  return result
}

/**
 * File/folder name for Collections, folders and requests: lower-case, spaces → "-",
 * Unicode (e.g. CJK) kept. "Get Users" → "get-users", "取得使用者" → "取得使用者".
 * Lower-casing avoids collisions on case-insensitive file systems (macOS, Windows).
 */
export function slugify(name: string, fallback = 'untitled'): string {
  const slug = sanitizeFileName(name, fallback)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitizeFileName(slug, fallback)
}

/**
 * Name for a duplicated item: "Name copy", then "Name copy 2", "Name copy 3"…
 * skipping names already used by siblings (case-insensitive).
 */
export function copyName(name: string, siblingNames: Iterable<string>): string {
  const taken = new Set(Array.from(siblingNames, (n) => n.toLowerCase()))
  const base = `${name} copy`
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
