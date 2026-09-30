import { useCallback, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  UnfoldVertical,
  FoldVertical,
  Search,
  AlertCircle,
  Wrench,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { MessageTreeNode } from '@/components/MessageTreeNode'
import { flattenTree } from '@/trace/conversationTree'
import { buildBranchLocalOrdinals } from '@/lib/displayId'
import type { Conversation, MessageRole, TreeNode } from '@/types/trace'

interface ConversationTreeProps {
  conversation: Conversation
  selectedId: string | null
  onSelect: (id: string) => void
  windowMessageIds?: Set<string>
}

const ROLE_FILTERS: MessageRole[] = ['user', 'assistant', 'system', 'tool']

function matchesFilters(
  node: TreeNode,
  query: string,
  roles: Set<string>,
  onlyTools: boolean,
  onlyErrors: boolean,
): boolean {
  const m = node.message
  if (roles.size > 0 && !roles.has(m.role)) return false
  if (onlyTools && m.toolCalls.length === 0) return false
  if (onlyErrors && m.errors.length === 0) return false
  if (query) {
    const q = query.toLowerCase()
    const hay = [
      m.id,
      m.contentText,
      m.model ?? '',
      m.toolCalls.map((t) => t.name).join(' '),
      m.errors.join(' '),
    ]
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

/** Filter tree while keeping ancestors of matches visible. */
function filterTree(
  nodes: TreeNode[],
  pred: (n: TreeNode) => boolean,
): TreeNode[] {
  const out: TreeNode[] = []
  for (const node of nodes) {
    const kids = filterTree(node.children, pred)
    if (pred(node) || kids.length > 0) {
      out.push({ ...node, children: kids })
    }
  }
  return out
}

export function ConversationTree({
  conversation,
  selectedId,
  onSelect,
  windowMessageIds,
}: ConversationTreeProps) {
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string[]>([])
  const [onlyTools, setOnlyTools] = useState(false)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const filtering = query !== '' || roleFilter.length > 0 || onlyTools || onlyErrors

  const visibleRoots = useMemo(() => {
    const roles = new Set(roleFilter)
    return filterTree(conversation.roots, (node) => {
      if (windowMessageIds && !windowMessageIds.has(node.message.id)) return false
      return !filtering || matchesFilters(node, query, roles, onlyTools, onlyErrors)
    })
  }, [conversation.roots, filtering, query, roleFilter, onlyTools, onlyErrors, windowMessageIds])

  const errorMessages = useMemo(
    () => flattenTree(conversation.roots).filter((n) => n.message.errors.length > 0),
    [conversation.roots],
  )

  const jumpError = (dir: 1 | -1) => {
    if (errorMessages.length === 0) return
    const idx = errorMessages.findIndex((n) => n.message.id === selectedId)
    const next =
      idx === -1
        ? errorMessages[0]
        : errorMessages[(idx + dir + errorMessages.length) % errorMessages.length]
    onSelect(next.message.id)
  }

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Only fork points are collapsible, so "collapse all" folds every fork. */
  const collapseAll = () => {
    const all = flattenTree(conversation.roots)
      .filter((n) => n.children.length > 1)
      .map((n) => n.message.id)
    setCollapsed(new Set(all))
  }

  /**
   * Nodes currently visible in the tree, top-to-bottom.
   * Mirrors MessageTreeNode's rendering exactly: only fork points collapse, so a
   * node is hidden when the fork above it is collapsed *or* when the branch
   * header it sits under is collapsed (fork children are wrapped in a
   * `branch:<id>` group). Linear chains are never foldable.
   */
  const displayOrdinals = useMemo(
    () => buildBranchLocalOrdinals(conversation.roots),
    [conversation.roots],
  )

  const visibleList = useMemo(() => {
    const out: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      const isFork = nodes.length > 1
      for (const n of nodes) {
        if (isFork && collapsed.has(`branch:${n.message.id}`)) continue
        out.push(n)
        const foldable = n.children.length > 1
        if (!(foldable && collapsed.has(n.message.id))) walk(n.children)
      }
    }
    walk(visibleRoots)
    return out
  }, [visibleRoots, collapsed])

  const parentOf = useMemo(() => {
    const map = new Map<string, string>()
    const walk = (nodes: TreeNode[], parent: string | null) => {
      for (const n of nodes) {
        if (parent) map.set(n.message.id, parent)
        walk(n.children, n.message.id)
      }
    }
    walk(visibleRoots, null)
    return map
  }, [visibleRoots])

  /** Ids that are the first node of a branch under a fork. */
  const branchRoots = useMemo(() => {
    const set = new Set<string>()
    const walk = (nodes: TreeNode[]) => {
      if (nodes.length > 1) nodes.forEach((n) => set.add(n.message.id))
      nodes.forEach((n) => walk(n.children))
    }
    walk(visibleRoots)
    return set
  }, [visibleRoots])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (visibleList.length === 0) return
      // Don't hijack keys typed into the search input / toolbar controls.
      const target = e.target as HTMLElement
      if (target.closest('input, [role="toolbar"]')) return

      const idx = visibleList.findIndex((n) => n.message.id === selectedId)
      const current = idx >= 0 ? visibleList[idx] : null

      const select = (n: TreeNode | undefined) => {
        if (!n) return
        onSelect(n.message.id)
        // Keep the newly selected row in view within the page scroll.
        requestAnimationFrame(() => {
          document
            .querySelector(`[role="treeitem"][data-id="${CSS.escape(n.message.id)}"]`)
            ?.scrollIntoView({ block: 'nearest' })
        })
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          select(idx === -1 ? visibleList[0] : visibleList[idx + 1])
          break
        case 'ArrowUp':
          e.preventDefault()
          select(idx === -1 ? visibleList[visibleList.length - 1] : visibleList[idx - 1])
          break
        case 'ArrowRight': {
          e.preventDefault()
          if (!current) {
            select(visibleList[0])
            break
          }
          if (current.children.length === 0) break
          // Only forks fold, so only a fork can need re-opening here.
          if (current.children.length > 1 && collapsed.has(current.message.id)) {
            toggle(current.message.id)
            break
          }
          const first = current.children[0]
          // Descending into a fork: re-open the branch group if it was folded.
          if (current.children.length > 1 && collapsed.has(`branch:${first.message.id}`)) {
            toggle(`branch:${first.message.id}`)
          }
          select(first)
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          if (!current) {
            select(visibleList[0])
            break
          }
          // Fold the fork itself when sitting on one and it's open.
          if (current.children.length > 1 && !collapsed.has(current.message.id)) {
            toggle(current.message.id)
            break
          }
          const pid = parentOf.get(current.message.id)
          // At the head of a branch, collapsing folds the whole branch group and
          // returns focus to the fork point, so the sibling branches stay visible.
          if (branchRoots.has(current.message.id) && pid) {
            toggle(`branch:${current.message.id}`)
            select(visibleList.find((n) => n.message.id === pid))
            break
          }
          if (pid) select(visibleList.find((n) => n.message.id === pid))
          break
        }
        case 'Enter':
          e.preventDefault()
          if (current) select(current)
          else select(visibleList[0])
          break
        case ' ':
          e.preventDefault()
          if (current && current.children.length > 1) toggle(current.message.id)
          break
        case 'Home':
          e.preventDefault()
          select(visibleList[0])
          break
        case 'End':
          e.preventDefault()
          select(visibleList[visibleList.length - 1])
          break
        case '*':
          e.preventDefault()
          setCollapsed(new Set())
          break
      }
    },
    [visibleList, selectedId, collapsed, parentOf, branchRoots, onSelect],
  )

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border bg-background px-2 py-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages…"
            className="h-6 rounded-none pl-6 text-xs md:text-xs"
          />
        </div>
        <ToggleGroup
          type="multiple"
          value={roleFilter}
          onValueChange={setRoleFilter}
          className="gap-0 rounded-none"
        >
          {ROLE_FILTERS.map((r) => (
            <ToggleGroupItem
              key={r}
              value={r}
              className="h-6 rounded-none border border-border px-1.5 font-mono text-[10px]"
            >
              {r}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={onlyTools ? 'secondary' : 'ghost'}
              size="icon"
              className="size-6 rounded-none"
              onClick={() => setOnlyTools((v) => !v)}
            >
              <Wrench className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Only messages with tool calls</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={onlyErrors ? 'secondary' : 'ghost'}
              size="icon"
              className="size-6 rounded-none"
              onClick={() => setOnlyErrors((v) => !v)}
            >
              <AlertCircle className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Only messages with errors</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="h-4" />
        {errorMessages.length > 0 && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-none"
                  onClick={() => jumpError(-1)}
                >
                  <ChevronUp className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous error</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-none"
                  onClick={() => jumpError(1)}
                >
                  <ChevronDown className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next error ({errorMessages.length})</TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="h-4" />
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 rounded-none"
              onClick={() => setCollapsed(new Set())}
            >
              <UnfoldVertical className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Expand all</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 rounded-none"
              onClick={collapseAll}
            >
              <FoldVertical className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Collapse all</TooltipContent>
        </Tooltip>
      </div>

      <div
        role="tree"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Conversation tree"
        className="py-1 outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {visibleRoots.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No messages match the current filters.
          </div>
        ) : (
          visibleRoots.map((root) => (
            <MessageTreeNode
              key={root.message.id}
              node={root}
              selectedId={selectedId}
              collapsed={collapsed}
              onSelect={onSelect}
              onToggle={toggle}
              displayOrdinals={displayOrdinals}
            />
          ))
        )}
      </div>
    </div>
  )
}
