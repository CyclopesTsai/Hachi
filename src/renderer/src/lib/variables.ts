import { createContext, useContext, useMemo } from 'react'
import { findNode } from '@shared/tree'
import {
  dynamicVariableDescription,
  buildVariableMap,
  isDynamicVariable,
  isFileVariable,
  parseFileVariable,
  maskSecret,
  type VariableLayer,
  type VariableMap
} from '@shared/variables'
import { useEnvStore } from '@renderer/stores/env-store'
import { useTreeStore } from '@renderer/stores/tree-store'
import { msg } from '@shared/i18n'

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
        sourceName: msg().vars.thisRun,
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
      layers.push({
        source: 'environment',
        sourceName: active.name,
        sourceId: active.id,
        variables: active.variables
      })
    }
    if (collectionVariables) {
      layers.push({
        source: 'collection',
        sourceName: collectionName ?? 'Collection',
        sourceId: collectionId ?? undefined,
        variables: collectionVariables
      })
    }
    return buildVariableMap(layers)
  }, [runtime, active, collectionVariables, collectionName, collectionId])
}

export type VariableStatus = 'defined' | 'dynamic' | 'missing'

export interface VariableInfo {
  name: string
  status: VariableStatus
  /** Human readable: value (masked when secret) and where it comes from. */
  detail: string
}

export function describeVariable(name: string, map: VariableMap): VariableInfo {
  const variable = map.get(name)
  if (variable) {
    const m = msg().vars
    const value = variable.secret ? m.secret(maskSecret(variable.value)) : variable.value
    const source = m.named(m.sources[variable.source], variable.sourceName)
    return {
      name,
      status: 'defined',
      detail: `${value === '' ? m.emptyString : value} — ${source}`
    }
  }
  if (isDynamicVariable(name)) {
    return { name, status: 'dynamic', detail: msg().vars.dynamic(dynamicVariableDescription(name)) }
  }
  const file = parseFileVariable(name)
  if (file?.supported) {
    return { name, status: 'dynamic', detail: msg().vars.file(file.path) }
  }
  if (isFileVariable(name)) {
    return { name, status: 'missing', detail: msg().vars.fileFormat }
  }
  return { name, status: 'missing', detail: msg().vars.missing }
}

export const VARIABLE_CLASS: Record<VariableStatus, string> = {
  defined: 'text-emerald-600 dark:text-emerald-400',
  dynamic: 'text-sky-600 dark:text-sky-400',
  missing: 'text-red-600 dark:text-red-400'
}
