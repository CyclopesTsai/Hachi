import { useAppStore } from '@renderer/stores/app-store'

/** "Wrap lines" preference shared by all request body editors (display only). */
export function useWrapPreference(key: 'requestBodyWrap' | 'responseBodyWrap') {
  const wrap = useAppStore((s) => s.config?.ui[key] ?? false)
  const updateConfig = useAppStore((s) => s.updateConfig)
  return [wrap, (value: boolean) => void updateConfig({ ui: { [key]: value } })] as const
}
