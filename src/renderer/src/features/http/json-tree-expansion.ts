/** Every node starts open; 全部收合 flips the base and toggled nodes are the exceptions. */
export interface TreeExpansion {
  base: 'expanded' | 'collapsed'
  toggled: ReadonlySet<string>
}

export const ALL_EXPANDED: TreeExpansion = { base: 'expanded', toggled: new Set() }
export const ALL_COLLAPSED: TreeExpansion = { base: 'collapsed', toggled: new Set() }
