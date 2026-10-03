import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
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
  return [
    {
      title: '選單',
      rows: [
        [`${mod}${shift}N`, '新增 Workspace'],
        [`${mod}O`, '開啟 Workspace'],
        [`${mod}S`, '儲存目前分頁'],
        [`${mod}W`, '關閉目前分頁（沒有分頁時關閉視窗）'],
        [mac ? '⌘Q' : 'Ctrl+Q（Linux）', '結束 Hachi'],
        ...(packaged ? [] : ([[`${mod}R`, '重新載入畫面（只在開發模式）']] as [string, string][]))
      ]
    },
    {
      title: '編輯',
      rows: [
        [`${mod}Z / ${mod}${shift}Z`, '復原 / 重做'],
        [`${mod}X / ${mod}C / ${mod}V`, '剪下 / 複製 / 貼上'],
        [`${mod}A`, '全選']
      ]
    },
    {
      title: '左側樹狀清單',
      rows: [
        ['↑ / ↓', '移動選取'],
        ['Enter', '開啟成固定分頁'],
        [mac ? 'Delete 或 ⌘⌫' : 'Delete 或 Ctrl+Backspace', '刪除（會先確認）']
      ]
    },
    {
      title: '欄位與對話框',
      rows: [
        ['Enter / Esc', '改名欄位：確定 / 取消'],
        ['Enter / Esc', '對話框：送出 / 關閉']
      ]
    },
    {
      title: 'Body、腳本與回應編輯器',
      rows: [[`${mod}F`, '搜尋（CodeMirror 標準按鍵，另有復原、多重選取等）']]
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
          <DialogTitle>鍵盤快捷鍵</DialogTitle>
          <DialogDescription>
            Hachi 刻意只保留少數快捷鍵：發送、連線、新分頁等操作沒有快捷鍵，以免誤觸。
          </DialogDescription>
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
