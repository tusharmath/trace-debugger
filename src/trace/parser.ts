import type { JsonObject, ParseError, ParseResult, RawRecord } from '@/types/trace'

/**
 * Parse JSONL text line-by-line.
 * - blank lines are ignored
 * - malformed lines are surfaced as errors (never crash, never silently drop)
 * - each record keeps its original 1-based line number
 */
export function parseJsonl(text: string, fileName: string): ParseResult {
  const records: RawRecord[] = []
  const errors: ParseError[] = []
  const lines = text.split(/\r\n|\r|\n/)

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw.trim() === '') continue
    const lineNo = i + 1
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        records.push({ line: lineNo, data: parsed as JsonObject })
      } else {
        // Valid JSON but not an object — wrap so nothing is discarded.
        records.push({ line: lineNo, data: { value: parsed } as JsonObject })
      }
    } catch (e) {
      errors.push({
        line: lineNo,
        message: e instanceof Error ? e.message : String(e),
        snippet: raw.length > 120 ? raw.slice(0, 120) + '…' : raw,
      })
    }
  }

  return { records, errors, totalLines: lines.length, fileName }
}

/** Read a File object as text (async, browser-only). */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
