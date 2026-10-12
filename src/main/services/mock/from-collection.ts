/**
 * "從 Collection 建立" (decision 133): one route per HTTP request (method + path of its
 * URL) and one endpoint per WebSocket request; responses start empty.
 */
import { randomUUID } from 'node:crypto'
import { mockPathOf } from '@shared/mock'
import type { AnyRequest } from '@shared/schemas/request'
import {
  mockRouteSchema,
  mockWsEndpointSchema,
  type MockRoute,
  type MockWsEndpoint
} from '@shared/schemas/mock'
import { isContainer, type CollectionNode, type TreeNode } from '@shared/tree'

export async function mockFromCollection(
  collection: CollectionNode,
  getRequest: (id: string) => Promise<AnyRequest | null>,
  newId: () => string = randomUUID
): Promise<{ routes: MockRoute[]; websockets: MockWsEndpoint[] }> {
  const routes: MockRoute[] = []
  const websockets: MockWsEndpoint[] = []
  const seen = new Set<string>()
  const walk = async (node: TreeNode, trail: string[]): Promise<void> => {
    if (isContainer(node)) {
      for (const child of node.children) await walk(child, [...trail, child.name])
      return
    }
    if (node.error) return
    const request = await getRequest(node.id).catch(() => null)
    if (!request) return
    const path = mockPathOf(request.url)
    const description = trail.join(' / ')
    if (request.type === 'http') {
      const key = `${request.method} ${path}`
      if (seen.has(key)) return
      seen.add(key)
      routes.push(mockRouteSchema.parse({ id: newId(), method: request.method, path, description }))
    } else if (!seen.has(`WS ${path}`)) {
      seen.add(`WS ${path}`)
      websockets.push(mockWsEndpointSchema.parse({ id: newId(), path }))
    }
  }
  for (const child of collection.children) await walk(child, [child.name])
  return { routes, websockets }
}
