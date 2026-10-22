import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { msg } from '@shared/i18n'
import { useAppStore } from '@renderer/stores/app-store'
import { useShortcutsDialog } from '@renderer/stores/shortcuts-store'

type Section = { title: string; rows: [keys: string, action: string][] }

/**
 * Every keyboard shortcut Hachi has (decisions 21, 43, 48–51, 96). Keep in sync with
 * docs/ipc.md「原生選單」/「畫面內的按鍵」 — the E2E test checks the menu side.
 */
function sections(mac: boolean, packaged: boolean): Section[] {
  const mod = mac ? '⌘' : 'Ctrl+'
  const shift = mac ? '⇧' : 'Shift+'
  const m = msg().shortcuts
  return [
    {
      title: m.menu,
      rows: [
        [`${mod}${shift}N`, m.newWorkspace],
        [`${mod}O`, m.openWorkspace],
        [`${mod}S`, m.saveTab],
        [`${mod}W`, m.closeTab],
        [mac ? '⌘Q' : m.quitKeyOther, m.quit],
        ...(packaged ? [] : ([[`${mod}R`, m.reload]] as [string, string][]))
      ]
    },
    {
      title: m.edit,
      rows: [
        [`${mod}Z / ${mod}${shift}Z`, m.undoRedo],
        [`${mod}X / ${mod}C / ${mod}V`, m.cutCopyPaste],
        [`${mod}A`, m.selectAll]
      ]
    },
    {
      title: m.tree,
      rows: [
        ['↑ / ↓', m.moveSelection],
        ['Enter', m.openPinned],
        [mac ? m.deleteKeyMac : m.deleteKeyOther, m.delete]
      ]
    },
    {
      title: m.fields,
      rows: [
        ['Enter / Esc', m.renameField],
        ['Enter / Esc', m.dialog],
        ['Enter / Esc', m.hover]
      ]
    },
    {
      title: m.editors,
      rows: [
        [`${mod}F`, m.find],
        [`Enter / ${shift}Enter`, m.findNext],
        ['Esc', m.closeFind],
        [`${mod}A / ${mod}C`, m.selectCopy]
      ]
    }
  ]
}

/** Help → Keyboard Shortcuts (decision 96). */
export function ShortcutsDialog() {
  const open = useShortcutsDialog((s) => s.open)
  const info = useAppStore((s) => s.info)
  const mac = info?.platform === 'darwin'
  return (
    <Dialog open={open} onOpenChange={(o) => useShortcutsDialog.getState().setOpen(o)}>
      <DialogContent className="sm:max-w-xl" data-testid="shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>{msg().shortcuts.title}</DialogTitle>
          <DialogDescription>{msg().shortcuts.description}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto">
          {sections(mac, info?.isPackaged ?? true).map((section) => (
            <section key={section.title} className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{section.title}</h3>
              <table className="w-full text-sm">
                <tbody>
                  {section.rows.map(([keys, action], i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="w-48 py-1.5 pr-3">
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {keys}
                        </kbd>
                      </td>
                      <td className="py-1.5">{action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
