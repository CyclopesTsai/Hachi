import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import { cn } from '@renderer/lib/utils'

export type CodeLanguage = 'json' | 'html' | 'xml' | 'text'

function languageExtension(language: CodeLanguage): Extension {
  switch (language) {
    case 'json':
      return json()
    case 'html':
      return html()
    case 'xml':
      return xml()
    default:
      return []
  }
}

/** Colors come from the app's CSS variables, so light / dark mode just works. */
const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)'
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)'
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--accent) 60%, transparent)'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 30%, transparent) !important'
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--muted)',
    border: 'none',
    color: 'var(--muted-foreground)'
  },
  '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--card-foreground)' }
})

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: CodeLanguage
  readOnly?: boolean
  /** Soft-wrap long lines (display only). */
  wrap?: boolean
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}

/** CodeMirror 6 editor (syntax highlighting, folding, search). */
export function CodeEditor({
  value,
  onChange,
  language = 'text',
  readOnly = false,
  wrap = false,
  className,
  ...rest
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const compartments = useRef({
    language: new Compartment(),
    wrap: new Compartment(),
    readOnly: new Compartment()
  })

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Create once; later prop changes are applied through compartments / transactions.
  useEffect(() => {
    const c = compartments.current
    const editor = new EditorView({
      parent: host.current as HTMLDivElement,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          theme,
          c.language.of(languageExtension(language)),
          c.wrap.of(wrap ? EditorView.lineWrapping : []),
          c.readOnly.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString())
          }),
          EditorView.contentAttributes.of({ 'aria-label': rest['aria-label'] ?? 'Editor' })
        ]
      })
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once, updated below
  }, [])

  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.language.reconfigure(languageExtension(language))
    })
  }, [language])

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : [])
    })
  }, [wrap])

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.readOnly.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly)
      ])
    })
  }, [readOnly])

  return (
    <div
      ref={host}
      data-testid={rest['data-testid']}
      className={cn('min-h-0 overflow-hidden rounded-md border select-text', className)}
    />
  )
}
