import type { JsonObject, JsonValue, MessageRole } from '@/types/trace'

/**
 * Loose field extraction: traces come from many systems with slightly
 * different field names. These helpers probe common aliases and nested
 * locations without assuming any single schema.
 */

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** Get the first present key from a list of aliases, optionally probing nested containers. */
export function pick(obj: JsonObject, keys: string[]): JsonValue | undefined {
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null) return obj[k]
  }
  // Probe common nesting containers
  for (const container of ['message', 'data', 'payload', 'record', 'meta', 'metadata']) {
    const nested = obj[container]
    if (isObject(nested)) {
      for (const k of keys) {
        if (k in nested && nested[k] !== undefined && nested[k] !== null) return nested[k]
      }
    }
  }
  return undefined
}

export function pickString(obj: JsonObject, keys: string[]): string | undefined {
  const v = pick(obj, keys)
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return undefined
}

export function pickNumber(obj: JsonObject, keys: string[]): number | undefined {
  const v = pick(obj, keys)
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export const CONVERSATION_ID_KEYS = [
  'conversation_id', 'conversationId', 'conv_id', 'session_id', 'sessionId',
  'thread_id', 'threadId', 'chat_id', 'chatId', 'trace_id', 'traceId', 'run_id', 'runId',
]

export const MESSAGE_ID_KEYS = [
  'message_id', 'messageId', 'msg_id', 'id', 'uuid', 'event_id', 'eventId', 'step_id', 'stepId',
]

export const PARENT_ID_KEYS = [
  'parent_id', 'parentId', 'parent_message_id', 'parentMessageId',
  'reply_to', 'replyTo', 'in_reply_to', 'previous_id', 'prev_id', 'branch_from',
]

export const ROLE_KEYS = ['role', 'sender', 'author', 'speaker', 'type', 'actor']

export const TIMESTAMP_KEYS = [
  'timestamp', 'ts', 'time', 'created_at', 'createdAt', 'date', 'at', 'started_at',
]

export const MODEL_KEYS = ['model', 'model_name', 'modelName', 'engine', 'llm']

export const CONTENT_KEYS = ['content', 'text', 'body', 'message_text', 'output', 'input', 'prompt', 'completion']

export const TOOL_CALL_KEYS = ['tool_calls', 'toolCalls', 'tools', 'function_calls', 'functionCalls', 'actions']

export const EVENT_KEYS = ['events', 'steps', 'activity', 'logs', 'spans']

export function normalizeRole(raw: string | undefined): MessageRole {
  if (!raw) return 'unknown'
  const r = raw.toLowerCase()
  if (['user', 'human', 'customer'].includes(r)) return 'user'
  if (['assistant', 'ai', 'bot', 'agent', 'model', 'llm'].includes(r)) return 'assistant'
  if (['system', 'developer'].includes(r)) return 'system'
  if (['tool', 'function', 'tool_result', 'observation'].includes(r)) return 'tool'
  return 'unknown'
}

/** Extract human-readable text from arbitrary content shapes. */
export function contentToText(content: JsonValue | undefined): string {
  if (content === undefined || content === null) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (isObject(part)) {
          if (typeof part.text === 'string') return part.text
          // Anthropic-style structured blocks
          if (part.type === 'thinking' && typeof part.thinking === 'string') return part.thinking
          if (part.type === 'tool_use') {
            const name = typeof part.name === 'string' ? part.name : 'tool'
            return `[tool_use: ${name}]`
          }
          if (part.type === 'tool_result') return contentToText(part.content)
          if (part.type === 'image') {
            const src = isObject(part.source) ? part.source : undefined
            const media = src && typeof src.media_type === 'string' ? src.media_type : 'image'
            return `[image: ${media}]`
          }
          if (typeof part.content === 'string') return part.content
          if (part.type === 'text' && typeof part.value === 'string') return part.value
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (isObject(content)) {
    if (typeof content.text === 'string') return content.text
    if (typeof content.content === 'string') return content.content
    if (content.parts) return contentToText(content.parts)
  }
  return ''
}

export { isObject }
