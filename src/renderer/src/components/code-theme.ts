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
  // Search panel: Hachi's look, compact (12px) so it does not crowd the editor.
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '4px 6px',
    padding: '6px 28px 6px 8px',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px'
  },
  '.cm-panel.cm-search br': { flexBasis: '100%', height: '0', content: '""' },
  '.cm-search .cm-textfield': {
    height: '24px',
    width: '13rem',
    margin: '0',
    padding: '0 6px',
    fontSize: '12px',
    fontFamily: 'var(--font-sans)',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--input)',
    borderRadius: '6px',
    outline: 'none'
  },
  '.cm-search .cm-textfield:focus': {
    borderColor: 'var(--ring)',
    boxShadow: '0 0 0 2px color-mix(in oklch, var(--ring) 35%, transparent)'
  },
  '.cm-search .cm-button': {
    height: '24px',
    margin: '0',
    padding: '0 8px',
    fontSize: '12px',
    fontFamily: 'var(--font-sans)',
    color: 'var(--foreground)',
    backgroundImage: 'none',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--input)',
    borderRadius: '6px',
    cursor: 'default'
  },
  '.cm-search .cm-button:hover': { backgroundColor: 'var(--accent)' },
  '.cm-search .cm-button:active': { backgroundImage: 'none' },
  // "all" (select every match) is left out.
  '.cm-search .cm-button[name="select"]': { display: 'none' },
  // The match case / regexp / by word options are not offered either.
  '.cm-search label': { display: 'none' },
  '.cm-search button[name="close"]': {
    position: 'absolute',
    top: '6px',
    right: '6px',
    width: '20px',
    height: '20px',
    padding: '0',
    fontSize: '16px',
    lineHeight: '18px',
    color: 'var(--muted-foreground)',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px'
  },
  '.cm-search button[name="close"]:hover': {
    color: 'var(--foreground)',
    backgroundColor: 'var(--accent)'
  },
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

/** Texts of CodeMirror's own panels (search, go to line) in Chinese. */
export const editorPhrases = EditorState.phrases.of({
  Find: '搜尋',
  Replace: '取代',
  next: '下一個',
  previous: '上一個',
  replace: '取代',
  'replace all': '全部取代',
  close: '關閉',
  'current match': '目前的符合項目',
  'on line': '位於第',
  'replaced match on line $': '已取代第 $ 行的符合項目',
  'replaced $ matches': '已取代 $ 個符合項目',
  'Go to line': '前往行號',
  go: '前往'
})
