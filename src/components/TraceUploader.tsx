import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Upload, FileJson } from 'lucide-react'
import { parseJsonl, readFileAsText } from '@/trace/parser'
import { normalizeTrace } from '@/trace/normalize'
import type { NormalizedTrace } from '@/types/trace'

interface TraceUploaderProps {
  onLoaded: (trace: NormalizedTrace) => void
  compact?: boolean
}

export function TraceUploader({ onLoaded, compact = false }: TraceUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true)
      setError(null)
      try {
        const text = await readFileAsText(file)
        const parsed = parseJsonl(text, file.name)
        if (parsed.records.length === 0 && parsed.errors.length > 0) {
          setError(`No valid JSON records found (${parsed.errors.length} malformed lines).`)
          return
        }
        if (parsed.records.length === 0) {
          setError('The file contains no JSON records.')
          return
        }
        onLoaded(normalizeTrace(parsed))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [onLoaded],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  const loadSample = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample-trace.jsonl`)
      if (!res.ok) throw new Error(`Failed to fetch sample trace (${res.status})`)
      const text = await res.text()
      onLoaded(normalizeTrace(parseJsonl(text, 'sample-trace.jsonl')))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [onLoaded])

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".jsonl,.ndjson,.json,.txt"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0]
        if (file) void handleFile(file)
        e.target.value = ''
      }}
    />
  )

  if (compact) {
    return (
      <>
        {input}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-none px-2 text-xs"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3" />
          {busy ? 'Parsing…' : 'Upload JSONL'}
        </Button>
      </>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {input}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex w-full max-w-lg cursor-pointer flex-col items-center gap-2 border border-dashed px-8 py-12 text-center transition-colors ${
          dragging ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/50'
        }`}
      >
        <FileJson className="size-8 text-muted-foreground" />
        <div className="text-sm">
          {busy ? 'Parsing…' : 'Drop a .jsonl trace file here, or click to browse'}
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          Parsed locally — nothing leaves your browser
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 rounded-none px-2 font-mono text-xs text-muted-foreground"
        disabled={busy}
        onClick={() => void loadSample()}
      >
        or load the sample trace
      </Button>
      {error && (
        <div className="border border-red-200 bg-red-50 px-3 py-1.5 font-mono text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}
