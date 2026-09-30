import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useDefaultLayout } from 'react-resizable-panels'
import { Bug, X } from 'lucide-react'
import { ConversationSelector } from '@/components/ConversationSelector'
import { ConversationTree } from '@/components/ConversationTree'
import { FormatBadge } from '@/components/FormatBadge'
import { MessageInspector } from '@/components/MessageInspector'
import { TraceUploader } from '@/components/TraceUploader'
import { ThemeToggle } from '@/components/ThemeToggle'
import { TimeWindowSlider, type TimeWindowPoint } from '@/components/TimeWindowSlider'
import { buildBranchLocalOrdinals } from '@/lib/displayId'
import { estimateMessageTokens } from '@/lib/tokens'
import type { NormalizedTrace } from '@/types/trace'

function App() {
  const [trace, setTrace] = useState<NormalizedTrace | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [showParseErrors, setShowParseErrors] = useState(false)
  const [timeWindow, setTimeWindow] = useState<[number, number] | null>(null)

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'trace-debugger:split',
    storage: window.localStorage,
  })

  const onLoaded = useCallback((t: NormalizedTrace) => {
    setTrace(t)
    const first = t.conversations[0]?.id ?? null
    setConversationId(first)
    setSelectedMessageId(null)
    setShowParseErrors(false)
    setTimeWindow(null)
  }, [])

  const conversation = useMemo(
    () => trace?.conversations.find((c) => c.id === conversationId) ?? null,
    [trace, conversationId],
  )

  const selectedMessage = useMemo(
    () => conversation?.messages.find((m) => m.id === selectedMessageId) ?? null,
    [conversation, selectedMessageId],
  )

  const displayOrdinals = useMemo(
    () => (conversation ? buildBranchLocalOrdinals(conversation.roots) : new Map<string, number>()),
    [conversation],
  )

  const timeline = useMemo(() => {
    if (!conversation) return { points: [] as TimeWindowPoint[], usesTimestamps: false }
    const parsed = conversation.messages.map((message) => {
      if (!message.timestamp) return Number.NaN
      const numeric = Number(message.timestamp)
      return Number.isFinite(numeric) ? numeric : Date.parse(message.timestamp)
    })
    const usesTimestamps = parsed.every(Number.isFinite) && new Set(parsed).size > 1
    const points = conversation.messages.map((message, index) => ({
      id: message.id,
      timestamp: usesTimestamps ? parsed[index] : index,
      tokens: estimateMessageTokens(message),
      label: displayOrdinals.get(message.id) ? `#${displayOrdinals.get(message.id)}` : message.id,
      role: message.role,
    }))
    return { points, usesTimestamps }
  }, [conversation, displayOrdinals])

  const timelineBounds = useMemo<[number, number] | null>(() => {
    if (timeline.points.length === 0) return null
    const values = timeline.points.map((point) => point.timestamp)
    return [Math.min(...values), Math.max(...values)]
  }, [timeline.points])

  useEffect(() => {
    setTimeWindow(timelineBounds)
  }, [conversationId, timelineBounds])

  const windowMessageIds = useMemo(() => {
    if (!timeWindow) return undefined
    return new Set(
      timeline.points
        .filter((point) => point.timestamp >= timeWindow[0] && point.timestamp <= timeWindow[1])
        .map((point) => point.id),
    )
  }, [timeline.points, timeWindow])

  return (
    <TooltipProvider>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
          <Bug className="size-4" />
          <span className="text-xs font-semibold">Trace Debugger</span>
          <Separator orientation="vertical" className="h-4" />
          {trace && (
            <>
              <FormatBadge formatInfo={trace.formatInfo} />
              <ConversationSelector
                conversations={trace.conversations}
                selectedId={conversationId}
                onSelect={(id) => {
                  setConversationId(id)
                  setSelectedMessageId(null)
                  setTimeWindow(null)
                }}
              />
              <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                {trace.fileName} · {trace.recordCount} records / {trace.totalLines} lines
              </span>
              {trace.errors.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-none px-1.5 font-mono text-[10px] text-red-600 dark:text-red-400"
                  onClick={() => setShowParseErrors((v) => !v)}
                >
                  {trace.errors.length} parse error{trace.errors.length > 1 ? 's' : ''}
                </Button>
              )}
            </>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <TraceUploader onLoaded={onLoaded} compact />
            <ThemeToggle />
          </div>
        </header>

        {/* Parse errors panel */}
        {trace && showParseErrors && trace.errors.length > 0 && (
          <div className="shrink-0 border-b border-border bg-red-50 px-3 py-2 dark:bg-red-950/30">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-red-700 dark:text-red-300">
                Malformed lines ({trace.errors.length})
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-5 rounded-none"
                onClick={() => setShowParseErrors(false)}
              >
                <X className="size-3" />
              </Button>
            </div>
            <div className="flex flex-col gap-0.5">
              {trace.errors.map((e) => (
                <div key={e.line} className="font-mono text-[11px] text-red-700 dark:text-red-300">
                  <Badge variant="outline" className="mr-1.5 rounded-none px-1 font-mono text-[10px]">
                    L{e.line}
                  </Badge>
                  {e.message}
                  <span className="ml-1.5 text-red-400 dark:text-red-500">{e.snippet.slice(0, 120)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {conversation && timelineBounds && timeWindow && (
          <TimeWindowSlider
            points={timeline.points}
            value={timeWindow}
            onChange={setTimeWindow}
            usesTimestamps={timeline.usesTimestamps}
            selectedPointId={selectedMessageId}
          />
        )}

        {/* Main content */}
        {!trace ? (
          <main className="flex flex-col items-center px-4 pt-24">
            <TraceUploader onLoaded={onLoaded} />
          </main>
        ) : !conversation ? (
          <main className="px-4 py-12 text-center text-xs text-muted-foreground">
            No conversations detected in this trace.
          </main>
        ) : (
          <main className="min-h-0 flex-1 overflow-hidden">
            <ResizablePanelGroup
              orientation="horizontal"
              defaultLayout={defaultLayout}
              onLayoutChanged={onLayoutChanged}
              className="h-full"
            >
              <ResizablePanel
                id="tree"
                defaultSize="40%"
                minSize="20%"
                maxSize="75%"
                className="min-w-0 overflow-y-auto"
              >
                <ConversationTree
                  conversation={conversation}
                  selectedId={selectedMessageId}
                  onSelect={setSelectedMessageId}
                  windowMessageIds={windowMessageIds}
                />
              </ResizablePanel>
              <ResizableHandle
                withHandle
                className="transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 data-[resize-handle-state=drag]:bg-primary/60"
              />
              <ResizablePanel
                id="inspector"
                defaultSize="60%"
                minSize="25%"
                className="min-w-0 overflow-y-auto"
              >
                <MessageInspector message={selectedMessage} displayOrdinals={displayOrdinals} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>
        )}
      </div>
    </TooltipProvider>
  )
}

export default App
