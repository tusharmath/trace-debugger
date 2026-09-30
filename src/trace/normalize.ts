import type {
  CommandExecution,
  FileChange,
  FileChangeKind,
  JsonObject,
  JsonValue,
  ParseResult,
  NormalizedTrace,
  TraceFormatInfo,
  RawRecord,
  StateChange,
  TokenUsage,
  ToolCall,
  TraceEvent,
  TraceEventKind,
  TraceMessage,
} from '@/types/trace'
import {
  CONTENT_KEYS,
  CONVERSATION_ID_KEYS,
  EVENT_KEYS,
  MESSAGE_ID_KEYS,
  MODEL_KEYS,
  PARENT_ID_KEYS,
  ROLE_KEYS,
  TIMESTAMP_KEYS,
  TOOL_CALL_KEYS,
  contentToText,
  isObject,
  normalizeRole,
  pick,
  pickNumber,
  pickString,
} from './schema'
import { buildConversation } from './conversationTree'

/* ------------------------------------------------------------------ */
/* Tool calls                                                          */
/* ------------------------------------------------------------------ */

function normalizeToolCall(raw: JsonValue): ToolCall {
  if (!isObject(raw)) return { name: 'unknown', raw }
  const fn = isObject(raw.function) ? raw.function : undefined
  const name =
    pickString(raw, ['name', 'tool', 'tool_name', 'toolName', 'action']) ??
    (fn ? pickString(fn, ['name']) : undefined) ??
    'unknown'
  let args = pick(raw, ['args', 'arguments', 'input', 'params', 'parameters'])
  if (args === undefined && fn) args = fn.arguments
  // OpenAI-style stringified arguments
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args) as JsonValue
    } catch {
      /* keep as string */
    }
  }
  const result = pick(raw, ['result', 'output', 'response', 'observation', 'return'])
  const statusRaw = pickString(raw, ['status', 'state', 'outcome'])
  let status: ToolCall['status']
  if (statusRaw) {
    const s = statusRaw.toLowerCase()
    if (['ok', 'success', 'succeeded', 'completed', 'done'].includes(s)) status = 'ok'
    else if (['error', 'failed', 'failure'].includes(s)) status = 'error'
    else if (['pending', 'running', 'in_progress'].includes(s)) status = 'pending'
  }
  if (!status && pick(raw, ['error']) !== undefined) status = 'error'
  return {
    id: pickString(raw, ['id', 'tool_call_id', 'call_id']),
    name,
    args,
    result,
    status,
    durationMs: pickNumber(raw, ['duration_ms', 'durationMs', 'duration', 'elapsed_ms']),
    raw,
  }
}

/* ------------------------------------------------------------------ */
/* Anthropic content blocks                                            */
/* ------------------------------------------------------------------ */

/** Content blocks of a given type from Anthropic-style `content` arrays. */
function contentBlocks(content: JsonValue | undefined, type: string): JsonObject[] {
  if (!Array.isArray(content)) return []
  return content.filter((b): b is JsonObject => isObject(b) && b.type === type)
}

/** Convert an Anthropic `tool_use` block into a ToolCall. */
function toolUseToCall(block: JsonObject): ToolCall {
  return {
    id: pickString(block, ['id']),
    name: pickString(block, ['name']) ?? 'unknown',
    args: block.input,
    raw: block,
  }
}

/**
 * Anthropic encodes tool results as `user` messages whose content is only
 * `tool_result` blocks. Surface those as the `tool` role so the UI groups
 * them with the call rather than with human turns.
 */
function anthropicRoleOverride(obj: JsonObject): 'tool' | undefined {
  const content = obj.content
  if (!Array.isArray(content) || content.length === 0) return undefined
  const blocks = content.filter(isObject)
  if (blocks.length !== content.length) return undefined
  return blocks.every((b) => b.type === 'tool_result') ? 'tool' : undefined
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const EVENT_KIND_MAP: Record<string, TraceEventKind> = {
  tool_call: 'tool_call',
  tool_use: 'tool_call',
  function_call: 'tool_call',
  tool_result: 'tool_result',
  tool_response: 'tool_result',
  observation: 'tool_result',
  reasoning: 'reasoning',
  thinking: 'reasoning',
  thought: 'reasoning',
  retry: 'retry',
  error: 'error',
  exception: 'error',
  failure: 'error',
  file_change: 'file_change',
  file_create: 'file_change',
  file_created: 'file_change',
  file_modify: 'file_change',
  file_modified: 'file_change',
  file_edit: 'file_change',
  file_delete: 'file_change',
  file_deleted: 'file_change',
  file_write: 'file_change',
  patch: 'file_change',
  diff: 'file_change',
  command: 'command',
  shell: 'command',
  exec: 'command',
  bash: 'command',
  state_change: 'state_change',
  state_update: 'state_change',
  artifact: 'artifact',
  artifact_created: 'artifact',
}

function eventKind(typeStr: string | undefined, obj: JsonObject): TraceEventKind {
  if (typeStr) {
    const mapped = EVENT_KIND_MAP[typeStr.toLowerCase()]
    if (mapped) return mapped
  }
  if (obj.error !== undefined) return 'error'
  if (obj.diff !== undefined || obj.patch !== undefined) return 'file_change'
  if (obj.command !== undefined || obj.cmd !== undefined) return 'command'
  return 'generic'
}

function normalizeEvent(raw: JsonValue, line?: number): TraceEvent {
  if (!isObject(raw)) {
    return { kind: 'generic', label: String(raw), raw, line }
  }
  const typeStr = pickString(raw, ['type', 'event', 'event_type', 'kind', 'name'])
  const kind = eventKind(typeStr, raw)
  const label =
    typeStr ??
    pickString(raw, ['label', 'title', 'name']) ??
    kind
  const detail =
    pickString(raw, ['message', 'detail', 'description', 'summary', 'text']) ??
    (kind === 'command' ? pickString(raw, ['command', 'cmd']) : undefined) ??
    (kind === 'file_change' ? pickString(raw, ['path', 'file', 'file_path']) : undefined) ??
    (kind === 'tool_call' ? pickString(raw, ['tool', 'tool_name']) : undefined)
  return {
    kind,
    label,
    detail,
    timestamp: pickString(raw, TIMESTAMP_KEYS),
    raw,
    line,
  }
}

/* ------------------------------------------------------------------ */
/* Changes                                                             */
/* ------------------------------------------------------------------ */

function fileChangeKind(s: string | undefined): FileChangeKind {
  const v = (s ?? '').toLowerCase()
  if (v.includes('creat') || v.includes('add') || v.includes('write')) return 'created'
  if (v.includes('delet') || v.includes('remov')) return 'deleted'
  if (v.includes('renam') || v.includes('mov')) return 'renamed'
  return 'modified'
}

function extractFileChange(obj: JsonObject): FileChange | null {
  const path = pickString(obj, ['path', 'file', 'file_path', 'filePath', 'filename', 'target'])
  if (!path) return null
  return {
    kind: fileChangeKind(
      pickString(obj, ['change', 'change_type', 'operation', 'op', 'action', 'type', 'event']),
    ),
    path,
    oldPath: pickString(obj, ['old_path', 'oldPath', 'from', 'source']),
    diff: pickString(obj, ['diff', 'patch', 'unified_diff']),
    before: pickString(obj, ['before', 'old_content', 'previous']),
    after: pickString(obj, ['after', 'new_content', 'content']),
    raw: obj,
  }
}

function extractCommand(obj: JsonObject): CommandExecution | null {
  const command = pickString(obj, ['command', 'cmd', 'shell', 'script'])
  if (!command) return null
  return {
    command,
    exitCode: pickNumber(obj, ['exit_code', 'exitCode', 'code', 'status_code']),
    output: pickString(obj, ['output', 'stdout', 'result']),
    durationMs: pickNumber(obj, ['duration_ms', 'durationMs', 'duration', 'elapsed_ms']),
    raw: obj,
  }
}

function extractStateChanges(obj: JsonObject): StateChange[] {
  const out: StateChange[] = []
  const container = pick(obj, ['state_changes', 'stateChanges', 'changes', 'state'])
  if (Array.isArray(container)) {
    for (const item of container) {
      if (!isObject(item)) continue
      const key = pickString(item, ['key', 'name', 'field', 'variable', 'path'])
      if (!key) continue
      out.push({
        key,
        before: pick(item, ['before', 'old', 'from', 'previous']),
        after: pick(item, ['after', 'new', 'to', 'value', 'current']),
        raw: item,
      })
    }
  } else if (isObject(container)) {
    // { key: {before, after} } or { key: value } shapes
    for (const [key, v] of Object.entries(container)) {
      if (isObject(v) && ('before' in v || 'after' in v || 'old' in v || 'new' in v)) {
        out.push({
          key,
          before: v.before ?? v.old,
          after: v.after ?? v.new,
          raw: v,
        })
      } else {
        out.push({ key, after: v, raw: v })
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Record classification                                               */
/* ------------------------------------------------------------------ */

/** Does this record look like a standalone event that references a message? */
function refMessageId(obj: JsonObject): string | undefined {
  return pickString(obj, ['message_id', 'messageId', 'msg_id', 'for_message', 'ref', 'message_ref'])
}

function looksLikeEventRecord(obj: JsonObject): boolean {
  const type = pickString(obj, ['type', 'event', 'event_type', 'kind'])
  if (!type) return false
  const t = type.toLowerCase()
  if (t === 'message' || t === 'chat' || t === 'completion') return false
  return t in EVENT_KIND_MAP || ['log', 'span', 'step', 'metric'].includes(t)
}

/* ------------------------------------------------------------------ */
/* Message building                                                    */
/* ------------------------------------------------------------------ */

function extractTokens(obj: JsonObject): TokenUsage | undefined {
  const usage = pick(obj, ['usage', 'tokens', 'token_usage', 'tokenUsage'])
  if (isObject(usage)) {
    const input = pickNumber(usage, ['input', 'input_tokens', 'prompt_tokens', 'promptTokens'])
    const output = pickNumber(usage, ['output', 'output_tokens', 'completion_tokens', 'completionTokens'])
    const total = pickNumber(usage, ['total', 'total_tokens', 'totalTokens'])
    if (input !== undefined || output !== undefined || total !== undefined) {
      return { input, output, total: total ?? (input !== undefined && output !== undefined ? input + output : undefined) }
    }
  }
  return undefined
}

/**
 * The same file change is often described in multiple places (an embedded
 * `file_change` event AND the `edit_file`/`write_file` tool call that caused
 * it). Dedupe by path, keeping the richest entry (one carrying a diff or
 * before/after content) and the most specific change kind.
 */
function dedupeFileChanges(changes: FileChange[]): FileChange[] {
  const byPath = new Map<string, FileChange>()
  const richness = (fc: FileChange) =>
    (fc.diff ? 2 : 0) + (fc.before !== undefined || fc.after !== undefined ? 1 : 0)
  for (const fc of changes) {
    const key = `${fc.path}`
    const existing = byPath.get(key)
    if (!existing) {
      byPath.set(key, fc)
    } else if (richness(fc) > richness(existing)) {
      // Preserve a more specific kind if the richer entry lacks one
      if (existing.kind !== 'modified' && fc.kind === 'modified') fc.kind = existing.kind
      byPath.set(key, fc)
    } else if (existing.kind === 'modified' && fc.kind !== 'modified') {
      existing.kind = fc.kind
    }
  }
  return [...byPath.values()]
}

function buildMessage(record: RawRecord, conversationId: string, syntheticId: string | null): TraceMessage {
  const obj = record.data
  const explicitId = pickString(obj, MESSAGE_ID_KEYS)
  const id = explicitId ?? syntheticId ?? `line_${record.line}`
  const content = pick(obj, CONTENT_KEYS)
  const toolCallsRaw = pick(obj, TOOL_CALL_KEYS)
  const toolCalls = Array.isArray(toolCallsRaw) ? toolCallsRaw.map(normalizeToolCall) : []
  // Anthropic tool_use blocks live inside the content array
  toolCalls.push(...contentBlocks(content, 'tool_use').map(toolUseToCall))
  const eventsRaw = pick(obj, EVENT_KEYS)
  const events = Array.isArray(eventsRaw) ? eventsRaw.map((e) => normalizeEvent(e)) : []

  const fileChanges: FileChange[] = []
  const commands: CommandExecution[] = []
  const stateChanges: StateChange[] = extractStateChanges(obj)
  const errors: string[] = []

  const topError = pick(obj, ['error', 'errors'])
  if (typeof topError === 'string') errors.push(topError)
  else if (Array.isArray(topError)) {
    for (const e of topError) errors.push(typeof e === 'string' ? e : JSON.stringify(e))
  } else if (isObject(topError)) {
    errors.push(pickString(topError, ['message', 'detail']) ?? JSON.stringify(topError))
  }

  // Mine embedded events for changes / errors
  for (const ev of events) {
    if (isObject(ev.raw)) {
      if (ev.kind === 'file_change') {
        const fc = extractFileChange(ev.raw)
        if (fc) fileChanges.push(fc)
      } else if (ev.kind === 'command') {
        const cmd = extractCommand(ev.raw)
        if (cmd) commands.push(cmd)
      } else if (ev.kind === 'error') {
        errors.push(ev.detail ?? ev.label)
      } else if (ev.kind === 'state_change') {
        stateChanges.push(...extractStateChanges(ev.raw))
        if (stateChanges.length === 0) {
          const key = pickString(ev.raw, ['key', 'name', 'field'])
          if (key) {
            stateChanges.push({
              key,
              before: pick(ev.raw, ['before', 'old', 'from']),
              after: pick(ev.raw, ['after', 'new', 'to', 'value']),
              raw: ev.raw,
            })
          }
        }
      }
    }
  }

  // Mine tool calls for file changes / commands too (e.g. write_file / bash tools)
  for (const tc of toolCalls) {
    if (tc.status === 'error') {
      const msg = isObject(tc.raw) ? pickString(tc.raw, ['error']) : undefined
      errors.push(msg ?? `tool ${tc.name} failed`)
    }
    if (isObject(tc.args)) {
      const argsObj = tc.args
      const lname = tc.name.toLowerCase()
      if (/write|create|edit|patch|delete|file/.test(lname)) {
        const fc = extractFileChange(argsObj)
        if (fc) {
          if (/delete|remove/.test(lname)) fc.kind = 'deleted'
          else if (/create|write/.test(lname)) fc.kind = 'created'
          else if (/edit|patch|modif/.test(lname)) fc.kind = 'modified'
          fileChanges.push(fc)
        }
      }
      if (/bash|shell|exec|command|run/.test(lname)) {
        const cmd = extractCommand(argsObj)
        if (cmd) {
          if (typeof tc.result === 'string' && cmd.output === undefined) cmd.output = tc.result
          else if (isObject(tc.result)) {
            cmd.output ??= pickString(tc.result, ['output', 'stdout'])
            cmd.exitCode ??= pickNumber(tc.result, ['exit_code', 'exitCode', 'code'])
          }
          commands.push(cmd)
        }
      }
    }
  }

  // Top-level file_changes / files arrays
  const topFiles = pick(obj, ['file_changes', 'fileChanges', 'files', 'files_changed'])
  if (Array.isArray(topFiles)) {
    for (const f of topFiles) {
      if (isObject(f)) {
        const fc = extractFileChange(f)
        if (fc) fileChanges.push(fc)
      } else if (typeof f === 'string') {
        fileChanges.push({ kind: 'modified', path: f, raw: f })
      }
    }
  }

  return {
    id,
    parentId: pickString(obj, PARENT_ID_KEYS) ?? null,
    conversationId,
    role: anthropicRoleOverride(obj) ?? normalizeRole(pickString(obj, ROLE_KEYS)),
    line: record.line,
    timestamp: pickString(obj, TIMESTAMP_KEYS),
    model: pickString(obj, MODEL_KEYS),
    content,
    contentText: contentToText(content),
    toolCalls,
    events,
    fileChanges: dedupeFileChanges(fileChanges),
    commands,
    stateChanges,
    errors,
    durationMs: pickNumber(obj, ['duration_ms', 'durationMs', 'duration', 'latency_ms', 'elapsed_ms']),
    tokens: extractTokens(obj),
    status: pickString(obj, ['status', 'state', 'finish_reason', 'stop_reason']),
    raw: [record],
    syntheticId: explicitId === undefined,
  }
}

/** Merge a standalone event record into an existing message. */
function attachEventRecord(msg: TraceMessage, record: RawRecord): void {
  const ev = normalizeEvent(record.data, record.line)
  msg.events.push(ev)
  msg.raw.push(record)
  const obj = record.data
  if (ev.kind === 'file_change') {
    const fc = extractFileChange(obj)
    if (fc) msg.fileChanges = dedupeFileChanges([...msg.fileChanges, fc])
  } else if (ev.kind === 'command') {
    const cmd = extractCommand(obj)
    if (cmd) msg.commands.push(cmd)
  } else if (ev.kind === 'error') {
    msg.errors.push(ev.detail ?? ev.label)
  } else if (ev.kind === 'state_change') {
    msg.stateChanges.push(...extractStateChanges(obj))
  }
}

/* ------------------------------------------------------------------ */
/* Request-log records (each line = full LLM request snapshot)         */
/* ------------------------------------------------------------------ */

/**
 * Detect records shaped like a raw LLM API request: a top-level `messages`
 * array of {role, ...} objects with no per-record message identity.
 * Common in provider request logs (OpenAI / Anthropic style).
 */
function isRequestLogRecord(obj: JsonObject): boolean {
  const ms = obj.messages
  if (!Array.isArray(ms) || ms.length === 0) return false
  if (!ms.every((m) => isObject(m) && typeof m.role === 'string')) return false
  // A record that already carries its own top-level role/content is a
  // message record with history attached — not a request snapshot.
  if (typeof obj.role === 'string') return false
  return true
}

/** FNV-1a string hash — compact signature keys for message identity. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function messageSignature(m: JsonObject): string {
  const role = typeof m.role === 'string' ? m.role : '?'
  const content = m.content === undefined ? '' : JSON.stringify(m.content)
  const toolCalls = m.tool_calls === undefined ? '' : JSON.stringify(m.tool_calls)
  const toolCallId = typeof m.tool_call_id === 'string' ? m.tool_call_id : ''
  return `${role}:${fnv1a(content)}:${fnv1a(toolCalls + toolCallId)}`
}

/** Expand one request record into its ordered message objects. */
function requestMessages(obj: JsonObject): JsonObject[] {
  const out: JsonObject[] = []
  // Anthropic-style top-level system prompt becomes a synthetic system message
  if (obj.system !== undefined && obj.system !== null) {
    out.push({ role: 'system', content: obj.system })
  }
  const ms = obj.messages
  if (Array.isArray(ms)) {
    for (const m of ms) if (isObject(m)) out.push(m)
  }
  return out
}

/**
 * Reconstruct conversations from request snapshots using a prefix tree:
 * successive requests share a message prefix; the first divergence creates
 * a fork. Requests whose first message differs entirely form separate
 * conversation threads.
 */
function buildRequestLogConversations(records: RawRecord[]) {
  // Group requests into threads by the signature of their first message
  const threads = new Map<string, RawRecord[]>()
  for (const record of records) {
    const msgs = requestMessages(record.data)
    if (msgs.length === 0) continue
    const key = messageSignature(msgs[0])
    let arr = threads.get(key)
    if (!arr) {
      arr = []
      threads.set(key, arr)
    }
    arr.push(record)
  }

  const conversations = []
  let threadIndex = 0
  for (const [, threadRecords] of threads) {
    threadIndex += 1
    const convId = `thread_${threadIndex}`
    const messages: TraceMessage[] = []
    const byId = new Map<string, TraceMessage>()
    // signature path -> message, so shared prefixes map to the same node
    const bySigPath = new Map<string, TraceMessage>()
    let counter = 0

    for (const record of threadRecords) {
      const model = pickString(record.data, MODEL_KEYS)
      const msgs = requestMessages(record.data)
      let parent: TraceMessage | null = null
      let sigPath = ''
      for (const m of msgs) {
        sigPath += '/' + messageSignature(m)
        let node = bySigPath.get(sigPath)
        if (!node) {
          counter += 1
          node = buildMessage(
            { line: record.line, data: m },
            convId,
            `msg_${counter}`,
          )
          node.parentId = parent ? parent.id : null
          if (node.role === 'assistant' && model) node.model ??= model
          bySigPath.set(sigPath, node)
          byId.set(node.id, node)
          messages.push(node)

          // Wire tool-result messages back onto the parent assistant's call.
          // OpenAI puts the id at the message level; Anthropic puts one per
          // `tool_result` content block.
          const resultPairs: Array<[string, JsonValue | undefined]> = []
          const msgToolCallId = pickString(m, ['tool_call_id', 'toolCallId'])
          if (msgToolCallId) resultPairs.push([msgToolCallId, m.content])
          for (const block of contentBlocks(m.content, 'tool_result')) {
            const id = pickString(block, ['tool_use_id', 'toolUseId'])
            if (id) resultPairs.push([id, block.content])
          }
          for (const [callId, result] of resultPairs) {
            for (let p = parent; p; p = p.parentId ? byId.get(p.parentId) ?? null : null) {
              const tc = p.toolCalls.find((t) => t.id === callId)
              if (tc) {
                tc.result ??= result
                break
              }
            }
          }
        }
        parent = node
      }
      // Attach request metadata (model, limits, etc.) to the last message
      if (parent) {
        const meta: JsonObject = {}
        for (const [k, v] of Object.entries(record.data)) {
          if (k === 'messages' || k === 'system' || k === 'tools') continue
          meta[k] = v
        }
        parent.events.push({
          kind: 'generic',
          label: 'llm_request',
          detail: model ? `request → ${model}` : 'request',
          raw: meta,
          line: record.line,
        })
      }
    }

    if (messages.length > 0) {
      conversations.push(buildConversation(convId, messages, byId))
    }
  }
  return conversations
}

/* ------------------------------------------------------------------ */
/* Format detection                                                    */
/* ------------------------------------------------------------------ */

const ANTHROPIC_BLOCK_TYPES = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use', 'tool_result', 'image', 'document'])

/** Does this request record use Anthropic structured content blocks? */
function hasAnthropicBlocks(obj: JsonObject): boolean {
  for (const m of requestMessages(obj)) {
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (isObject(b) && typeof b.type === 'string' && ANTHROPIC_BLOCK_TYPES.has(b.type)) {
        // `text` alone is ambiguous with OpenAI multimodal parts
        if (b.type !== 'text') return true
      }
    }
  }
  return false
}

function hasOpenAiShape(obj: JsonObject): boolean {
  if (Array.isArray(obj.tool_calls)) return true
  for (const m of requestMessages(obj)) {
    if (Array.isArray(m.tool_calls) || m.tool_call_id !== undefined) return true
  }
  return false
}

function detectFormat(requestLogs: RawRecord[], ordinary: RawRecord[]): TraceFormatInfo {
  if (requestLogs.length > 0) {
    const anthropic = requestLogs.some((r) => hasAnthropicBlocks(r.data))
    const openai = requestLogs.some((r) => hasOpenAiShape(r.data))
    const n = requestLogs.length
    const suffix = `${n} request snapshot${n === 1 ? '' : 's'}`
    if (anthropic) {
      return {
        format: 'anthropic-messages',
        label: 'Anthropic Messages',
        detail: `Structured content blocks (tool_use / tool_result / thinking) · ${suffix}`,
      }
    }
    if (openai) {
      return {
        format: 'openai-chat',
        label: 'OpenAI Chat Completions',
        detail: `Message-level tool_calls / tool_call_id · ${suffix}`,
      }
    }
    return {
      format: 'request-log',
      label: 'LLM Request Log',
      detail: `Prefix-reconstructed conversations · ${suffix}`,
    }
  }
  if (ordinary.length > 0) {
    const events = ordinary.filter((r) => looksLikeEventRecord(r.data)).length
    if (events > ordinary.length / 2) {
      return {
        format: 'event-log',
        label: 'Agent Event Log',
        detail: `${events} typed event records`,
      }
    }
    return {
      format: 'openai-chat',
      label: 'Message Log',
      detail: `${ordinary.length} per-line message records`,
    }
  }
  return { format: 'unknown', label: 'Unknown format', detail: 'No recognizable records' }
}

/* ------------------------------------------------------------------ */
/* Top-level normalization                                             */
/* ------------------------------------------------------------------ */

export function normalizeTrace(parsed: ParseResult): NormalizedTrace {
  // Partition request-log snapshots from ordinary records
  const requestLogRecords: RawRecord[] = []
  const ordinaryRecords: RawRecord[] = []
  for (const record of parsed.records) {
    if (isRequestLogRecord(record.data)) requestLogRecords.push(record)
    else ordinaryRecords.push(record)
  }

  // Group records by conversation id
  const groups = new Map<string, RawRecord[]>()
  const orphanRecords: RawRecord[] = []

  for (const record of ordinaryRecords) {
    const convId = pickString(record.data, CONVERSATION_ID_KEYS)
    const key = convId ?? '(no conversation id)'
    let arr = groups.get(key)
    if (!arr) {
      arr = []
      groups.set(key, arr)
    }
    arr.push(record)
  }

  const conversations = []
  for (const [convId, records] of groups) {
    // Split records into message records and standalone event records
    const messages: TraceMessage[] = []
    const byId = new Map<string, TraceMessage>()
    const pendingEvents: RawRecord[] = []

    let syntheticCounter = 0
    for (const record of records) {
      const obj = record.data
      if (looksLikeEventRecord(obj)) {
        pendingEvents.push(record)
        continue
      }
      const hasMessageShape =
        pickString(obj, ROLE_KEYS) !== undefined ||
        pick(obj, CONTENT_KEYS) !== undefined ||
        pickString(obj, MESSAGE_ID_KEYS) !== undefined
      if (!hasMessageShape) {
        pendingEvents.push(record)
        continue
      }
      syntheticCounter += 1
      const msg = buildMessage(record, convId, `msg_${syntheticCounter}`)
      // De-dup: if two records share an id, merge the later into the earlier
      const existing = byId.get(msg.id)
      if (existing) {
        existing.raw.push(record)
        existing.events.push(...msg.events)
        existing.toolCalls.push(...msg.toolCalls)
        existing.fileChanges = dedupeFileChanges([...existing.fileChanges, ...msg.fileChanges])
        existing.commands.push(...msg.commands)
        existing.stateChanges.push(...msg.stateChanges)
        existing.errors.push(...msg.errors)
        if (!existing.contentText && msg.contentText) {
          existing.content = msg.content
          existing.contentText = msg.contentText
        }
        existing.model ??= msg.model
        existing.durationMs ??= msg.durationMs
        existing.tokens ??= msg.tokens
        existing.status ??= msg.status
      } else {
        messages.push(msg)
        byId.set(msg.id, msg)
      }
    }

    // Attach standalone event records to their messages
    const unattached: RawRecord[] = []
    for (const record of pendingEvents) {
      const ref = refMessageId(record.data)
      let target = ref ? byId.get(ref) : undefined
      if (!target) {
        // Fall back to the nearest message that precedes the event in the file
        for (const m of messages) {
          if (m.line < record.line) target = m
          else break
        }
        target ??= messages[0]
      }
      if (target) attachEventRecord(target, record)
      else unattached.push(record)
    }
    orphanRecords.push(...unattached)

    if (messages.length > 0) {
      conversations.push(buildConversation(convId, messages, byId))
    }
  }

  conversations.push(...buildRequestLogConversations(requestLogRecords))

  // Sort conversations by first line for stable ordering
  conversations.sort((a, b) => (a.messages[0]?.line ?? 0) - (b.messages[0]?.line ?? 0))

  return {
    fileName: parsed.fileName,
    formatInfo: detectFormat(requestLogRecords, ordinaryRecords),
    conversations,
    errors: parsed.errors,
    totalLines: parsed.totalLines,
    recordCount: parsed.records.length,
    orphanRecords,
  }
}
