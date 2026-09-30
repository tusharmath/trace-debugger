import type { Conversation, TraceMessage, TreeNode } from '@/types/trace'

/**
 * Build a message tree from parent/child relationships.
 * Falls back to sequential chaining when no explicit hierarchy exists.
 */
export function buildConversation(
  id: string,
  messages: TraceMessage[],
  byId: Map<string, TraceMessage>,
): Conversation {
  // Preserve source order (line number)
  const ordered = [...messages].sort((a, b) => a.line - b.line)

  const hasAnyParent = ordered.some((m) => m.parentId !== null && byId.has(m.parentId))

  if (!hasAnyParent) {
    // No usable hierarchy: derive a linear chain in source order.
    for (let i = 1; i < ordered.length; i++) {
      ordered[i].parentId = ordered[i - 1].id
    }
  }

  const childrenOf = new Map<string, TraceMessage[]>()
  const roots: TraceMessage[] = []

  for (const msg of ordered) {
    if (msg.parentId !== null && byId.has(msg.parentId) && msg.parentId !== msg.id) {
      let arr = childrenOf.get(msg.parentId)
      if (!arr) {
        arr = []
        childrenOf.set(msg.parentId, arr)
      }
      arr.push(msg)
    } else {
      roots.push(msg)
    }
  }

  let forkCount = 0
  const visited = new Set<string>()

  const toNode = (msg: TraceMessage, depth: number, isForkBranch: boolean): TreeNode => {
    visited.add(msg.id)
    const kids = (childrenOf.get(msg.id) ?? []).filter((k) => !visited.has(k.id))
    if (kids.length > 1) forkCount += 1
    return {
      message: msg,
      depth,
      isForkBranch,
      children: kids.map((k, i) => toNode(k, depth + 1, kids.length > 1 && i > 0)),
    }
  }

  const rootNodes = roots.map((r) => toNode(r, 0, false))

  // Safety net: any message unreachable due to cycles becomes a root
  for (const msg of ordered) {
    if (!visited.has(msg.id)) {
      rootNodes.push(toNode(msg, 0, false))
    }
  }

  const errorCount = ordered.filter((m) => m.errors.length > 0).length
  const toolCallCount = ordered.reduce((n, m) => n + m.toolCalls.length, 0)

  return {
    id,
    messages: ordered,
    byId,
    roots: rootNodes,
    errorCount,
    toolCallCount,
    forkCount,
  }
}

/** Flatten a tree (pre-order) for keyboard navigation / search. */
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (n: TreeNode) => {
    out.push(n)
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}
