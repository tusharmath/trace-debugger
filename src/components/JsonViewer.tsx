import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react'
import type { JsonValue } from '@/types/trace'

/** DevTools-style collapsible JSON tree viewer. */

function valueColor(v: JsonValue): string {
  if (v === null) return 'text-muted-foreground'
  switch (typeof v) {
    case 'string':
      return 'text-emerald-700 dark:text-emerald-400'
    case 'number':
      return 'text-blue-700 dark:text-blue-400'
    case 'boolean':
      return 'text-purple-700 dark:text-purple-400'
    default:
      return 'text-foreground'
  }
}

function previewValue(v: JsonValue): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 60) + '…' : v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `Array(${v.length})`
  return `{${Object.keys(v).slice(0, 3).join(', ')}${Object.keys(v).length > 3 ? ', …' : ''}}`
}

function JsonNode({
  name,
  value,
  depth,
  defaultOpen,
}: {
  name: string | null
  value: JsonValue
  depth: number
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isComplex = value !== null && typeof value === 'object'
  const entries = useMemo<[string, JsonValue][]>(() => {
    if (!isComplex) return []
    return Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as [string, JsonValue])
      : Object.entries(value)
  }, [value, isComplex])

  const indent = { paddingLeft: `${depth * 14}px` }

  if (!isComplex) {
    return (
      <div className="flex items-start gap-1 py-px leading-5 hover:bg-muted/50" style={indent}>
        <span className="w-3.5 shrink-0" />
        {name !== null && <span className="shrink-0 text-sky-800 dark:text-sky-300">{name}:</span>}
        <span className={`whitespace-pre-wrap break-all ${valueColor(value)}`}>
          {typeof value === 'string' ? JSON.stringify(value) : String(value)}
        </span>
      </div>
    )
  }

  const bracket = Array.isArray(value) ? `Array(${entries.length})` : `Object`
  return (
    <div>
      <div
        className="flex cursor-pointer items-start gap-1 py-px leading-5 hover:bg-muted/50"
        style={indent}
        onClick={() => setOpen(!open)}
      >
        <span className="w-3.5 shrink-0 text-muted-foreground">
          {entries.length > 0 ? (
            open ? <ChevronDown className="mt-0.5 size-3.5" /> : <ChevronRight className="mt-0.5 size-3.5" />
          ) : null}
        </span>
        {name !== null && <span className="shrink-0 text-sky-800 dark:text-sky-300">{name}:</span>}
        <span className="text-muted-foreground">
          {open ? bracket : previewValue(value)}
        </span>
      </div>
      {open &&
        entries.map(([k, v]) => (
          <JsonNode key={k} name={k} value={v} depth={depth + 1} defaultOpen={depth < 1} />
        ))}
    </div>
  )
}

export function JsonViewer({ value, label }: { value: JsonValue; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(JSON.stringify(value, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div className="border border-border bg-muted/20">
      <div className="flex h-7 items-center justify-between border-b border-border bg-muted/40 pl-2">
        <span className="font-mono text-[11px] text-muted-foreground">{label ?? 'JSON'}</span>
        <Button variant="ghost" size="sm" className="h-6 rounded-none px-2 text-[11px]" onClick={copy}>
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'copied' : 'copy'}
        </Button>
      </div>
      <div className="overflow-x-auto p-1.5 font-mono text-xs">
        <JsonNode name={null} value={value} depth={0} defaultOpen />
      </div>
    </div>
  )
}
