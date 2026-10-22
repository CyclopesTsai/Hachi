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
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { msg } from '@shared/i18n'

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
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  // Search box (search-panel.ts): a card floating at the top right, over the text.
  '.cm-panels.cm-panels-top': {
    position: 'absolute',
    top: '8px',
    right: '14px',
    left: 'auto',
    zIndex: '5',
    maxWidth: 'calc(100% - 28px)',
    backgroundColor: 'transparent',
    border: 'none !important'
  },
  '.cm-panel.cm-hachi-search': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '2px',
    width: '22rem',
    maxWidth: '100%',
    padding: '3px',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    color: 'var(--card-foreground)',
    backgroundColor: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    boxShadow: '0 6px 20px rgb(0 0 0 / 14%), 0 1px 3px rgb(0 0 0 / 8%)'
  },
  '.cm-panel.cm-hachi-search:focus-within': { borderColor: 'var(--ring)' },
  '.cm-hachi-search-rows': {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: '1',
    minWidth: '0'
  },
  '.cm-hachi-search-row': { display: 'flex', alignItems: 'center', gap: '2px', height: '28px' },
  '.cm-hachi-search-row[hidden], .cm-hachi-search-count[hidden]': { display: 'none' },
  '.cm-hachi-search-row[data-row="replace"]': { borderTop: '1px solid var(--border)' },
  '.cm-hachi-search-field': {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    flex: '1',
    minWidth: '0',
    height: '100%'
  },
  '.cm-hachi-search-field svg': {
    position: 'absolute',
    left: '8px',
    color: 'var(--muted-foreground)',
    pointerEvents: 'none'
  },
  '.cm-hachi-search-input': {
    width: '100%',
    height: '100%',
    padding: '0 6px 0 28px',
    fontSize: '12px',
    fontFamily: 'var(--font-sans)',
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none'
  },
  '.cm-hachi-search-input::placeholder': { color: 'var(--muted-foreground)', opacity: '0.8' },
  '.cm-hachi-search-count': {
    flexShrink: '0',
    padding: '0 4px',
    fontSize: '11px',
    color: 'var(--muted-foreground)',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums'
  },
  '.cm-hachi-search-divider': {
    flexShrink: '0',
    width: '1px',
    height: '16px',
    margin: '0 3px',
    backgroundColor: 'var(--border)'
  },
  '.cm-hachi-search-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
    width: '26px',
    height: '26px',
    padding: '0',
    color: 'var(--muted-foreground)',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px'
  },
  '.cm-hachi-search-icon:hover': { color: 'var(--foreground)', backgroundColor: 'var(--accent)' },
  '.cm-hachi-search-toggle svg': { transition: 'transform 120ms ease' },
  '.cm-hachi-search-expanded .cm-hachi-search-toggle svg': { transform: 'rotate(90deg)' },
  '.cm-hachi-search-text': {
    flexShrink: '0',
    height: '22px',
    margin: '0 1px',
    padding: '0 8px',
    fontSize: '11px',
    fontFamily: 'var(--font-sans)',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--input)',
    borderRadius: '6px'
  },
  '.cm-hachi-search-text:hover': { backgroundColor: 'var(--accent)' },
  '.cm-hachi-var-defined, .cm-hachi-var-defined *': { color: 'oklch(0.62 0.15 155) !important' },
  '.cm-hachi-var-dynamic, .cm-hachi-var-dynamic *': { color: 'oklch(0.62 0.14 240) !important' },
  '.cm-hachi-var-missing, .cm-hachi-var-missing *': { color: 'oklch(0.62 0.2 25) !important' },
  '.cm-tooltip.cm-tooltip-hover': {
    backgroundColor: 'var(--card)',
    color: 'var(--card-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '6px'
  }
})

/** Texts of CodeMirror's own panels (search, go to line) in the interface language. */
export function editorPhrases(): Extension {
  const phrases = msg().editor.phrases
  return phrases ? EditorState.phrases.of(phrases) : []
}
