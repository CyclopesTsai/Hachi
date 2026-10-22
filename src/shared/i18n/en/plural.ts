/** "1 file", "2 files": a count (a number, or one already formatted) with its noun in the right number. */
export const plural = (n: number | string, one: string, many = `${one}s`): string =>
  `${n} ${String(n) === '1' ? one : many}`
