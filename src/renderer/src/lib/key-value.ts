import type { KeyValue } from '@shared/schemas/collection'

/** A new enabled key / value row with a fresh id. */
export function newKeyValue(patch: Partial<KeyValue> = {}): KeyValue {
  return { id: crypto.randomUUID(), key: '', value: '', enabled: true, ...patch }
}
