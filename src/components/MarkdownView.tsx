import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { JsonViewer } from '@/components/JsonViewer'
import type { JsonValue } from '@/types/trace'
import { extractText, looksLikeMarkdown } from '@/lib/text'

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none border border-border p-3 text-sm [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/30 [&_pre]:p-2 [&_pre]:text-xs">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  )
}

export function PlainText({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-border bg-muted/20 p-2 font-mono text-xs leading-5">
      {text}
    </pre>
  )
}

type Mode = 'md' | 'raw'

/**
 * Renders an arbitrary value with a markdown/raw toggle.
 * Falls back to the JSON tree when there is no extractable text.
 */
export function RichValue({
  value,
  label,
  defaultMode,
}: {
  value: JsonValue
  label: string
  defaultMode?: Mode
}) {
  const text = extractText(value)
  const isStructured = value !== null && typeof value === 'object'
  const md = text !== null && looksLikeMarkdown(text)
  const [mode, setMode] = useState<Mode>(defaultMode ?? (md ? 'md' : 'raw'))

  if (text === null) return <JsonViewer value={value} label={label} />

  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Button
          variant={mode === 'md' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-5 rounded-none px-2 text-[10px]"
          onClick={() => setMode('md')}
        >
          markdown
        </Button>
        <Button
          variant={mode === 'raw' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-5 rounded-none px-2 text-[10px]"
          onClick={() => setMode('raw')}
        >
          raw
        </Button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {text.length.toLocaleString()} chars
        </span>
      </div>
      {mode === 'md' ? (
        <Markdown text={text} />
      ) : isStructured ? (
        <JsonViewer value={value} label={label} />
      ) : (
        <PlainText text={text} />
      )}
    </div>
  )
}
