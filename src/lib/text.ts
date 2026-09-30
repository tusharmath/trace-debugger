/** Heuristic: does this text contain enough markdown syntax to be worth rendering? */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)#{1,6}\s|```|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|(^|\n)[-*]\s/.test(text)
}

/**
 * Pull the human-readable text out of an arbitrary value, if it has one.
 * Tool results are commonly a bare string, or an object/array wrapping text.
 */
export function extractText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value.map(extractText)
    if (parts.every((p) => p !== null) && parts.length > 0) return parts.join('\n')
    return null
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of ['text', 'content', 'output', 'stdout', 'result', 'message']) {
      if (typeof obj[key] === 'string') return obj[key] as string
      if (Array.isArray(obj[key])) {
        const nested = extractText(obj[key])
        if (nested !== null) return nested
      }
    }
  }
  return null
}
