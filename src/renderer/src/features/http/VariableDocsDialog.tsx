import {
  DYNAMIC_VARIABLES,
  dynamicVariableDescription,
  FILE_VARIABLE_MAX_BYTES,
  type DynamicVariableName
} from '@shared/variables'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { DocSectionView } from './DocSection'
import type { DocSection } from './script-docs'
import { msg } from '@shared/i18n'

/** What each dynamic variable looks like when sent. */
const DYNAMIC_EXAMPLES: Record<DynamicVariableName, string> = {
  $guid: '"id": "{{$guid}}"  →  "id": "3b2f…-…"',
  $timestamp: '"ts": {{$timestamp}}  →  "ts": 1791234567',
  $isoTimestamp: '"at": "{{$isoTimestamp}}"  →  "at": "2026-10-13T08:30:00.000Z"',
  $randomInt: '"n": {{$randomInt}}  →  "n": 527',
  $randomUUID: '"id": "{{$randomUUID}}"',
  $randomString: '"code": "{{$randomString}}"  →  "code": "k3x9…"',
  $randomAlphaNumeric: '"c": "{{$randomAlphaNumeric}}"  →  "c": "q"',
  $randomEmail: '"email": "{{$randomEmail}}"  →  "email": "user_a1b2c3d4@example.com"',
  $randomBoolean: '"ok": {{$randomBoolean}}  →  "ok": true'
}

function sections(): DocSection[] {
  const d = msg().docs
  return [
    {
      title: d.variables.title,
      note: d.variables.note,
      entries: [
        {
          api: d.variables.api,
          text: d.variables.text,
          example: '{\n  "user": "{{username}}",\n  "url": "{{baseUrl}}/callback"\n}'
        }
      ]
    },
    {
      title: d.dynamic.title,
      note: d.dynamic.note,
      entries: (Object.keys(DYNAMIC_VARIABLES) as DynamicVariableName[]).map((name) => ({
        api: `{{${name}}}`,
        text: dynamicVariableDescription(name),
        example: DYNAMIC_EXAMPLES[name]
      }))
    },
    {
      title: d.file.title,
      entries: [
        {
          api: d.file.api,
          text: d.file.text(FILE_VARIABLE_MAX_BYTES / 1024 / 1024),
          example:
            '{\n  "img": "{{$file:base64:files/photo.jpg}}",\n  "avatar": "{{$file:base64:~/Pictures/me.png}}"\n}'
        }
      ]
    }
  ]
}

/** 「可用的變數」 of the Body tab: variables, dynamic variables and {{$file:…}}. */
export function VariableDocsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-3xl"
        data-testid="variable-docs"
      >
        <DialogHeader>
          <DialogTitle>{msg().docs.variablesTitle}</DialogTitle>
          <DialogDescription>{msg().docs.variablesDescription}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-5">
            {sections().map((section) => (
              <DocSectionView key={section.title} section={section} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
