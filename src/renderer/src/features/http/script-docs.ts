/**
 * The 「可用的 API」 window of the Scripts tab: what the sandbox offers
 * (src/main/services/scripts/prelude.ts), per phase. The texts are in the language packs.
 */
import { msg } from '@shared/i18n'
import type { DocSection } from '@shared/i18n/zh-TW/docs'

export type { DocEntry, DocSection } from '@shared/i18n/zh-TW/docs'

export type DocPhase = 'preRequest' | 'postResponse'

export function scriptDocs(phase: DocPhase): DocSection[] {
  const s = msg().docs.script
  return phase === 'preRequest'
    ? [s.editRequest, s.variables, s.requests, s.tools, s.compat, s.limits]
    : [s.readResponse, s.testing, s.variables, s.requests, s.tools, s.compat, s.limits]
}
