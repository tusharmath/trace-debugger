/** Compact unified-diff renderer with DevTools-style coloring. */

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted-foreground'
  if (line.startsWith('@@')) return 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
  if (line.startsWith('+')) return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
  if (line.startsWith('-')) return 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300'
  return 'text-foreground'
}

export function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, '').split('\n')
  return (
    <div className="overflow-x-auto border border-border bg-muted/20 font-mono text-xs leading-5">
      <pre className="min-w-max p-0">
        {lines.map((line, i) => (
          <div key={i} className={`px-2 whitespace-pre ${lineClass(line)}`}>
            {line || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}

/** Side-by-side-ish before/after fallback when no diff text is available. */
export function BeforeAfter({ before, after }: { before?: string; after?: string }) {
  return (
    <div className="grid grid-cols-2 gap-px border border-border bg-border font-mono text-xs">
      <div className="bg-red-50/60 dark:bg-red-950/40">
        <div className="border-b border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          before
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all p-2">{before ?? '∅'}</pre>
      </div>
      <div className="bg-emerald-50/60 dark:bg-emerald-950/40">
        <div className="border-b border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          after
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all p-2">{after ?? '∅'}</pre>
      </div>
    </div>
  )
}
