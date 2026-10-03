import { AlertTriangle, Check, Copy } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CODEGEN_LANGUAGES, generateCode, type CodegenLanguage } from '@shared/codegen'
import type { HttpResolveResult } from '@shared/ipc/api'
import type { HttpRequest } from '@shared/schemas/http-request'
import { CodeEditor } from '@renderer/components/code-editor'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { contextParentId, type RequestTab } from '@renderer/features/tabs/tab-model'
import { errorMessage, unwrap } from '@renderer/lib/ipc'
import { useEnvStore } from '@renderer/stores/env-store'
import { useTreeStore } from '@renderer/stores/tree-store'

const LANGUAGE_KEY = 'hachi.codegen.language'

function initialLanguage(): CodegenLanguage {
  const saved = localStorage.getItem(LANGUAGE_KEY)
  return CODEGEN_LANGUAGES.find((l) => l.id === saved)?.id ?? 'curl'
}

function CodeView({ tab }: { tab: RequestTab }) {
  const [language, setLanguage] = useState<CodegenLanguage>(initialLanguage)
  const [revealSecrets, setRevealSecrets] = useState(false)
  const [resolved, setResolved] = useState<HttpResolveResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const parentId = useTreeStore((s) => contextParentId(tab, s.tree))
  const environmentId = useEnvStore((s) => s.activeId)
  const request = tab.draft as HttpRequest

  useEffect(() => {
    let cancelled = false
    unwrap(window.hachi.http.resolve({ parentId, environmentId, request, revealSecrets }))
      .then((r) => {
        if (!cancelled) {
          setResolved(r)
          setError(null)
        }
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [parentId, environmentId, request, revealSecrets])

  const code = useMemo(
    () => (resolved ? generateCode(language, resolved.request) : ''),
    [resolved, language]
  )
  const editorLanguage = CODEGEN_LANGUAGES.find((l) => l.id === language)?.editorLanguage ?? 'text'

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <NativeSelect
          aria-label="語言"
          data-testid="codegen-language"
          className="h-8 w-48 text-xs"
          value={language}
          onChange={(e) => {
            const next = e.target.value as CodegenLanguage
            setLanguage(next)
            localStorage.setItem(LANGUAGE_KEY, next)
          }}
        >
          {CODEGEN_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            data-testid="codegen-reveal"
            checked={revealSecrets}
            onChange={(e) => setRevealSecrets(e.target.checked)}
          />
          顯示機密值
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="outline" disabled={code === ''} onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? '已複製' : '複製'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {resolved?.urlError && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          {resolved.urlError}（程式碼使用輸入的網址）
        </p>
      )}
      {resolved && resolved.unresolvedVariables.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          找不到的變數：{resolved.unresolvedVariables.map((n) => `{{${n}}}`).join('、')}
        </p>
      )}
      <div
        className="h-[55vh] min-h-0 overflow-hidden rounded-md border"
        data-testid="codegen-output"
      >
        <CodeEditor value={code} language={editorLanguage} readOnly className="h-full" />
      </div>
      <p className="text-xs text-muted-foreground">
        {revealSecrets
          ? '機密變數已替換成實際的值，分享程式碼前請留意。'
          : '機密變數保留為 {{名稱}}，勾選「顯示機密值」可替換成實際的值。'}
        {language === 'curl' && ' cURL 指令以 macOS / Linux 的 shell 引號規則產生。'}
      </p>
    </div>
  )
}

export function CodeDialog({
  tab,
  open,
  onOpenChange
}: {
  tab: RequestTab
  open: boolean
  onOpenChange(open: boolean): void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>產生程式碼</DialogTitle>
          <DialogDescription>
            以目前編輯中的內容（含沿用的 Headers / Auth 與目前環境的變數）產生。
          </DialogDescription>
        </DialogHeader>
        {open && tab.draft && <CodeView tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
