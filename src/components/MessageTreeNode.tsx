import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ChevronRight,
  ChevronDown,
  Wrench,
  AlertCircle,
  GitBranch,
  FileDiff,
} from 'lucide-react'
import { messageDisplayId } from '@/lib/displayId'
import { formatTokens, messageTokens } from '@/lib/tokens'
import type { MessageRole, TreeNode } from '@/types/trace'

const ROLE_STYLES: Record<MessageRole, string> = {
  user: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  assistant: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  system: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  tool: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  unknown: 'bg-muted text-muted-foreground',
}

function shortTime(ts?: string): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.length > 12 ? ts.slice(0, 12) : ts
  return d.toISOString().slice(11, 19)
}

interface MessageTreeNodeProps {
  node: TreeNode
  selectedId: string | null
  collapsed: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  /**
   * Visual indent level. Unlike the structural `depth`, this only increases
   * when the tree actually forks, so long linear chains stay flat instead of
   * staircasing off the right edge on large conversations.
   */
  renderDepth?: number
  /** Palette slot for the branch rail this node belongs to (undefined = trunk). */
  branchColor?: number
  /** Synthetic display ordinals computed per root-to-leaf branch. */
  displayOrdinals: ReadonlyMap<string, number>
}

/** Cap the indent so even pathological fork nesting can't break the layout. */
const MAX_RENDER_DEPTH = 12

/** Per-branch rail colours, cycled by branch index. */
const BRANCH_RAILS = [
  'border-l-amber-400/70',
  'border-l-sky-400/70',
  'border-l-fuchsia-400/70',
  'border-l-lime-400/70',
]
const BRANCH_TEXT = [
  'text-amber-600 dark:text-amber-400',
  'text-sky-600 dark:text-sky-400',
  'text-fuchsia-600 dark:text-fuchsia-400',
  'text-lime-600 dark:text-lime-400',
]

/** Total messages contained in a subtree, used for branch summaries. */
function subtreeSize(node: TreeNode): number {
  return 1 + node.children.reduce((n, c) => n + subtreeSize(c), 0)
}

/** Approximate token weight of a subtree, for branch summaries. */
function subtreeTokens(node: TreeNode): number {
  return (
    messageTokens(node.message).count +
    node.children.reduce((n, c) => n + subtreeTokens(c), 0)
  )
}

/** Roles present in a subtree, for a compact branch descriptor. */
function subtreeShape(node: TreeNode): string {
  const counts = new Map<string, number>()
  const walk = (n: TreeNode) => {
    counts.set(n.message.role, (counts.get(n.message.role) ?? 0) + 1)
    n.children.forEach(walk)
  }
  walk(node)
  return [...counts.entries()].map(([r, c]) => `${c} ${r}`).join(' · ')
}

export function MessageTreeNode({
  node,
  selectedId,
  collapsed,
  onSelect,
  onToggle,
  renderDepth = 0,
  branchColor,
  displayOrdinals,
}: MessageTreeNodeProps) {
  const { message: m, children } = node
  const isSelected = selectedId === m.id
  const isCollapsed = collapsed.has(m.id)
  const hasFork = children.length > 1
  const time = shortTime(m.timestamp)
  const preview = m.contentText.replace(/\s+/g, ' ').trim()
  const tokens = messageTokens(m)

  return (
    <div>
      <div
        role="treeitem"
        data-id={m.id}
        aria-selected={isSelected}
        aria-expanded={hasFork ? !isCollapsed : undefined}
        onClick={(e) => {
          ;(e.currentTarget.closest('[role="tree"]') as HTMLElement | null)?.focus()
          onSelect(m.id)
        }}
        className={`group flex cursor-pointer items-center gap-1.5 border-l-2 py-0.5 pr-2 text-xs ${
          isSelected
            ? 'border-l-blue-500 bg-blue-50 dark:bg-blue-950/40'
            : branchColor !== undefined
              ? `${BRANCH_RAILS[branchColor % BRANCH_RAILS.length]} hover:bg-muted/60`
              : 'border-l-transparent hover:bg-muted/60'
        }`}
        style={{ paddingLeft: `${Math.min(renderDepth, MAX_RENDER_DEPTH) * 12 + 4}px` }}
      >
        {/* Only fork points are collapsible — a chevron on every row of a long
            linear chain is noise, and folding a single-child node would just
            hide the rest of the conversation for no structural reason. */}
        {hasFork ? (
          <button
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onToggle(m.id)
            }}
            aria-label={isCollapsed ? 'Expand branches' : 'Collapse branches'}
          >
            {isCollapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        <Badge
          variant="secondary"
          className={`w-16 justify-center rounded-none px-1 py-0 font-mono text-[10px] font-normal ${ROLE_STYLES[m.role]}`}
        >
          {m.role}
        </Badge>

        <span
          className={`shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground ${
            m.syntheticId ? 'w-9 text-right text-muted-foreground/70' : ''
          }`}
          title={m.id}
        >
          {messageDisplayId(m, displayOrdinals.get(m.id))}
        </span>

        {time && <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{time}</span>}

        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {preview || (m.toolCalls.length > 0 ? `(${m.toolCalls.length} tool calls)` : '(no content)')}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1">
          {hasFork && (
            <Tooltip>
              <TooltipTrigger asChild>
                <GitBranch className="size-3 text-amber-600 dark:text-amber-400" />
              </TooltipTrigger>
              <TooltipContent>Fork: {children.length} branches</TooltipContent>
            </Tooltip>
          )}
          {m.toolCalls.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-0.5 font-mono text-[10px] text-blue-600 dark:text-blue-400">
                  <Wrench className="size-3" />
                  {m.toolCalls.length}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {m.toolCalls.map((tc) => tc.name).join(', ')}
              </TooltipContent>
            </Tooltip>
          )}
          {m.fileChanges.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <FileDiff className="size-3 text-emerald-600 dark:text-emerald-400" />
              </TooltipTrigger>
              <TooltipContent>{m.fileChanges.length} file changes</TooltipContent>
            </Tooltip>
          )}
          {m.errors.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="size-3 text-red-600 dark:text-red-400" />
              </TooltipTrigger>
              <TooltipContent>{m.errors[0]}</TooltipContent>
            </Tooltip>
          )}
          {m.model && (
            <span className="hidden font-mono text-[10px] text-muted-foreground/60 xl:inline">
              {m.model}
            </span>
          )}

          {/* Token weight sits last so it forms a stable right-hand column,
              reading as `<model> <tokens>` on wide viewports. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`w-14 text-right font-mono text-[10px] tabular-nums ${
                  tokens.exact
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/60'
                }`}
              >
                {tokens.exact ? '' : '~'}
                {formatTokens(tokens.count)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {tokens.exact
                ? `${tokens.count.toLocaleString()} tokens (reported by trace)`
                : `~${tokens.count.toLocaleString()} tokens (estimated, ~4 chars/token)`}
            </TooltipContent>
          </Tooltip>
        </span>
      </div>

      {(!hasFork || !isCollapsed) &&
        children.map((child, i) => {
          // Linear chain: keep it flat and on the same rail as the parent.
          if (!hasFork) {
            return (
              <MessageTreeNode
                key={child.message.id}
                node={child}
                selectedId={selectedId}
                collapsed={collapsed}
                onSelect={onSelect}
                onToggle={onToggle}
                renderDepth={renderDepth}
                branchColor={branchColor}
                displayOrdinals={displayOrdinals}
              />
            )
          }

          // Fork: label each branch explicitly so a long branch doesn't read
          // as "the parent has 30 children".
          const color = branchColor === undefined ? i : branchColor + i
          const branchCollapsed = collapsed.has(`branch:${child.message.id}`)
          return (
            <div key={child.message.id}>
              <div
                role="presentation"
                onClick={() => onToggle(`branch:${child.message.id}`)}
                className={`flex cursor-pointer items-center gap-1.5 border-l-2 py-0.5 pr-2 select-none hover:bg-muted/40 ${
                  BRANCH_RAILS[color % BRANCH_RAILS.length]
                }`}
                style={{ paddingLeft: `${Math.min(renderDepth, MAX_RENDER_DEPTH) * 12 + 4}px` }}
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                  {branchCollapsed ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </span>
                <GitBranch
                  className={`size-3 shrink-0 ${BRANCH_TEXT[color % BRANCH_TEXT.length]}`}
                />
                <span
                  className={`shrink-0 font-mono text-[10px] font-medium ${
                    BRANCH_TEXT[color % BRANCH_TEXT.length]
                  }`}
                >
                  branch {i + 1}/{children.length}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {subtreeSize(child)} msg · ~{formatTokens(subtreeTokens(child))} tok
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground/60">
                  {subtreeShape(child)}
                </span>
              </div>

              {!branchCollapsed && (
                <MessageTreeNode
                  node={child}
                  selectedId={selectedId}
                  collapsed={collapsed}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  renderDepth={renderDepth + 1}
                  branchColor={color}
                  displayOrdinals={displayOrdinals}
                />
              )}
            </div>
          )
        })}
    </div>
  )
}
