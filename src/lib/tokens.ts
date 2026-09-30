import type { TraceMessage } from '@/types/trace'

/**
 * Rough token estimate.
 *
 * We deliberately avoid shipping a real BPE tokenizer: it would add a large
 * dependency (and vocabulary download) for what is a debugging heuristic. The
 * ~4-chars-per-token ratio is the widely used approximation for GPT-family
 * tokenizers on English + code, and is accurate enough to spot which messages
 * dominate a context window.
 *
 * Reported values are marked with `~` in the UI so they are never mistaken for
 * provider-reported usage. When the trace *does* carry real usage numbers we
 * prefer those (see `messageTokens`).
 */
const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN))
}

/** Cached per message — traces can hold thousands of rows. */
const cache = new WeakMap<TraceMessage, number>()

/**
 * Approximate size of everything the model would have seen for this message:
 * its content plus any tool-call arguments/results serialized alongside it.
 */
export function estimateMessageTokens(m: TraceMessage): number {
  const hit = cache.get(m)
  if (hit !== undefined) return hit

  let chars = m.contentText.length
  for (const tc of m.toolCalls) {
    chars += tc.name.length
    if (tc.args !== undefined) chars += JSON.stringify(tc.args).length
    if (tc.result !== undefined) chars += JSON.stringify(tc.result).length
  }

  const value = chars === 0 ? 0 : Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN))
  cache.set(m, value)
  return value
}

export interface MessageTokens {
  count: number
  /** True when the number came from the trace instead of our heuristic. */
  exact: boolean
}

/** Prefer provider-reported usage; fall back to the character heuristic. */
export function messageTokens(m: TraceMessage): MessageTokens {
  const reported = m.tokens?.total ?? m.tokens?.output ?? m.tokens?.input
  if (typeof reported === 'number' && Number.isFinite(reported)) {
    return { count: reported, exact: true }
  }
  return { count: estimateMessageTokens(m), exact: false }
}

/**
 * Exact, grouped display: `812`, `1,400`, `36,214`.
 *
 * Debugging a context window means comparing precise sizes, so we never round
 * into `k`/`M` buckets — `1.4k` hides the difference between 1,400 and 1,449.
 */
export function formatTokens(n: number): string {
  return n.toLocaleString('en-US')
}
