import { createContext, useContext, useMemo } from 'react'
import { findNode } from '@shared/tree'
import {
  DYNAMIC_VARIABLES,
  buildVariableMap,
  findVariableTokens,
  isDynamicVariable,
  maskSecret,
  type VariableLayer,
  type VariableMap
} from '@shared/variables'
import { useEnvStore } from '@renderer/stores/env-store'
import { useTreeStore } from '@renderer/stores/tree-store'

const EMPTY_MAP: VariableMap = new Map()

/** Variables visible to the editor below (for highlighting); empty = no highlighting data. */
export const VariablesContext = createContext<VariableMap>(EMPTY_MAP)

export function useVariables(): VariableMap {
  return useContext(VariablesContext)
}

/** Runtime + active environment + the given collection's variables (in that precedence). */
export function useVariableMap(collectionId: string | null): VariableMap {
  const active = useEnvStore((s) => s.active)
  const runtime = useEnvStore((s) => s.runtime)
  const collectionVariables = useEnvStore((s) =>
    collectionId ? s.collectionVariables[collectionId] : undefined
  )
  const collectionName = useTreeStore((s) =>
    collectionId ? findNode(s.tree, collectionId)?.node.name : undefined
  )
  return useMemo(() => {
    const layers: VariableLayer[] = []
    if (runtime.length > 0) {
      layers.push({
        source: 'runtime',
        sourceName: '本次執行',
        variables: runtime.map((v) => ({
          id: `runtime:${v.name}`,
          key: v.name,
          value: v.value,
          enabled: true,
          secret: false
        }))
      })
    }
    if (active) {
      layers.push({ source: 'environment', sourceName: active.name, variables: active.variables })
    }
    if (collectionVariables) {
      layers.push({
        source: 'collection',
        sourceName: collectionName ?? 'Collection',
        variables: collectionVariables
      })
    }
    return buildVariableMap(layers)
  }, [runtime, active, collectionVariables, collectionName])
}

export type VariableStatus = 'defined' | 'dynamic' | 'missing'

export interface VariableInfo {
  name: string
  status: VariableStatus
  /** Human readable: value (masked when secret) and where it comes from. */
  detail: string
}

const SOURCE_LABEL = { runtime: '暫存變數', environment: '環境', collection: 'Collection' } as const

export function describeVariable(name: string, map: VariableMap): VariableInfo {
  const variable = map.get(name)
  if (variable) {
    const value = variable.secret ? `${maskSecret(variable.value)}（機密）` : variable.value
    const source = `${SOURCE_LABEL[variable.source]}「${variable.sourceName}」`
    return { name, status: 'defined', detail: `${value === '' ? '（空字串）' : value} — ${source}` }
  }
  if (isDynamicVariable(name)) {
    return { name, status: 'dynamic', detail: `動態變數：${DYNAMIC_VARIABLES[name]}` }
  }
  return { name, status: 'missing', detail: '找不到這個變數，會照原樣送出' }
}

/** Tooltip text listing the variables used in a string, or undefined if there are none. */
export function variablesTitle(text: string, map: VariableMap): string | undefined {
  const tokens = findVariableTokens(text)
  if (tokens.length === 0) return undefined
  const seen = new Set<string>()
  return tokens
    .filter((t) => !seen.has(t.name) && seen.add(t.name))
    .map((t) => {
      const info = describeVariable(t.name, map)
      return `{{${t.name}}} = ${info.detail}`
    })
    .join('\n')
}

export const VARIABLE_CLASS: Record<VariableStatus, string> = {
  defined: 'text-emerald-600 dark:text-emerald-400',
  dynamic: 'text-sky-600 dark:text-sky-400',
  missing: 'text-red-600 dark:text-red-400'
}
