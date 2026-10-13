/**
 * The box shown when hovering a `{{variable}}` (decision 135): its value and source,
 * editable in place for variables that exist (Enter / leaving the field saves, Esc
 * cancels; secrets are masked until the eye is pressed). Dynamic, $file and unknown
 * variables only show a description. One box at a time, attached to document.body,
 * used by VariableInput and the CodeMirror editors.
 */
import type { VariableMap } from '@shared/variables'
import { unwrap, errorMessage } from './ipc'
import { describeVariable } from './variables'

export interface HoverToken {
  name: string
  rect: DOMRect
}

const SHOW_DELAY_MS = 300
const HIDE_DELAY_MS = 250
const CARD_WIDTH = 320

const SOURCE_LABEL = {
  runtime: '暫存變數',
  data: '資料檔',
  environment: '環境',
  collection: 'Collection'
} as const

let card: HTMLDivElement | null = null
let shownName: string | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearTimers() {
  if (showTimer) clearTimeout(showTimer)
  if (hideTimer) clearTimeout(hideTimer)
  showTimer = hideTimer = null
}

export function hideVariableCard(): void {
  clearTimers()
  card?.remove()
  card = null
  shownName = null
}

function scheduleHide() {
  if (hideTimer) return
  hideTimer = setTimeout(() => {
    hideTimer = null
    // Keep it while the user edits in it.
    if (card && (card.matches(':hover') || card.contains(document.activeElement))) return
    hideVariableCard()
  }, HIDE_DELAY_MS)
}

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const EYE = svg(
  '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
)
const EYE_OFF = svg(
  '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>'
)

function build(name: string, map: VariableMap): HTMLDivElement {
  const el = document.createElement('div')
  el.className =
    'fixed z-[60] flex flex-col gap-2 rounded-lg border bg-card p-2.5 text-xs text-card-foreground shadow-lg'
  el.style.width = `${CARD_WIDTH}px`
  el.dataset.testid = 'variable-card'
  el.dataset.name = name

  const head = document.createElement('div')
  head.className = 'flex min-w-0 items-center gap-2'
  const title = document.createElement('span')
  title.className = 'min-w-0 truncate font-mono font-medium'
  title.textContent = `{{${name}}}`
  head.append(title)
  el.append(head)

  const variable = map.get(name)
  const editable =
    variable &&
    (variable.source === 'runtime' ||
      ((variable.source === 'environment' || variable.source === 'collection') &&
        variable.sourceId !== undefined))
  if (!variable || !editable) {
    const info = describeVariable(name, map)
    const p = document.createElement('p')
    p.className = 'break-all text-muted-foreground'
    p.textContent = variable ? `${info.detail}（這裡不能修改）` : info.detail
    el.append(p)
    return el
  }

  const badge = document.createElement('span')
  badge.className =
    'ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'
  badge.textContent =
    variable.source === 'runtime'
      ? SOURCE_LABEL.runtime
      : `${SOURCE_LABEL[variable.source]}「${variable.sourceName}」`
  head.append(badge)

  const row = document.createElement('div')
  row.className = 'flex items-center gap-1'
  const input = document.createElement('input')
  input.className =
    'h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:border-ring'
  input.value = variable.value
  input.spellcheck = false
  input.setAttribute('aria-label', `${name} 的值`)
  input.type = variable.secret ? 'password' : 'text'
  row.append(input)
  if (variable.secret) {
    const eye = document.createElement('button')
    eye.type = 'button'
    eye.className =
      'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
    eye.setAttribute('aria-label', '顯示值')
    eye.innerHTML = EYE
    eye.addEventListener('click', () => {
      const show = input.type === 'password'
      input.type = show ? 'text' : 'password'
      eye.innerHTML = show ? EYE_OFF : EYE
      eye.setAttribute('aria-label', show ? '隱藏值' : '顯示值')
      input.focus()
    })
    row.append(eye)
  }
  el.append(row)

  const hint = document.createElement('p')
  hint.className = 'text-[11px] text-muted-foreground'
  hint.textContent = `Enter 儲存、Esc 取消${variable.secret ? '（機密值只存在 .hachi-secrets.json）' : ''}`
  el.append(hint)

  let done = false
  const save = async () => {
    if (done) return
    done = true
    if (input.value === variable.value) return
    try {
      await unwrap(
        window.hachi.variables.set({
          scope: variable.source as 'runtime' | 'environment' | 'collection',
          id: variable.source === 'runtime' ? null : (variable.sourceId ?? null),
          name,
          value: input.value
        })
      )
    } catch (error) {
      done = false
      hint.textContent = errorMessage(error)
      hint.className = 'text-[11px] text-destructive'
      throw error
    }
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      void save().then(hideVariableCard, () => input.focus())
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      done = true
      hideVariableCard()
    }
  })
  input.addEventListener('blur', () => {
    // Leaving the field saves (unless it moved to the eye button of this card).
    setTimeout(() => {
      if (card === el && el.contains(document.activeElement)) return
      void save().then(
        () => {
          if (card === el && !el.matches(':hover')) hideVariableCard()
        },
        () => undefined
      )
    })
  })
  return el
}

function show(token: HoverToken, map: VariableMap) {
  hideVariableCard()
  const el = build(token.name, map)
  el.addEventListener('mouseenter', () => {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = null
  })
  el.addEventListener('mouseleave', scheduleHide)
  document.body.append(el)
  card = el
  shownName = token.name
  // Below the variable, or above it when there is no room; inside the window.
  const height = el.offsetHeight
  const below = token.rect.bottom + 6
  const top =
    below + height > window.innerHeight - 8 ? Math.max(8, token.rect.top - height - 6) : below
  const left = Math.min(Math.max(8, token.rect.left), window.innerWidth - CARD_WIDTH - 8)
  el.style.top = `${top}px`
  el.style.left = `${left}px`
}

// Clicking elsewhere, scrolling or resizing closes it.
if (typeof window !== 'undefined') {
  document.addEventListener(
    'mousedown',
    (e) => {
      if (card && !card.contains(e.target as Node)) {
        const active = document.activeElement
        if (card.contains(active)) (active as HTMLElement).blur()
        hideVariableCard()
      }
    },
    true
  )
  window.addEventListener('resize', hideVariableCard)
  window.addEventListener('blur', () => {
    if (card && !card.contains(document.activeElement)) hideVariableCard()
  })
}

/** Shows the box while the pointer rests on a variable of `target`. Returns a detach function. */
export function attachVariableHover(
  target: HTMLElement,
  options: { tokenAt(e: MouseEvent): HoverToken | null; map(): VariableMap }
): () => void {
  let pending: string | null = null
  const move = (e: MouseEvent) => {
    const token = options.tokenAt(e)
    if (!token) {
      if (showTimer) clearTimeout(showTimer)
      showTimer = null
      pending = null
      if (card) scheduleHide()
      return
    }
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = null
    if (shownName === token.name && card) return
    if (pending === token.name && showTimer) return
    if (showTimer) clearTimeout(showTimer)
    pending = token.name
    showTimer = setTimeout(() => {
      showTimer = null
      pending = null
      // Don't take the box away from a value being edited.
      if (card && card.contains(document.activeElement)) return
      show(token, options.map())
    }, SHOW_DELAY_MS)
  }
  const leave = () => {
    if (showTimer) clearTimeout(showTimer)
    showTimer = null
    pending = null
    if (card) scheduleHide()
  }
  target.addEventListener('mousemove', move)
  target.addEventListener('mouseleave', leave)
  return () => {
    target.removeEventListener('mousemove', move)
    target.removeEventListener('mouseleave', leave)
  }
}
