import { create } from 'zustand'

/** Help → Keyboard Shortcuts dialog (decision 96). */
export const useShortcutsDialog = create<{ open: boolean; setOpen(open: boolean): void }>()(
  (set) => ({ open: false, setOpen: (open) => set({ open }) })
)
