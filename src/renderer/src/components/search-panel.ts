/**
 * The editor's search panel (replaces CodeMirror's own): one row with the search field,
 * 下一個 / 上一個 and close; editable editors get a chevron at the start that opens a
 * second row with the replace field, 取代 and 全部取代 (as in IntelliJ). Collapsed at first.
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
import type { Extension } from '@codemirror/state'
import type { EditorView, Panel, ViewUpdate } from '@codemirror/view'

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

/** lucide "chevron-right"; turned 90° when the replace row is open. */
const chevron = () => icon(['path', { d: 'm9 18 6-6-6-6' }])
/** lucide "search". */
const magnifier = () =>
  icon(['circle', { cx: '11', cy: '11', r: '8' }], ['path', { d: 'm21 21-4.3-4.3' }])

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>>,
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v)
  node.append(...children)
  return node
}

function createPanel(view: EditorView): Panel {
  const editable = !view.state.readOnly
  const query = getSearchQuery(view.state)
  const searchField = el('input', {
    class: 'cm-textfield',
    name: 'search',
    placeholder: '搜尋',
    'aria-label': '搜尋',
    'main-field': 'true'
  })
  searchField.value = query.search
  const replaceField = el('input', {
    class: 'cm-textfield',
    name: 'replace',
    placeholder: '取代',
    'aria-label': '取代'
  })
  replaceField.value = query.replace

  const commit = () => {
    const current = getSearchQuery(view.state)
    const next = new SearchQuery({
      search: searchField.value,
      replace: replaceField.value,
      caseSensitive: current.caseSensitive,
      regexp: current.regexp,
      wholeWord: current.wholeWord
    })
    if (!next.eq(current)) view.dispatch({ effects: setSearchQuery.of(next) })
  }
  for (const field of [searchField, replaceField]) {
    field.addEventListener('input', commit)
    field.addEventListener('change', commit)
  }

  const button = (name: string, label: string, run: () => void) => {
    const b = el('button', { class: 'cm-button', name, type: 'button' }, [label])
    b.addEventListener('click', run)
    return b
  }

  const replaceRow = el('div', { class: 'cm-hachi-search-row', 'data-row': 'replace' }, [
    replaceField,
    button('replace', '取代', () => replaceNext(view)),
    button('replaceAll', '全部取代', () => replaceAll(view))
  ])
  replaceRow.hidden = true

  const toggle = el('button', {
    class: 'cm-hachi-search-toggle',
    name: 'toggle',
    type: 'button',
    'aria-label': '顯示取代',
    'aria-expanded': 'false'
  })
  toggle.append(chevron())
  let expanded = false
  const setExpanded = (open: boolean) => {
    expanded = open
    replaceRow.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    toggle.setAttribute('aria-label', open ? '隱藏取代' : '顯示取代')
    dom.classList.toggle('cm-hachi-search-expanded', open)
  }
  toggle.addEventListener('click', () => setExpanded(!expanded))

  const close = el('button', { name: 'close', type: 'button', 'aria-label': '關閉' }, ['×'])
  close.addEventListener('click', () => closeSearchPanel(view))

  const findRow = el('div', { class: 'cm-hachi-search-row', 'data-row': 'find' }, [
    el('span', { class: 'cm-hachi-search-field' }, [magnifier(), searchField]),
    button('next', '下一個', () => findNext(view)),
    button('prev', '上一個', () => findPrevious(view))
  ])
  const dom = el('div', { class: 'cm-search' }, [
    ...(editable ? [toggle] : []),
    el('div', { class: 'cm-hachi-search-rows' }, [findRow, ...(editable ? [replaceRow] : [])]),
    close
  ])

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

  return {
    dom,
    top: false,
    mount: () => {
      searchField.focus()
      searchField.select()
    },
    update(update: ViewUpdate) {
      // The query can change from outside (e.g. ⌘F with a selection).
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) {
            if (effect.value.search !== searchField.value) searchField.value = effect.value.search
            if (effect.value.replace !== replaceField.value) {
              replaceField.value = effect.value.replace
            }
          }
        }
      }
    }
  }
}

/** Search with Hachi's panel (the keymap still comes from `searchKeymap`). */
export const hachiSearch: Extension = search({ createPanel })
