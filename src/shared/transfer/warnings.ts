/**
 * Collects importer / exporter warnings. The same message for many items is reported
 * once with a few examples, so a 500-request import with OAuth everywhere stays readable.
 */
const EXAMPLES = 3

export class TransferWarnings {
  private readonly byMessage = new Map<string, string[]>()

  /** `where` is a path like "Users / Get user"; empty for collection-wide messages. */
  add(message: string, where = ''): void {
    const list = this.byMessage.get(message) ?? []
    if (where !== '' && !list.includes(where)) list.push(where)
    this.byMessage.set(message, list)
  }

  list(): string[] {
    return Array.from(this.byMessage, ([message, where]) => {
      if (where.length === 0) return message
      const shown = where.slice(0, EXAMPLES).join('、')
      const more = where.length > EXAMPLES ? ` 等 ${where.length} 項` : ''
      return `${message}（${shown}${more}）`
    })
  }
}
