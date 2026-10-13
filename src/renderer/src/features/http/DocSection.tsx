import type { DocSection } from './script-docs'

/** One titled list of entries (call, explanation, example) in a docs window. */
export function DocSectionView({ section }: { section: DocSection }) {
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
