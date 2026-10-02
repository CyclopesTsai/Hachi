import { Check, ChevronDown, Globe, Settings2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useEnvStore } from '@renderer/stores/env-store'
import { useTabsStore } from '@renderer/stores/tabs-store'

/** Header dropdown: the environment used for `{{variables}}`, and "管理環境…". */
export function EnvironmentSelect() {
  const list = useEnvStore((s) => s.list)
  const activeId = useEnvStore((s) => s.activeId)
  const activeName = list.find((e) => e.id === activeId)?.name
  const setActive = useEnvStore((s) => s.setActive)
  return (
    <DropdownMenu onOpenChange={(open) => open && void useEnvStore.getState().loadList()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 max-w-56 gap-1.5 px-2 text-xs"
          data-testid="environment-select"
        >
          <Globe className="text-muted-foreground" />
          <span className="truncate" data-testid="active-environment">
            {activeName ?? '無環境'}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={() => void setActive(null)}>
          <span className="flex size-4 items-center">{activeId === null && <Check />}</span>
          無環境
        </DropdownMenuItem>
        {list
          .filter((e) => !e.error)
          .map((env) => (
            <DropdownMenuItem
              key={env.id}
              data-testid="environment-option"
              onSelect={() => void setActive(env.id)}
            >
              <span className="flex size-4 items-center">{activeId === env.id && <Check />}</span>
              <span className="truncate">{env.name}</span>
            </DropdownMenuItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => useTabsStore.getState().openEnvironments()}>
          <Settings2 />
          管理環境…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
