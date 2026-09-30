import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTokens } from '@/lib/tokens'
import type { MessageRole } from '@/types/trace'

export interface TimeWindowPoint {
  id: string
  timestamp: number
  tokens: number
  label: string
  role: MessageRole
}

interface TimeWindowSliderProps {
  points: TimeWindowPoint[]
  value: [number, number]
  onChange: (value: [number, number]) => void
  usesTimestamps: boolean
  selectedPointId?: string | null
}

function formatAbsoluteTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(new Date(value))
}

function formatElapsed(value: number) {
  if (value < 1_000) return `${Math.round(value)} ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`
  if (value < 3_600_000) return `${(value / 60_000).toFixed(value < 600_000 ? 1 : 0)} min`
  return `${(value / 3_600_000).toFixed(1)} hr`
}

function formatPointTime(value: number, min: number, usesTimestamps: boolean) {
  return usesTimestamps ? `${formatAbsoluteTime(value)} (+${formatElapsed(value - min)})` : `message ${Math.round(value) + 1}`
}

const roleBarClasses: Record<MessageRole, string> = {
  system: 'bg-violet-500/85 dark:bg-violet-400/80',
  user: 'bg-blue-500/85 dark:bg-blue-400/80',
  assistant: 'bg-emerald-500/85 dark:bg-emerald-400/80',
  tool: 'bg-amber-500/85 dark:bg-amber-400/80',
  unknown: 'bg-zinc-500/80 dark:bg-zinc-400/70',
}

const roleLegendClasses: Record<MessageRole, string> = {
  system: 'bg-violet-500 dark:bg-violet-400',
  user: 'bg-blue-500 dark:bg-blue-400',
  assistant: 'bg-emerald-500 dark:bg-emerald-400',
  tool: 'bg-amber-500 dark:bg-amber-400',
  unknown: 'bg-zinc-500 dark:bg-zinc-400',
}

export function TimeWindowSlider({
  points,
  value,
  onChange,
  usesTimestamps,
  selectedPointId,
}: TimeWindowSliderProps) {
  const bounds = useMemo(() => {
    const timestamps = points.map((point) => point.timestamp)
    const min = timestamps.length ? Math.min(...timestamps) : 0
    const max = timestamps.length ? Math.max(...timestamps) : 0
    return {
      min,
      max,
      span: Math.max(1, max - min),
      maxTokens: Math.max(1, ...points.map((point) => point.tokens)),
    }
  }, [points])

  const ticks = useMemo(
    () => Array.from({ length: 11 }, (_, index) => ({
      ratio: index / 10,
      value: bounds.min + bounds.span * (index / 10),
    })),
    [bounds.min, bounds.span],
  )

  const barLayouts = useMemo(() => {
    const sorted = points
      .map((point, originalIndex) => ({ point, originalIndex }))
      .sort((a, b) => a.point.timestamp - b.point.timestamp || a.originalIndex - b.originalIndex)
    const groups: Array<typeof sorted> = []

    for (const item of sorted) {
      const last = groups.at(-1)
      if (last?.[0].point.timestamp === item.point.timestamp) last.push(item)
      else groups.push([item])
    }

    return groups.flatMap((group, groupIndex) => {
      const center = (group[0].point.timestamp - bounds.min) / bounds.span
      const previousCenter = groupIndex === 0
        ? 0
        : (groups[groupIndex - 1][0].point.timestamp - bounds.min) / bounds.span
      const nextCenter = groupIndex === groups.length - 1
        ? 1
        : (groups[groupIndex + 1][0].point.timestamp - bounds.min) / bounds.span
      const left = groupIndex === 0 ? 0 : (previousCenter + center) / 2
      const right = groupIndex === groups.length - 1 ? 1 : (center + nextCenter) / 2
      const cellWidth = (right - left) / group.length

      return group.map((item, itemIndex) => ({
        point: item.point,
        left: (left + itemIndex * cellWidth) * 100,
        width: cellWidth * 100,
      }))
    })
  }, [bounds.min, bounds.span, points])

  const chartRef = useRef<HTMLDivElement>(null)
  const dragAnchor = useRef<number | null>(null)

  if (points.length === 0) return null

  const selectedPoints = points.filter(
    (point) => point.timestamp >= value[0] && point.timestamp <= value[1],
  )
  const selectedCount = selectedPoints.length
  const rolePercentages = selectedPoints.reduce<Partial<Record<MessageRole, number>>>((totals, point) => {
    totals[point.role] = (totals[point.role] ?? 0) + 1
    return totals
  }, {})
  const fullRange = value[0] === bounds.min && value[1] === bounds.max
  const position = (timestamp: number) => ((timestamp - bounds.min) / bounds.span) * 100
  const start = position(value[0])
  const end = position(value[1])
  const step = usesTimestamps ? Math.max(1, bounds.span / 1000) : 1
  const valueAtClientX = (clientX: number) => {
    const rect = chartRef.current?.getBoundingClientRect()
    if (!rect) return bounds.min
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = bounds.min + ratio * bounds.span
    return usesTimestamps ? raw : Math.round(raw)
  }
  const updateDragWindow = (current: number) => {
    const anchor = dragAnchor.current
    if (anchor === null) return
    onChange([Math.min(anchor, current), Math.max(anchor, current)])
  }
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    const anchor = valueAtClientX(event.clientX)
    dragAnchor.current = anchor
    event.currentTarget.setPointerCapture(event.pointerId)
    onChange([anchor, anchor])
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragAnchor.current === null) return
    event.preventDefault()
    updateDragWindow(valueAtClientX(event.clientX))
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragAnchor.current === null) return
    updateDragWindow(valueAtClientX(event.clientX))
    dragAnchor.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const moveBoundary = (boundary: 'start' | 'end', direction: -1 | 1) => {
    const next: [number, number] = [...value]
    const index = boundary === 'start' ? 0 : 1
    next[index] = Math.max(bounds.min, Math.min(bounds.max, next[index] + direction * step))
    if (next[0] > next[1]) next[boundary === 'start' ? 1 : 0] = next[index]
    onChange(next)
  }

  return (
    <section className="shrink-0 border-b border-border bg-background" aria-label="Message time window">
      <div className="flex h-7 items-center gap-2 border-b border-border px-2 font-mono text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide text-foreground">Window</span>
        <span className="tabular-nums">
          {formatPointTime(value[0], bounds.min, usesTimestamps)} — {formatPointTime(value[1], bounds.min, usesTimestamps)}
        </span>
        <div className="ml-auto flex items-center gap-2" aria-label="Message role colors">
          {(['system', 'user', 'assistant', 'tool'] as const).map((role) => {
            const count = rolePercentages[role] ?? 0
            const percentage = selectedCount > 0 ? (count / selectedCount) * 100 : 0
            return (
              <span
                key={role}
                className="flex items-center gap-1"
                title={`${count} ${role} message${count === 1 ? '' : 's'} (${percentage.toFixed(1)}% of window)`}
              >
                <span className={`size-1.5 ${roleLegendClasses[role]}`} />
                <span>{role}</span>
                <span className="tabular-nums text-foreground">{percentage.toFixed(1)}%</span>
              </span>
            )
          })}
        </div>
        <span className="tabular-nums">{selectedCount} / {points.length} messages</span>
        {!usesTimestamps && <span className="text-amber-600 dark:text-amber-400">sequence fallback</span>}
        {!fullRange && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-5 rounded-none"
                aria-label="Reset message window"
                onClick={() => onChange([bounds.min, bounds.max])}
              >
                <RotateCcw className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset window</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div
        ref={chartRef}
        className="relative h-[86px] cursor-crosshair select-none overflow-hidden bg-muted/20 touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragAnchor.current = null }}
      >
        {/* Timeline ruler and grid */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-5 border-b border-border bg-background/85">
          {ticks.map((tick, index) => (
            <div
              key={index}
              className="absolute bottom-0 top-0 border-l border-border/80"
              style={{ left: `${tick.ratio * 100}%` }}
            >
              <span
                className={index === 0 ? 'absolute left-1 top-0.5 whitespace-nowrap font-mono text-[9px] text-muted-foreground' : index === ticks.length - 1 ? 'absolute right-1 top-0.5 whitespace-nowrap font-mono text-[9px] text-muted-foreground' : 'absolute left-1/2 top-0.5 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-muted-foreground'}
              >
                {usesTimestamps ? formatElapsed(tick.value - bounds.min) : `#${Math.round(tick.value) + 1}`}
              </span>
            </div>
          ))}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-5">
          {ticks.map((tick, index) => (
            <span
              key={index}
              className="absolute bottom-0 top-0 border-l border-border/50"
              style={{ left: `${tick.ratio * 100}%` }}
            />
          ))}
        </div>

        {/* One bar per message, with height proportional to token count. */}
        <div className="absolute inset-x-0 bottom-1 top-6 overflow-hidden">
          {barLayouts.map(({ point, left, width }) => (
            <Tooltip key={point.id}>
              <TooltipTrigger asChild>
                <span
                  data-time-window-bar
                  data-selected={point.id === selectedPointId ? 'true' : undefined}
                  aria-current={point.id === selectedPointId ? 'true' : undefined}
                  className={`absolute bottom-0 border-r border-background/50 ${roleBarClasses[point.role]} ${
                    point.id === selectedPointId
                      ? 'z-30 brightness-125 outline outline-2 outline-offset-1 outline-sky-400 drop-shadow-[0_0_5px_rgba(56,189,248,0.9)]'
                      : 'z-10'
                  }`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    height: `${Math.max(4, (point.tokens / bounds.maxTokens) * 54)}px`,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent className="font-mono text-[10px]">
                {point.label} · {point.role} · ~{formatTokens(point.tokens)} tokens · {formatPointTime(point.timestamp, bounds.min, usesTimestamps)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* DevTools-style window overlay: selected area is tinted, excluded areas are shaded. */}
        <div
          className="pointer-events-none absolute bottom-0 top-5 z-20 border-y border-sky-500/70 bg-sky-500/20 dark:bg-sky-400/20"
          style={{ left: `${start}%`, right: `${100 - end}%` }}
        />
        <div className="pointer-events-none absolute bottom-0 left-0 top-5 z-20 bg-background/70" style={{ width: `${start}%` }} />
        <div className="pointer-events-none absolute bottom-0 right-0 top-5 z-20 bg-background/70" style={{ width: `${100 - end}%` }} />

        {(['start', 'end'] as const).map((boundary) => {
          const index = boundary === 'start' ? 0 : 1
          return (
            <div
              key={boundary}
              role="slider"
              tabIndex={0}
              aria-label={`${boundary} of message time window`}
              aria-valuemin={bounds.min}
              aria-valuemax={bounds.max}
              aria-valuenow={value[index]}
              aria-valuetext={formatPointTime(value[index], bounds.min, usesTimestamps)}
              className="pointer-events-none absolute bottom-0 top-5 z-30 w-0 border-l-2 border-sky-500 outline-none focus:border-sky-300"
              style={{ left: `${position(value[index])}%` }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveBoundary(boundary, -1)
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  moveBoundary(boundary, 1)
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  onChange(boundary === 'start' ? [bounds.min, value[1]] : [value[0], bounds.min])
                } else if (event.key === 'End') {
                  event.preventDefault()
                  onChange(boundary === 'start' ? [bounds.max, value[1]] : [value[0], bounds.max])
                }
              }}
            >
              <span className="absolute -left-1 top-0 h-3 w-2 rounded-b-sm border border-sky-400 bg-sky-600" />
            </div>
          )
        })}
      </div>
    </section>
  )
}
