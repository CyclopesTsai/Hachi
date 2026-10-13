import {
  DYNAMIC_VARIABLES,
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

const SECTIONS: DocSection[] = [
  {
    title: '變數',
    note: '可以用在網址、Params、Headers、Auth 與 Body。優先順序：暫存變數 > Runner 資料列 > 環境 > Collection。',
    entries: [
      {
        api: '{{名稱}}',
        text: '換成變數的值；滑鼠移到變數上可以看到來源並直接修改。變數的值裡也可以再用變數（最多 10 層）。找不到的變數照原樣送出，並列在回應上方。',
        example: '{\n  "user": "{{username}}",\n  "url": "{{baseUrl}}/callback"\n}'
      }
    ]
  },
  {
    title: '動態變數',
    note: '每次送出（每個出現的位置）都產生新的值；有同名的變數時以變數為準。',
    entries: (Object.keys(DYNAMIC_VARIABLES) as DynamicVariableName[]).map((name) => ({
      api: `{{${name}}}`,
      text: DYNAMIC_VARIABLES[name],
      example: DYNAMIC_EXAMPLES[name]
    }))
  },
  {
    title: '檔案',
    entries: [
      {
        api: '{{$file:base64:路徑}}',
        text: `送出時讀取檔案並換成 base64（例如圖片），單檔上限 ${FILE_VARIABLE_MAX_BYTES / 1024 / 1024} MB。路徑可以是絕對路徑、~ 開頭，或相對於 Workspace 資料夾（放在 Workspace 中可以跟著 git 分享）。Workspace 以外的檔案第一次送出時會詢問是否允許。程式碼產生（Code）不會放入檔案內容。`,
        example:
          '{\n  "img": "{{$file:base64:files/photo.jpg}}",\n  "avatar": "{{$file:base64:~/Pictures/me.png}}"\n}'
      }
    ]
  }
]

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
          <DialogTitle>可用的變數</DialogTitle>
          <DialogDescription>
            寫成 {'{{…}}'}，送出時才替換；編輯器中的內容不會改變。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-5">
            {SECTIONS.map((section) => (
              <DocSectionView key={section.title} section={section} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
