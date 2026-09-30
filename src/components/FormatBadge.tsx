import { Activity, Braces, Bot, FileQuestion, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { TraceFormat, TraceFormatInfo } from '@/types/trace'

/**
 * Which vendor message schema a trace format is built on. Drives the
 * lettermark and colour so the family is recognisable at a glance.
 */
export type FormatFamily = 'openai' | 'anthropic' | 'forge' | 'event' | 'unknown'

interface FamilyStyle {
  /** Short mark shown at the very left of the badge. */
  mark: string
  /** Family name shown next to the mark. */
  name: string
  icon: LucideIcon
  className: string
}

const FAMILY_STYLES: Record<FormatFamily, FamilyStyle> = {
  openai: {
    mark: 'OAI',
    name: 'OpenAI',
    icon: Braces,
    className:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300',
  },
  anthropic: {
    mark: 'ANT',
    name: 'Anthropic',
    icon: Sparkles,
    className:
      'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:border-orange-400/40 dark:bg-orange-400/10 dark:text-orange-300',
  },
  forge: {
    mark: 'FRG',
    name: 'Forge',
    icon: Bot,
    className:
      'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-300',
  },
  event: {
    mark: 'EVT',
    name: 'Events',
    icon: Activity,
    className:
      'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300',
  },
  unknown: {
    mark: '?',
    name: 'Unknown',
    icon: FileQuestion,
    className: 'border-border bg-muted text-muted-foreground',
  },
}

export function formatFamily(format: TraceFormat): FormatFamily {
  switch (format) {
    case 'openai-chat':
      return 'openai'
    case 'anthropic-messages':
      return 'anthropic'
    case 'forge-http-trace':
      return 'forge'
    case 'event-log':
      return 'event'
    default:
      return 'unknown'
  }
}

interface FormatBadgeProps {
  formatInfo: TraceFormatInfo
  className?: string
}

/**
 * Top-level "logo" for the loaded trace: a coloured lettermark identifying
 * the message schema family (OpenAI vs Anthropic vs other) plus the precise
 * detected format. The detail string is available on hover.
 */
export function FormatBadge({ formatInfo, className }: FormatBadgeProps) {
  const family = formatFamily(formatInfo.format)
  const style = FAMILY_STYLES[family]
  const Icon = style.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          role="img"
          tabIndex={0}
          className={cn('rounded-sm px-1.5 font-mono text-[10px] font-semibold', style.className, className)}
          aria-label={`Input format: ${style.name} — ${formatInfo.label}. ${formatInfo.detail}`}
        >
          <Icon aria-hidden />
          <span className="tracking-wide">{style.mark}</span>
          <span className="font-normal opacity-80">{formatInfo.label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start">
        <span className="font-medium">
          {style.name} · {formatInfo.label}
        </span>
        <span className="opacity-80">{formatInfo.detail}</span>
      </TooltipContent>
    </Tooltip>
  )
}
