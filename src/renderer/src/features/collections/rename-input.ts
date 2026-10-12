/**
 * Focuses the open rename field and selects its whole text, unless the user has
 * already started typing. Also called when a context menu closes (it takes focus back).
 */
export function selectRenameInput(initial?: string): void {
  const el = document.querySelector<HTMLInputElement>('[data-testid="tree-rename-input"]')
  if (!el || (initial !== undefined && el.value !== initial)) return
  if (el.dataset.touched === 'true') return
  el.focus()
  el.select()
}
