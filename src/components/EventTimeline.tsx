import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { JsonViewer } from '@/components/JsonViewer'
import { RichValue } from '@/components/MarkdownView'
import type { TraceEvent, TraceEventKind } from '@/types/trace'

const KIND_STYLES: Record<TraceEventKind, string> = {
  tool_call: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  tool_result: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  reasoning: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  retry: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  error: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  file_change: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  command: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  state_change: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  artifact: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  generic: 'bg-muted text-muted-foreground',
}

function EventRow({ event, index }: { event: TraceEvent; index: number }) {
  const [open, setOpen] = useState(false)
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
        <Badge
          variant="secondary"
          className={`rounded-none px-1 py-0 font-mono text-[10px] font-normal ${KIND_STYLES[event.kind]}`}
        >
          {event.kind}
        </Badge>
        <span className="truncate font-mono">{event.label}</span>
        {event.detail && event.detail !== event.label && (
          <span className="truncate text-muted-foreground">{event.detail}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {event.timestamp && <span>{event.timestamp}</span>}
          {event.line !== undefined && <span>L{event.line}</span>}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-b border-border bg-muted/20 p-2">
        {event.kind === 'tool_result' ? (
          <RichValue value={event.raw} label="result" />
        ) : (
          <JsonViewer value={event.raw} label={`event[${index}]`} />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function EventTimeline({ events }: { events: TraceEvent[] }) {
  if (events.length === 0) {
    return <div className="px-2 py-3 text-xs text-muted-foreground">No events recorded.</div>
  }
  return (
    <div className="border border-border">
      {events.map((event, i) => (
        <EventRow key={i} event={event} index={i} />
      ))}
    </div>
  )
}
