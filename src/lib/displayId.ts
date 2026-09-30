import type { TraceMessage, TreeNode } from '@/types/trace'

/**
 * Synthesized ids look like `msg_12`. The `msg_` prefix carries no information
 * (every row is a message) and eats horizontal space in the tree, so we render
 * them as a compact ordinal instead. Explicit ids from the trace are never
 * rewritten — those are real identifiers the user may need verbatim.
 *
 * Copy actions always use the underlying id, not this display form.
 */
const SYNTHETIC_RE = /^msg_(\d+)$/

export function formatSyntheticId(id: string, branchOrdinal?: number): string {
  const m = SYNTHETIC_RE.exec(id)
  if (!m) return id
  return `#${branchOrdinal ?? m[1]}`
}

export function displayId(id: string, synthetic: boolean): string {
  return synthetic ? formatSyntheticId(id) : id
}

export function messageDisplayId(m: TraceMessage, branchOrdinal?: number): string {
  if (m.syntheticId && branchOrdinal !== undefined) return `#${branchOrdinal}`
  return displayId(m.id, m.syntheticId)
}

/**
 * Assign synthetic display ordinals along each root-to-leaf path. Sibling
 * branches start from the same parent ordinal, so messages in one branch do
 * not inflate the numbering shown in another branch.
 */
export function buildBranchLocalOrdinals(roots: TreeNode[]): Map<string, number> {
  const ordinals = new Map<string, number>()

  const walk = (node: TreeNode, ordinal: number) => {
    ordinals.set(node.message.id, ordinal)
    node.children.forEach((child) => walk(child, ordinal + 1))
  }

  roots.forEach((root) => walk(root, 1))
  return ordinals
}
