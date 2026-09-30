import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  FilePlus,
  FileMinus,
  FilePen,
  FileSymlink,
  Terminal,
  ArrowRight,
} from 'lucide-react'
import { messageDisplayId, formatSyntheticId } from '@/lib/displayId'
import { estimateMessageTokens } from '@/lib/tokens'
import { JsonViewer } from '@/components/JsonViewer'
import { Markdown, PlainText, RichValue } from '@/components/MarkdownView'
import { looksLikeMarkdown } from '@/lib/text'
import { DiffViewer, BeforeAfter } from '@/components/DiffViewer'
import { EventTimeline } from '@/components/EventTimeline'
import type {
  CommandExecution,
  FileChange,
  StateChange,
  ToolCall,
  TraceMessage,
} from '@/types/trace'

/* ---------- small helpers ---------- */

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 rounded-none"
          onClick={() => {
            void navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : (label ?? 'Copy')}</TooltipContent>
    </Tooltip>
  )
}

function Field({
  name,
  value,
  mono = true,
  copyable = false,
  copyValue,
}: {
  name: string
  value: string | number | undefined | null
  mono?: boolean
  copyable?: boolean
  copyValue?: string
}) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex items-baseline gap-2 border-b border-border/60 py-1 text-xs last:border-b-0">
      <span className="w-32 shrink-0 text-muted-foreground">{name}</span>
      <span className={`min-w-0 break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
      {copyable && <CopyButton text={copyValue ?? String(value)} label={`Copy ${name}`} />}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground first:mt-0">
      {children}
    </div>
  )
}

/* ---------- content rendering ---------- */

/** A content block that carries only text (Anthropic `text` or OpenAI text part). */
function isTextBlock(block: unknown): boolean {
  if (typeof block === 'string') return true
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return false
  const b = block as Record<string, unknown>
  // Forge text blocks carry no `type` — just `{ text }`.
  if (b.type === undefined) return typeof b.text === 'string' && Object.keys(b).length === 1
  if (b.type !== 'text') return false
  return typeof b.text === 'string' || typeof b.value === 'string'
}

function ContentView({ message }: { message: TraceMessage }) {
  const { content, contentText } = message
  const [mode, setMode] = useState<'auto' | 'structured' | 'raw'>('auto')

  if (content === undefined && !contentText) {
    return <div className="py-3 text-xs text-muted-foreground">No content.</div>
  }

  const isStructured = content !== null && typeof content === 'object'
  // Structured content that carries nothing but text blocks is better shown as
  // prose — the JSON tree just escapes the newlines and hides the markdown.
  const textOnly =
    isStructured &&
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((b) => isTextBlock(b)) &&
    contentText.length > 0
  const showAsProse = !isStructured || textOnly
  const md = showAsProse && looksLikeMarkdown(contentText)

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <Button
          variant={mode === 'auto' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 rounded-none px-2 text-[11px]"
          onClick={() => setMode('auto')}
        >
          {showAsProse ? (md ? 'markdown' : 'text') : 'structured'}
        </Button>
        {textOnly && (
          <Button
            variant={mode === 'structured' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 rounded-none px-2 text-[11px]"
            onClick={() => setMode('structured')}
          >
            structured
          </Button>
        )}
        <Button
          variant={mode === 'raw' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 rounded-none px-2 text-[11px]"
          onClick={() => setMode('raw')}
        >
          raw
        </Button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {contentText.length.toLocaleString()} chars
        </span>
        <CopyButton text={contentText} label="Copy content" />
      </div>

      {mode === 'structured' ? (
        <JsonViewer value={content!} label="content" />
      ) : mode === 'raw' ? (
        content !== undefined && isStructured && !textOnly ? (
          <JsonViewer value={content} label="content" />
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-border bg-muted/20 p-2 font-mono text-xs leading-5">
            {contentText}
          </pre>
        )
      ) : !showAsProse ? (
        <JsonViewer value={content!} label="content" />
      ) : md ? (
        <Markdown text={contentText} />
      ) : (
        <PlainText text={contentText} />
      )}
    </div>
  )
}

/* ---------- tool calls ---------- */

function ToolCallRow({ call, index }: { call: ToolCall; index: number }) {
  const [open, setOpen] = useState(false)
  const statusColor =
    call.status === 'error'
      ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
      : call.status === 'pending'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 border-b border-border px-2 py-1 text-left text-xs hover:bg-muted/50 data-[state=open]:bg-muted/40">
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="w-6 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
          {index + 1}
        </span>
        <span className="font-mono font-medium">{call.name}</span>
        {call.status && (
          <Badge
            variant="secondary"
            className={`rounded-none px-1 py-0 font-mono text-[10px] font-normal ${statusColor}`}
          >
            {call.status}
          </Badge>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {call.durationMs !== undefined && <span>{call.durationMs}ms</span>}
          {call.id && <span>{call.id}</span>}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-b border-border bg-muted/20 p-2">
        {call.args !== undefined && <JsonViewer value={call.args} label="arguments" />}
        {call.result !== undefined && <RichValue value={call.result} label="result" />}
        {call.args === undefined && call.result === undefined && (
          <JsonViewer value={call.raw} label="raw" />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/* ---------- changes ---------- */

const FILE_KIND_META = {
  created: { icon: FilePlus, cls: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  modified: { icon: FilePen, cls: 'text-blue-600', badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  deleted: { icon: FileMinus, cls: 'text-red-600', badge: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' },
  renamed: { icon: FileSymlink, cls: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
} as const

function FileChangeRow({ change }: { change: FileChange }) {
  const [open, setOpen] = useState(false)
  const meta = FILE_KIND_META[change.kind]
  const Icon = meta.icon
  const hasDetail = !!(change.diff || change.before !== undefined || change.after !== undefined)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex w-full items-center gap-1 border-b border-border pr-1 hover:bg-muted/50 data-[state=open]:bg-muted/40">
        <CollapsibleTrigger
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs"
          disabled={!hasDetail}
        >
          {hasDetail ? (
            open ? (
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <Icon className={`size-3.5 shrink-0 ${meta.cls}`} />
          <Badge
            variant="secondary"
            className={`w-16 justify-center rounded-none px-1 py-0 font-mono text-[10px] font-normal ${meta.badge}`}
          >
            {change.kind}
          </Badge>
          <span className="truncate font-mono">
            {change.oldPath ? (
              <>
                {change.oldPath} <ArrowRight className="inline size-3" /> {change.path}
              </>
            ) : (
              change.path
            )}
          </span>
        </CollapsibleTrigger>
        <CopyButton text={change.path} label="Copy path" />
      </div>
      {hasDetail && (
        <CollapsibleContent className="border-b border-border bg-muted/20 p-2">
          {change.diff ? (
            <DiffViewer diff={change.diff} />
          ) : (
            <BeforeAfter before={change.before} after={change.after} />
          )}
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

function CommandRow({ cmd }: { cmd: CommandExecution }) {
  const [open, setOpen] = useState(false)
  const failed = cmd.exitCode !== undefined && cmd.exitCode !== 0
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 border-b border-border px-2 py-1 text-left text-xs hover:bg-muted/50 data-[state=open]:bg-muted/40">
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono">{cmd.command}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px]">
          {cmd.durationMs !== undefined && (
            <span className="text-muted-foreground">{cmd.durationMs}ms</span>
          )}
          {cmd.exitCode !== undefined && (
            <Badge
              variant="secondary"
              className={`rounded-none px-1 py-0 font-mono text-[10px] font-normal ${
                failed
                  ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              exit {cmd.exitCode}
            </Badge>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-b border-border bg-muted/20 p-2">
        {cmd.output !== undefined ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-border bg-background p-2 font-mono text-xs leading-5">
            {cmd.output}
          </pre>
        ) : (
          <JsonViewer value={cmd.raw} label="raw" />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function StateChangeRow({ change }: { change: StateChange }) {
  const fmt = (v: unknown) =>
    v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v)
  return (
    <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
      <span className="shrink-0 font-mono font-medium">{change.key}</span>
      <span className="truncate font-mono text-red-700 line-through decoration-red-300 dark:text-red-400">
        {fmt(change.before)}
      </span>
      <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-emerald-700 dark:text-emerald-400">
        {fmt(change.after)}
      </span>
    </div>
  )
}

function ChangesView({ message }: { message: TraceMessage }) {
  const { fileChanges, commands, stateChanges } = message
  const empty = fileChanges.length === 0 && commands.length === 0 && stateChanges.length === 0
  if (empty) {
    return (
      <div className="py-3 text-xs text-muted-foreground">
        No file changes, commands, or state changes recorded for this message.
      </div>
    )
  }
  return (
    <div>
      {fileChanges.length > 0 && (
        <>
          <SectionHeading>Files ({fileChanges.length})</SectionHeading>
          <div className="border border-border">
            {fileChanges.map((c, i) => (
              <FileChangeRow key={i} change={c} />
            ))}
          </div>
        </>
      )}
      {commands.length > 0 && (
        <>
          <SectionHeading>Commands ({commands.length})</SectionHeading>
          <div className="border border-border">
            {commands.map((c, i) => (
              <CommandRow key={i} cmd={c} />
            ))}
          </div>
        </>
      )}
      {stateChanges.length > 0 && (
        <>
          <SectionHeading>State ({stateChanges.length})</SectionHeading>
          <div className="border border-border">
            {stateChanges.map((c, i) => (
              <StateChangeRow key={i} change={c} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- inspector ---------- */

export function MessageInspector({
  message,
  displayOrdinals,
}: {
  message: TraceMessage | null
  displayOrdinals?: ReadonlyMap<string, number>
}) {
  const rawValue = useMemo(
    () =>
      message
        ? message.raw.length === 1
          ? message.raw[0].data
          : message.raw.map((r) => r.data)
        : null,
    [message],
  )

  if (!message) {
    return (
      <div className="flex h-full items-center justify-center py-24 text-xs text-muted-foreground">
        Select a message in the tree to inspect it.
      </div>
    )
  }

  const activityCount =
    message.events.length > 0 ? message.events.length : message.toolCalls.length
  const changesCount =
    message.fileChanges.length + message.commands.length + message.stateChanges.length

  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs font-medium">{messageDisplayId(message, displayOrdinals?.get(message.id))}</span>
        <CopyButton text={message.id} label="Copy message ID" />
        <Badge variant="secondary" className="rounded-none px-1 py-0 font-mono text-[10px] font-normal">
          {message.role}
        </Badge>
        {message.errors.length > 0 && (
          <Badge
            variant="secondary"
            className="rounded-none bg-red-50 px-1 py-0 font-mono text-[10px] font-normal text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {message.errors.length} error{message.errors.length > 1 ? 's' : ''}
          </Badge>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          L{message.raw.map((r) => r.line).join(', L')}
        </span>
      </div>

      {message.errors.length > 0 && (
        <div className="mb-2 border border-red-200 bg-red-50/60 px-2 py-1 dark:border-red-900 dark:bg-red-950/40">
          {message.errors.map((e, i) => (
            <div key={i} className="font-mono text-[11px] text-red-700 dark:text-red-300">
              {e}
            </div>
          ))}
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="h-7 w-full justify-start rounded-none border border-border bg-muted/40 p-0">
          {(
            [
              ['overview', 'Overview', null],
              ['content', 'Content', null],
              ['activity', 'Activity', activityCount],
              ['changes', 'Changes', changesCount],
              ['raw', 'Raw', null],
            ] as const
          ).map(([value, label, count]) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-full rounded-none border-r border-border px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-none"
            >
              {label}
              {count !== null && count > 0 && (
                <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-2">
          <div className="border border-border px-2 py-1">
            <Field
              name="message id"
              value={messageDisplayId(message, displayOrdinals?.get(message.id))}
              copyValue={message.id}
              copyable
            />
            <Field
              name="parent id"
              value={
                message.parentId
                  ? formatSyntheticId(message.parentId, displayOrdinals?.get(message.parentId))
                  : message.parentId
              }
              copyValue={message.parentId ?? undefined}
              copyable
            />
            <Field name="conversation id" value={message.conversationId} copyable />
            <Field name="role" value={message.role} />
            <Field name="timestamp" value={message.timestamp} />
            <Field name="model" value={message.model} />
            <Field
              name="duration"
              value={message.durationMs !== undefined ? `${message.durationMs}ms` : undefined}
            />
            <Field
              name="tokens"
              value={
                message.tokens
                  ? [
                      message.tokens.input !== undefined ? `in ${message.tokens.input}` : null,
                      message.tokens.output !== undefined ? `out ${message.tokens.output}` : null,
                      message.tokens.total !== undefined ? `total ${message.tokens.total}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : `~${estimateMessageTokens(message).toLocaleString()} (estimated — trace reports no usage)`
              }
            />
            <Field name="status" value={message.status} />
            <Field name="source line" value={message.raw.map((r) => `L${r.line}`).join(', ')} />
            {message.syntheticId && (
              <Field
                name="note"
                value={`ordinal id synthesized by the debugger (raw: ${message.id}) — no explicit id in trace`}
                mono={false}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="content" className="mt-2">
          <ContentView message={message} />
        </TabsContent>

        <TabsContent value="activity" className="mt-2">
          {message.toolCalls.length > 0 && (
            <>
              <SectionHeading>Tool calls ({message.toolCalls.length})</SectionHeading>
              <div className="mb-2 border border-border">
                {message.toolCalls.map((tc, i) => (
                  <ToolCallRow key={i} call={tc} index={i} />
                ))}
              </div>
            </>
          )}
          <SectionHeading>Event timeline ({message.events.length})</SectionHeading>
          <EventTimeline events={message.events} />
        </TabsContent>

        <TabsContent value="changes" className="mt-2">
          <ChangesView message={message} />
        </TabsContent>

        <TabsContent value="raw" className="mt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground">
              {message.raw.length} record{message.raw.length > 1 ? 's' : ''} ·{' '}
              {message.raw.map((r) => `line ${r.line}`).join(', ')}
            </span>
            <Separator className="hidden" />
          </div>
          {rawValue !== null && <JsonViewer value={rawValue} label="raw records" />}
        </TabsContent>
      </Tabs>
    </div>
  )
}
