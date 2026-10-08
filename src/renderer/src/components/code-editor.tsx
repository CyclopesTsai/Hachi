import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
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
import { editorTheme, highlightStyle, languageExtension, type CodeLanguage } from './code-theme'

export type { CodeLanguage } from './code-theme'
import { findVariableTokens, type VariableMap } from '@shared/variables'
import { cn } from '@renderer/lib/utils'
import { describeVariable } from '@renderer/lib/variables'

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

/**
 * Read-only keeps the editor focusable (contents can't change): selecting with the mouse,
 * ⌘A / Ctrl+A, copying and ⌘F / Ctrl+F search work in the response viewer too.
 */
const readOnlyExtension = (readOnly: boolean) => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(true)
]

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
          editorTheme,
          c.language.of(languageExtension(language)),
          c.wrap.of(wrap ? EditorView.lineWrapping : []),
          c.variables.of(variableExtension(variables)),
          c.readOnly.of(readOnlyExtension(readOnly)),
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
      effects: compartments.current.readOnly.reconfigure(readOnlyExtension(readOnly))
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
