import { readdir } from 'node:fs/promises'

/**
 * `base + ext`, or `base-2 + ext`, `base-3 + ext`… — whichever is free in `dir`
 * (case-insensitive). `keep` is the item's own current name, which counts as free;
 * `reserved` names are never returned.
 */
export async function uniqueFileName(
  dir: string,
  base: string,
  ext: string,
  options: { keep?: string; reserved?: readonly string[] } = {}
): Promise<string> {
  const taken = new Set(
    (await readdir(dir).catch(() => [] as string[]))
      .filter((n) => n !== options.keep)
      .map((n) => n.toLowerCase())
  )
  for (const name of options.reserved ?? []) taken.add(name.toLowerCase())
  for (let i = 1; ; i++) {
    const candidate = `${i === 1 ? base : `${base}-${i}`}${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
