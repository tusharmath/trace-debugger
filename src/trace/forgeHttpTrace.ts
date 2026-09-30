import type {
  Conversation,
  JsonObject,
  JsonValue,
  MessageRole,
  RawRecord,
  TokenUsage,
  ToolCall,
  TraceMessage,
} from '@/types/trace'
import { contentToText, isObject, normalizeRole, pickNumber, pickString } from './schema'
import { buildConversation } from './conversationTree'

/**
 * Forge HTTP trace format (`~/Library/Caches/forge/cache/http-trace/*.jsonl`).
 *
 * Each line is either:
 *   { ts, id, phase: "request", provider_id, model_id,
 *     body: { conversation: { conversation_id, context: { messages: [...], tools, ... } } } }
 *   { ts, id, phase: "response", end, duration_ms, chunks: [...], error }
 *
 * A request and its response share the same `id`. Messages carry stable
 * ids and are shaped as `{ id, content: { <role>: { content: [...] } }, timestamp }`.
 */

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

export function isForgeRequestRecord(obj: JsonObject): boolean {
  if (obj.phase !== 'request' || typeof obj.id !== 'string') return false
  const body = obj.body
  if (!isObject(body)) return false
  const conv = body.conversation
  if (!isObject(conv)) return false
  const ctx = conv.context
  return isObject(ctx) && Array.isArray(ctx.messages)
}

export function isForgeResponseRecord(obj: JsonObject): boolean {
  return obj.phase === 'response' && typeof obj.id === 'string' && Array.isArray(obj.chunks)
}

export function isForgeHttpTraceRecord(obj: JsonObject): boolean {
  return isForgeRequestRecord(obj) || isForgeResponseRecord(obj)
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ROLE_KEYS = ['system', 'user', 'assistant', 'tool'] as const

interface ForgeMessage {
  id: string
  role: MessageRole
  roleKey: string
  payload: JsonObject
  raw: JsonObject
}

function unwrapMessage(m: JsonValue, index: number): ForgeMessage | null {
  if (!isObject(m)) return null
  const content = m.content
  if (!isObject(content)) return null
  for (const key of ROLE_KEYS) {
    const payload = content[key]
    if (isObject(payload)) {
      return {
        id: typeof m.id === 'string' ? m.id : `msg_${index}`,
        role: normalizeRole(key),
        roleKey: key,
        payload,
        raw: m,
      }
    }
  }
  // Unknown role key: take the first object value
  for (const [key, payload] of Object.entries(content)) {
    if (isObject(payload)) {
      return { id: typeof m.id === 'string' ? m.id : `msg_${index}`, role: normalizeRole(key), roleKey: key, payload, raw: m }
    }
  }
  return null
}

function toIso(ts: JsonValue | undefined): string | undefined {
  if (typeof ts === 'string') return ts
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    // Seconds vs. milliseconds heuristic
    const ms = ts < 1e12 ? ts * 1000 : ts
    return new Date(ms).toISOString()
  }
  return undefined
}

function extractUsage(payload: JsonObject): TokenUsage | undefined {
  const usage = payload.usage
  if (!isObject(usage)) return undefined
  const input = pickNumber(usage, ['input_tokens', 'input'])
  const output = pickNumber(usage, ['output_tokens', 'output'])
  const total = pickNumber(usage, ['total_tokens', 'total'])
  if (input === undefined && output === undefined && total === undefined) return undefined
  return {
    input,
    output,
    total: total ?? (input !== undefined && output !== undefined ? input + output : undefined),
  }
}

function extractModel(payload: JsonObject): string | undefined {
  const model = payload.model
  if (isObject(model)) return pickString(model, ['model_id', 'id', 'name'])
  if (typeof model === 'string') return model
  return undefined
}

/** Build a normalized message from a Forge message wrapper. */
function buildForgeMessage(
  fm: ForgeMessage,
  conversationId: string,
  line: number,
  fallbackModel: string | undefined,
): TraceMessage {
  const content = fm.payload.content
  const blocks = Array.isArray(content) ? content.filter(isObject) : []

  const toolCalls: ToolCall[] = []
  const errors: string[] = []

  for (const b of blocks) {
    if (b.type === 'tool_call') {
      toolCalls.push({
        id: pickString(b, ['id']),
        name: pickString(b, ['name']) ?? 'unknown',
        args: b.arguments,
        raw: b,
      })
    }
  }
  for (const b of blocks) {
    if (b.type !== 'tool_result') continue
    const id = pickString(b, ['id'])
    const hadError = b.error !== undefined && b.error !== null
    const tc = id ? toolCalls.find((t) => t.id === id) : undefined
    if (tc) {
      tc.result = b.result ?? b.error ?? null
      tc.status = hadError ? 'error' : 'ok'
      if (typeof b.info === 'string') {
        const m = /(\d+)\s*ms/.exec(b.info)
        if (m) tc.durationMs = Number(m[1])
      }
    }
    if (hadError) {
      errors.push(typeof b.error === 'string' ? b.error : JSON.stringify(b.error))
    }
  }

  const hidden = fm.payload.hide === true
  const model = fm.role === 'assistant' ? (extractModel(fm.payload) ?? fallbackModel) : undefined

  return {
    id: fm.id,
    parentId: null,
    conversationId,
    role: fm.role,
    line,
    timestamp: toIso(fm.raw.timestamp),
    model,
    content,
    contentText: contentToText(content),
    toolCalls,
    events: [],
    fileChanges: [],
    commands: [],
    stateChanges: [],
    errors,
    tokens: fm.role === 'assistant' ? extractUsage(fm.payload) : undefined,
    status: hidden ? 'hidden' : undefined,
    raw: [],
    syntheticId: typeof fm.raw.id !== 'string',
  }
}

/* ------------------------------------------------------------------ */
/* Response chunks → synthetic assistant message                       */
/* ------------------------------------------------------------------ */

interface AssembledResponse {
  text: string
  toolCalls: ToolCall[]
  reasoning: string
}

function assembleChunks(chunks: JsonValue[]): AssembledResponse {
  let text = ''
  let reasoning = ''
  const calls = new Map<string, { name: string; text: string; raw: JsonObject[] }>()
  const order: string[] = []
  for (const c of chunks) {
    if (!isObject(c)) continue
    if (isObject(c.content) && typeof c.content.content === 'string') {
      text += c.content.content
    } else if (typeof c.content === 'string') {
      text += c.content
    }
    if (isObject(c.reasoning) && typeof c.reasoning.content === 'string') {
      reasoning += c.reasoning.content
    } else if (typeof c.reasoning === 'string') {
      reasoning += c.reasoning
    }
    if (isObject(c.tool_call)) {
      const tc = c.tool_call
      const id = pickString(tc, ['id']) ?? `call_${order.length}`
      let entry = calls.get(id)
      if (!entry) {
        entry = { name: pickString(tc, ['name']) ?? 'unknown', text: '', raw: [] }
        calls.set(id, entry)
        order.push(id)
      }
      if (typeof tc.text === 'string') entry.text += tc.text
      if (typeof tc.arguments === 'string') entry.text += tc.arguments
      entry.raw.push(tc)
    }
  }
  const toolCalls: ToolCall[] = order.map((id) => {
    const e = calls.get(id)!
    let args: JsonValue = e.text
    try {
      args = JSON.parse(e.text) as JsonValue
    } catch {
      /* keep raw string */
    }
    return { id, name: e.name, args, status: 'pending', raw: e.raw }
  })
  return { text, toolCalls, reasoning }
}

/* ------------------------------------------------------------------ */
/* Conversation reconstruction                                         */
/* ------------------------------------------------------------------ */

interface ConvState {
  id: string
  messages: TraceMessage[]
  byId: Map<string, TraceMessage>
  /** Last message id of each request, keyed by request id. */
  requestTail: Map<string, string>
}

export function buildForgeHttpTraceConversations(records: RawRecord[]): {
  conversations: Conversation[]
  orphans: RawRecord[]
  requestCount: number
  responseCount: number
} {
  const convs = new Map<string, ConvState>()
  const requestConv = new Map<string, string>()
  const responses: RawRecord[] = []
  const orphans: RawRecord[] = []
  let requestCount = 0

  for (const record of records) {
    const obj = record.data
    if (isForgeResponseRecord(obj)) {
      responses.push(record)
      continue
    }
    if (!isForgeRequestRecord(obj)) {
      orphans.push(record)
      continue
    }
    requestCount += 1
    const requestId = obj.id as string
    const body = obj.body as JsonObject
    const conv = body.conversation as JsonObject
    const ctx = conv.context as JsonObject
    const convId = pickString(conv, ['conversation_id', 'id']) ?? `conv_${convs.size + 1}`
    const model = pickString(obj, ['model_id']) ?? pickString(body, ['model_id'])
    const provider = pickString(obj, ['provider_id']) ?? pickString(body, ['provider_id'])

    let state = convs.get(convId)
    if (!state) {
      state = { id: convId, messages: [], byId: new Map(), requestTail: new Map() }
      convs.set(convId, state)
    }
    requestConv.set(requestId, convId)

    const rawMessages = ctx.messages as JsonValue[]
    let parent: TraceMessage | null = null
    rawMessages.forEach((rm, idx) => {
      const fm = unwrapMessage(rm, idx)
      if (!fm) return
      let node = state!.byId.get(fm.id)
      if (!node) {
        node = buildForgeMessage(fm, convId, record.line, model)
        node.parentId = parent ? parent.id : null
        state!.byId.set(node.id, node)
        state!.messages.push(node)

        // Wire tool results that landed here onto earlier calls (Forge
        // typically keeps call+result in the same assistant message, but
        // be defensive for split shapes).
        const content = Array.isArray(fm.payload.content) ? fm.payload.content : []
        for (const b of content) {
          if (!isObject(b) || b.type !== 'tool_result') continue
          const id = pickString(b, ['id'])
          if (!id || node.toolCalls.some((t) => t.id === id)) continue
          for (let p = parent; p; p = p.parentId ? (state!.byId.get(p.parentId) ?? null) : null) {
            const tc = p.toolCalls.find((t) => t.id === id)
            if (tc) {
              tc.result ??= b.result ?? b.error ?? null
              tc.status ??= b.error ? 'error' : 'ok'
              break
            }
          }
        }
      }
      node.raw.push(record)
      parent = node
    })

    if (parent) {
      const tail: TraceMessage = parent
      state.requestTail.set(requestId, tail.id)
      const meta: JsonObject = {}
      for (const [k, v] of Object.entries(ctx)) {
        if (k === 'messages') continue
        if (k === 'tools' && Array.isArray(v)) {
          meta.tools = v.map((t) => (isObject(t) && typeof t.name === 'string' ? t.name : t))
          continue
        }
        meta[k] = v
      }
      if (typeof obj.ts === 'string') meta.ts = obj.ts
      meta.request_id = requestId
      if (provider) meta.provider_id = provider
      if (model) meta.model_id = model
      if (isObject(body.upstream)) meta.upstream = body.upstream
      tail.events.push({
        kind: 'generic',
        label: 'llm_request',
        detail: `${provider ? provider + ' / ' : ''}${model ?? 'request'}`,
        timestamp: typeof obj.ts === 'string' ? obj.ts : undefined,
        raw: meta,
        line: record.line,
      })
    }
  }

  // Attach responses
  let responseCount = 0
  for (const record of responses) {
    const obj = record.data
    const requestId = obj.id as string
    const convId = requestConv.get(requestId)
    const state = convId ? convs.get(convId) : undefined
    const tailId = state?.requestTail.get(requestId)
    const tail = tailId ? state!.byId.get(tailId) : undefined
    if (!state || !tail) {
      orphans.push(record)
      continue
    }
    responseCount += 1

    const chunks = obj.chunks as JsonValue[]
    const assembled = assembleChunks(chunks)
    const durationMs = pickNumber(obj, ['duration_ms'])
    const end = pickString(obj, ['end'])
    const err = obj.error
    const errorText =
      err === undefined || err === null
        ? undefined
        : typeof err === 'string'
          ? err
          : isObject(err)
            ? (pickString(err, ['message', 'detail']) ?? JSON.stringify(err))
            : JSON.stringify(err)

    const model = pickString(obj, ['model_id'])
    const meta: JsonObject = {
      request_id: requestId,
      end: end ?? null,
      duration_ms: durationMs ?? null,
      chunk_count: chunks.length,
      error: err ?? null,
    }
    if (typeof obj.ts === 'string') meta.ts = obj.ts

    // A later request usually already contains the assistant turn produced
    // by this response — prefer that node over a synthetic one.
    const existingChild = state.messages.find(
      (m) => m.parentId === tail.id && m.role === 'assistant' && m.line > tail.line,
    )
    let target: TraceMessage
    if (existingChild) {
      target = existingChild
    } else {
      const content: JsonValue[] = []
      if (assembled.reasoning) content.push({ type: 'thinking', thinking: assembled.reasoning })
      if (assembled.text) content.push({ text: assembled.text })
      for (const tc of assembled.toolCalls) {
        content.push({ type: 'tool_call', id: tc.id ?? null, name: tc.name, arguments: tc.args ?? null })
      }
      target = {
        id: `resp_${requestId}`,
        parentId: tail.id,
        conversationId: state.id,
        role: 'assistant',
        line: record.line,
        timestamp: typeof obj.ts === 'string' ? obj.ts : undefined,
        model: model ?? tail.model ?? modelOfTail(tail),
        content,
        contentText: assembled.text,
        toolCalls: assembled.toolCalls,
        events: [],
        fileChanges: [],
        commands: [],
        stateChanges: [],
        errors: [],
        status: end,
        raw: [],
        syntheticId: true,
      }
      state.byId.set(target.id, target)
      state.messages.push(target)
    }

    target.raw.push(record)
    target.durationMs ??= durationMs
    target.status ??= end
    if (errorText) target.errors.push(errorText)
    target.events.push({
      kind: errorText ? 'error' : 'generic',
      label: 'llm_response',
      detail: errorText ?? `${end ?? 'response'}${durationMs !== undefined ? ` · ${durationMs} ms` : ''}`,
      timestamp: typeof obj.ts === 'string' ? obj.ts : undefined,
      raw: meta,
      line: record.line,
    })
  }

  const conversations: Conversation[] = []
  for (const state of convs.values()) {
    if (state.messages.length === 0) continue
    conversations.push(buildConversation(state.id, state.messages, state.byId))
  }
  return { conversations, orphans, requestCount, responseCount }
}

/** Model recorded on the request that produced this tail message, if any. */
function modelOfTail(tail: TraceMessage): string | undefined {
  for (let i = tail.events.length - 1; i >= 0; i--) {
    const ev = tail.events[i]
    if (ev.label === 'llm_request' && isObject(ev.raw)) {
      const m = pickString(ev.raw, ['model_id'])
      if (m) return m
    }
  }
  return undefined
}
