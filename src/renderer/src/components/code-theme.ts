/**
 * CodeMirror theme and syntax colors shared by the code editor and the Git diff view;
 * colors come from the app's CSS variables (styles.css).
 */
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'
import { HighlightStyle } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/**
 * Syntax colors as CSS variables (--code-*, styles.css), so light and dark mode each get
 * readable colors (CodeMirror's default style is made for light backgrounds only).
 */
export const highlightStyle = HighlightStyle.define([
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

export function languageExtension(language: CodeLanguage): Extension {
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

/** Colors come from the app's CSS variables, so light / dark mode just works. */
export const editorTheme = EditorView.theme({
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
