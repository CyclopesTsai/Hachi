import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Trash2, X } from 'lucide-react'
import type { IpcResult } from '@shared/ipc/api'
import type { StoredCookie } from '@shared/schemas/cookies'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { errorMessage, unwrap } from '@renderer/lib/ipc'

const expiresText = (cookie: StoredCookie) =>
  cookie.expires === null ? '工作階段' : new Date(cookie.expires).toLocaleString()

/** The Workspace's cookie jar (decision 129): view, delete one, clear a domain or all. */
function CookiesBody() {
  const [cookies, setCookies] = useState<StoredCookie[] | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    void unwrap(window.hachi.cookies.list())
      .then((list) => {
        if (alive) setCookies(list)
      })
      .catch((e: unknown) => {
        if (alive) setError(errorMessage(e))
      })
    return () => {
      alive = false
    }
  }, [tick])

  const reload = () => setTick((t) => t + 1)
  const run = async (action: Promise<IpcResult<void>>) => {
    setError(null)
    try {
      await unwrap(action)
    } catch (e) {
      setError(errorMessage(e))
    }
    reload()
  }

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const byDomain = new Map<string, StoredCookie[]>()
    for (const c of cookies ?? []) {
      if (needle && !c.domain.includes(needle) && !c.name.toLowerCase().includes(needle)) continue
      byDomain.set(c.domain, [...(byDomain.get(c.domain) ?? []), c])
    }
    return [...byDomain.entries()]
  }, [cookies, filter])

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          aria-label="篩選 Cookie"
          placeholder="篩選網域或名稱"
          className="h-8 flex-1"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Button size="sm" variant="outline" onClick={reload} title="重新整理">
          <RefreshCw />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!cookies || cookies.length === 0}
          data-testid="cookies-clear-all"
          onClick={() => void run(window.hachi.cookies.clear({ domain: null }))}
        >
          全部清除
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div
        className="max-h-[min(60vh,28rem)] min-h-24 overflow-auto rounded-md border"
        data-testid="cookies-list"
      >
        {cookies && groups.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            {cookies.length === 0 ? '還沒有 Cookie。' : '沒有符合的 Cookie。'}
          </p>
        )}
        {groups.map(([domain, list]) => (
          <section key={domain} className="border-b last:border-b-0">
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5">
              <span className="font-mono text-xs font-medium" data-testid="cookie-domain">
                {domain}
              </span>
              <span className="text-xs text-muted-foreground">{list.length}</span>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => void run(window.hachi.cookies.clear({ domain }))}
              >
                <Trash2 />
                清除這個網域
              </Button>
            </div>
            <table className="w-full table-fixed text-xs">
              <tbody>
                {list.map((c) => (
                  <tr
                    key={`${c.path}\u0000${c.name}`}
                    className="border-t align-top"
                    data-testid="cookie-row"
                  >
                    <td className="w-1/5 truncate px-3 py-1 font-mono" title={c.name}>
                      {c.name}
                    </td>
                    <td className="truncate px-2 py-1 font-mono select-text" title={c.value}>
                      {c.value}
                    </td>
                    <td className="w-20 truncate px-2 py-1 font-mono" title={c.path}>
                      {c.path}
                    </td>
                    <td className="w-40 truncate px-2 py-1 text-muted-foreground">
                      {expiresText(c)}
                      {c.secure && ' · Secure'}
                      {c.httpOnly && ' · HttpOnly'}
                    </td>
                    <td className="w-8 py-0.5 pr-1 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        aria-label={`刪除 ${c.name}`}
                        onClick={() =>
                          void run(
                            window.hachi.cookies.delete({
                              name: c.name,
                              domain: c.domain,
                              path: c.path
                            })
                          )
                        }
                      >
                        <X />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </>
  )
}

export function CookiesDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" data-testid="cookies-dialog">
        <DialogHeader>
          <DialogTitle>Cookies</DialogTitle>
          <DialogDescription>
            回應的 Set-Cookie 會自動保存，之後的請求自動帶上（可在請求的 Settings
            關閉）。只存在這台電腦。
          </DialogDescription>
        </DialogHeader>
        {open && <CookiesBody />}
      </DialogContent>
    </Dialog>
  )
}
