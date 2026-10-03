import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
  rectangularSelection,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { findVariableTokens, type VariableMap } from '@shared/variables'
import { cn } from '@renderer/lib/utils'
import { describeVariable } from '@renderer/lib/variables'

/**
 * Syntax colors as CSS variables (--code-*, styles.css), so light and dark mode each get
 * readable colors (CodeMirror's default style is made for light backgrounds only).
 */
const highlightStyle = HighlightStyle.define([
  { tag: t.meta, color: 'var(--code-meta)' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, textDecoration: 'underline', fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword],
    color: 'var(--code-keyword)'
  },
  {
    tag: [t.atom, t.bool, t.null, t.url, t.contentSeparator, t.labelName],
    color: 'var(--code-atom)'
  },
  { tag: [t.literal, t.number, t.inserted], color: 'var(--code-number)' },
  { tag: [t.string, t.deleted], color: 'var(--code-string)' },
  { tag: [t.regexp, t.escape, t.special(t.string)], color: 'var(--code-regexp)' },
  { tag: t.propertyName, color: 'var(--code-property)' },
  {
    tag: [t.definition(t.variableName), t.function(t.variableName)],
    color: 'var(--code-definition)'
  },
  { tag: [t.typeName, t.namespace, t.className, t.tagName], color: 'var(--code-type)' },
  { tag: [t.attributeName, t.special(t.variableName), t.macroName], color: 'var(--code-property)' },
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--code-invalid)' }
])

export type CodeLanguage = 'json' | 'html' | 'xml' | 'javascript' | 'python' | 'text'

function languageExtension(language: CodeLanguage): Extension {
  switch (language) {
    case 'json':
      return json()
    case 'html':
      return html()
    case 'xml':
      return xml()
    case 'javascript':
      return javascript()
    case 'python':
      return python()
    default:
      return []
  }
}

/**
 * CodeMirror's `basicSetup` without the fold / unfold keyboard shortcuts (removed
 * by decision 49; folding stays available from the gutter).
 */
const editorSetup: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(highlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...completionKeymap,
    ...lintKeymap
  ])
]

/** Colours `{{variables}}` by status and shows their value on hover. */
function variableExtension(map: VariableMap | undefined): Extension {
  if (!map) return []
  const decorator = new MatchDecorator({
    regexp: /\{\{([^{}]+)\}\}/g,
    decoration: (match) => {
      const name = (match[1] ?? '').trim()
      if (name === '') return null
      return Decoration.mark({
        class: `cm-hachi-var cm-hachi-var-${describeVariable(name, map).status}`
      })
    }
  })
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view)
      }
      update(update: ViewUpdate) {
        this.decorations = decorator.updateDeco(update, this.decorations)
      }
    },
    { decorations: (v) => v.decorations }
  )
  const tooltip = hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos)
    for (const token of findVariableTokens(line.text)) {
      const from = line.from + token.from
      const to = line.from + token.to
      if (pos < from || pos > to) continue
      return {
        pos: from,
        end: to,
        above: true,
        create: () => {
          const dom = document.createElement('div')
          dom.className = 'cm-hachi-var-tip'
          dom.textContent = `{{${token.name}}} = ${describeVariable(token.name, map).detail}`
          return { dom }
        }
      }
    }
    return null
  })
  return [plugin, tooltip]
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
  '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--card-foreground)' },
  '.cm-hachi-var-defined, .cm-hachi-var-defined *': { color: 'oklch(0.62 0.15 155) !important' },
  '.cm-hachi-var-dynamic, .cm-hachi-var-dynamic *': { color: 'oklch(0.62 0.14 240) !important' },
  '.cm-hachi-var-missing, .cm-hachi-var-missing *': { color: 'oklch(0.62 0.2 25) !important' },
  '.cm-tooltip.cm-tooltip-hover': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '6px'
  },
  '.cm-hachi-var-tip': { padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: '11px' }
})

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: CodeLanguage
  readOnly?: boolean
  /** Soft-wrap long lines (display only). */
  wrap?: boolean
  /** Highlights `{{variables}}` against this map. */
  variables?: VariableMap
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
  variables,
  className,
  ...rest
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const compartments = useRef({
    language: new Compartment(),
    wrap: new Compartment(),
    readOnly: new Compartment(),
    variables: new Compartment()
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
          editorSetup,
          theme,
          c.language.of(languageExtension(language)),
          c.wrap.of(wrap ? EditorView.lineWrapping : []),
          c.variables.of(variableExtension(variables)),
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
      effects: compartments.current.variables.reconfigure(variableExtension(variables))
    })
  }, [variables])

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
