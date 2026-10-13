import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { SCRIPT_DOCS, type DocPhase, type DocSection } from './script-docs'

function Section({ section }: { section: DocSection }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{section.title}</h3>
      {section.note && <p className="text-xs text-muted-foreground">{section.note}</p>}
      <ul className="flex flex-col gap-3">
        {section.entries.map((entry) => (
          <li key={entry.api} className="flex flex-col gap-1" data-testid="script-doc-entry">
            <code className="font-mono text-xs font-medium break-all text-foreground">
              {entry.api}
            </code>
            <p className="text-xs text-muted-foreground">{entry.text}</p>
            <pre className="overflow-x-auto rounded-md border bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground select-text">
              {entry.example}
            </pre>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 「可用的 API」: the script API with examples, one tab per phase. */
export function ScriptDocsDialog({
  open,
  onOpenChange,
  phase
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tab shown first: the phase being edited. */
  phase: DocPhase
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl" data-testid="script-docs">
        <DialogHeader>
          <DialogTitle>腳本可用的 API</DialogTitle>
          <DialogDescription>
            JavaScript，可以直接使用 await。Pre-request 在發送前執行，Post-response
            在收到回應、擷取變數之後執行。
          </DialogDescription>
        </DialogHeader>
        {/* Mounted per opening: starts on the phase being edited. */}
        {open && <DocsTabs phase={phase} />}
      </DialogContent>
    </Dialog>
  )
}

function DocsTabs({ phase }: { phase: DocPhase }) {
  const [tab, setTab] = useState<DocPhase>(phase)
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as DocPhase)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList>
        <TabsTrigger value="preRequest">Pre-request</TabsTrigger>
        <TabsTrigger value="postResponse">Post-response</TabsTrigger>
      </TabsList>
      {(['preRequest', 'postResponse'] as const).map((p) => (
        <TabsContent key={p} value={p} className="min-h-0 flex-1 overflow-y-auto pt-3 pr-1">
          <div className="flex flex-col gap-5">
            {SCRIPT_DOCS[p].map((section) => (
              <Section key={section.title} section={section} />
            ))}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  )
}
