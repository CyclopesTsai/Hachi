import type { RuntimeVariable } from '@shared/ipc/api'
import type { VariableLayer } from '@shared/variables'

/**
 * Runtime variables (decision 71): set by scripts (`hachi.variables.set`) and extraction
 * rows. Kept in memory per Workspace folder — never written to disk, gone when Hachi quits.
 * They take precedence over environment and collection variables.
 */
export class RuntimeVariables {
  private readonly byWorkspace = new Map<string, Map<string, string>>()
  private readonly listeners = new Set<(workspacePath: string) => void>()

  onChange(listener: (workspacePath: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(workspacePath: string): RuntimeVariable[] {
    return Array.from(this.byWorkspace.get(workspacePath) ?? [], ([name, value]) => ({
      name,
      value
    }))
  }

  values(workspacePath: string): Record<string, string> {
    return Object.fromEntries(this.byWorkspace.get(workspacePath) ?? [])
  }

  layer(workspacePath: string): VariableLayer | null {
    const vars = this.byWorkspace.get(workspacePath)
    if (!vars || vars.size === 0) return null
    return {
      source: 'runtime',
      sourceName: '暫存變數',
      variables: Array.from(vars, ([name, value]) => ({
        id: `runtime:${name}`,
        key: name,
        value,
        enabled: true,
        secret: false
      }))
    }
  }

  /** `value: null` removes the variable. */
  apply(workspacePath: string, changes: readonly { name: string; value: string | null }[]): void {
    if (changes.length === 0) return
    let vars = this.byWorkspace.get(workspacePath)
    if (!vars) {
      vars = new Map()
      this.byWorkspace.set(workspacePath, vars)
    }
    for (const { name, value } of changes) {
      if (value === null) vars.delete(name)
      else vars.set(name, value)
    }
    this.emit(workspacePath)
  }

  delete(workspacePath: string, name: string): void {
    if (this.byWorkspace.get(workspacePath)?.delete(name)) this.emit(workspacePath)
  }

  clear(workspacePath: string): void {
    if (this.byWorkspace.delete(workspacePath)) this.emit(workspacePath)
  }

  private emit(workspacePath: string): void {
    for (const listener of this.listeners) listener(workspacePath)
  }
}
