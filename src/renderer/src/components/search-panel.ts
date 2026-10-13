/**
 * The editor's search box (replaces CodeMirror's own panel): a card floating at the
 * editor's top right, like Claude / VS Code. One row: magnifier + field, "3/12", ↑ ↓ and
 * close. Editable editors get a chevron at the start that opens a second row with the
 * replace field, 取代 and 全部取代 (collapsed at first). Typing jumps to the nearest match.
 */
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search'
import { EditorSelection, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view'

/** Matches counted for "3/12"; beyond it the count shows "1000+" (10 MB responses). */
export const SEARCH_COUNT_MAX = 1000

const SVG = 'http://www.w3.org/2000/svg'

/** A lucide icon (24×24 viewBox, stroked) drawn at 14px. */
function icon(...shapes: [string, Record<string, string>][]): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    width: '14',
    height: '14',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  })) {
    svg.setAttribute(k, v)
  }
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v)
    svg.append(shape)
  }
  return svg
}

const chevron = () => icon(['path', { d: 'm9 18 6-6-6-6' }])
const magnifier = () =>
  icon(['circle', { cx: '11', cy: '11', r: '8' }], ['path', { d: 'm21 21-4.3-4.3' }])
const arrowUp = () => icon(['path', { d: 'm5 12 7-7 7 7' }], ['path', { d: 'M12 19V5' }])
const arrowDown = () => icon(['path', { d: 'M12 5v14' }], ['path', { d: 'm19 12-7 7-7-7' }])
const cross = () => icon(['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }])

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string>,
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) node.setAttribute(k, v)
  node.append(...children)
  return node
}

/** "3/12" when the selection is a match, "12 筆" otherwise; null without a query. */
export function matchCount(state: EditorState, query: SearchQuery): string | null {
  if (!query.search || !query.valid) return null
  const sel = state.selection.main
  let total = 0
  let current = 0
  const cursor = query.getCursor(state)
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total++
    if (r.value.from === sel.from && r.value.to === sel.to) current = total
    if (total >= SEARCH_COUNT_MAX) return current ? `${current}/${total}+` : `${total}+ 筆`
  }
  if (total === 0) return '沒有結果'
  return current ? `${current}/${total}` : `${total} 筆`
}

/** Selects the first match at or after the selection (wrapping), as the user types. */
function jumpToNearest(view: EditorView, query: SearchQuery): void {
  if (!query.search || !query.valid) return
  const from = view.state.selection.main.from
  let first: { from: number; to: number } | null = null
  const cursor = query.getCursor(view.state)
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    first ??= r.value
    if (r.value.from >= from) {
      first = r.value
      break
    }
  }
  if (!first) return
  view.dispatch({
    selection: EditorSelection.single(first.from, first.to),
    effects: EditorView.scrollIntoView(first.from, { y: 'nearest', yMargin: 48 }),
    userEvent: 'select.search'
  })
}

function createPanel(view: EditorView): Panel {
  const editable = !view.state.readOnly
  const query = getSearchQuery(view.state)
  const searchField = el('input', {
    class: 'cm-hachi-search-input',
    name: 'search',
    placeholder: '搜尋',
    'aria-label': '搜尋',
    'main-field': 'true',
    autocomplete: 'off',
    spellcheck: 'false'
  })
  searchField.value = query.search
  const replaceField = el('input', {
    class: 'cm-hachi-search-input',
    name: 'replace',
    placeholder: '取代',
    'aria-label': '取代',
    autocomplete: 'off',
    spellcheck: 'false'
  })
  replaceField.value = query.replace
  const count = el('span', { class: 'cm-hachi-search-count', 'aria-live': 'polite' })

  const showCount = () => {
    const text = matchCount(view.state, getSearchQuery(view.state))
    count.textContent = text ?? ''
    count.hidden = text === null
  }

  const commit = (jump: boolean) => {
    const current = getSearchQuery(view.state)
    const next = new SearchQuery({
      search: searchField.value,
      replace: replaceField.value,
      caseSensitive: current.caseSensitive,
      regexp: current.regexp,
      wholeWord: current.wholeWord
    })
    if (!next.eq(current)) view.dispatch({ effects: setSearchQuery.of(next) })
    if (jump) jumpToNearest(view, next)
    showCount()
  }
  searchField.addEventListener('input', () => commit(true))
  replaceField.addEventListener('input', () => commit(false))

  const iconButton = (name: string, label: string, svg: SVGSVGElement, run: () => void) => {
    const b = el('button', {
      class: 'cm-hachi-search-icon',
      name,
      type: 'button',
      'aria-label': label,
      title: label
    })
    b.append(svg)
    b.addEventListener('click', run)
    return b
  }
  const textButton = (name: string, label: string, run: () => void) => {
    const b = el('button', { class: 'cm-hachi-search-text', name, type: 'button' }, [label])
    b.addEventListener('click', run)
    return b
  }

  const replaceRow = el('div', { class: 'cm-hachi-search-row', 'data-row': 'replace' }, [
    el('span', { class: 'cm-hachi-search-field' }, [replaceField]),
    textButton('replace', '取代', () => replaceNext(view)),
    textButton('replaceAll', '全部取代', () => replaceAll(view))
  ])
  replaceRow.hidden = true

  const dom = el('div', { class: 'cm-hachi-search' })
  let expanded = false
  const toggle = iconButton('toggle', '顯示取代', chevron(), () => {
    expanded = !expanded
    replaceRow.hidden = !expanded
    toggle.setAttribute('aria-expanded', String(expanded))
    toggle.setAttribute('aria-label', expanded ? '隱藏取代' : '顯示取代')
    toggle.title = expanded ? '隱藏取代' : '顯示取代'
    dom.classList.toggle('cm-hachi-search-expanded', expanded)
  })
  toggle.classList.add('cm-hachi-search-toggle')
  toggle.setAttribute('aria-expanded', 'false')

  const findRow = el('div', { class: 'cm-hachi-search-row', 'data-row': 'find' }, [
    el('span', { class: 'cm-hachi-search-field' }, [magnifier(), searchField]),
    count,
    el('span', { class: 'cm-hachi-search-divider' }),
    iconButton('prev', '上一個（Shift+Enter）', arrowUp(), () => findPrevious(view)),
    iconButton('next', '下一個（Enter）', arrowDown(), () => findNext(view)),
    iconButton('close', '關閉（Esc）', cross(), () => closeSearchPanel(view))
  ])
  dom.append(
    ...(editable ? [toggle] : []),
    el('div', { class: 'cm-hachi-search-rows' }, [findRow, ...(editable ? [replaceRow] : [])])
  )

  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearchPanel(view)
      view.focus()
    } else if (e.key === 'Enter' && e.target === searchField) {
      e.preventDefault()
      ;(e.shiftKey ? findPrevious : findNext)(view)
    } else if (e.key === 'Enter' && e.target === replaceField) {
      e.preventDefault()
      replaceNext(view)
    }
  })

  showCount()
  return {
    dom,
    top: true,
    mount: () => {
      searchField.focus()
      searchField.select()
    },
    update(update: ViewUpdate) {
      // The query can change from outside (e.g. ⌘F with a selection).
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (!effect.is(setSearchQuery)) continue
          if (effect.value.search !== searchField.value) searchField.value = effect.value.search
          if (effect.value.replace !== replaceField.value) replaceField.value = effect.value.replace
        }
      }
      if (update.docChanged || update.selectionSet || update.transactions.length > 0) showCount()
    }
  }
}

/** Search with Hachi's floating box (the keymap still comes from `searchKeymap`). */
export const hachiSearch: Extension = search({ createPanel, top: true })
