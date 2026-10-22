import { useState } from 'react'
import { LANGUAGES, msg, type LanguageSetting } from '@shared/i18n'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { errorMessage } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/stores/app-store'

/**
 * Interface language (issue #6), applied at once: "follow the system" or one language.
 * Language names are always written in their own language.
 */
export function LanguageSelect({ className }: { className?: string }) {
  const setting = useAppStore((s) => s.config?.ui.language ?? 'system')
  const updateConfig = useAppStore((s) => s.updateConfig)
  const [error, setError] = useState<string | null>(null)
  const m = msg()
  return (
    <>
      <NativeSelect
        aria-label={m.settings.app.language}
        data-testid="language-select"
        className={cn('h-8 w-40 text-xs', className)}
        value={setting}
        onChange={(e) =>
          void updateConfig({ ui: { language: e.target.value as LanguageSetting } }).then(
            () => setError(null),
            (err: unknown) => setError(errorMessage(err))
          )
        }
      >
        <option value="system">{m.settings.app.languageSystem}</option>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {m.common.languageNames[l]}
          </option>
        ))}
      </NativeSelect>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  )
}
