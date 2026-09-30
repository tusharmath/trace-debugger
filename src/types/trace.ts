/** Normalized internal trace representation consumed by the UI. */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

/** A single raw JSONL record, retained verbatim. */
export interface RawRecord {
  /** 1-based line number in the source file. */
  line: number
  /** Parsed JSON payload. */
  data: JsonObject
}

/** A malformed line that failed to parse. */
export interface ParseError {
  line: number
  message: string
  /** Truncated snippet of the offending raw text. */
  snippet: string
}

export interface ParseResult {
  records: RawRecord[]
  errors: ParseError[]
  totalLines: number
  fileName: string
}

export type MessageRole =
  | 'user'
  | 'assistant'
  | 'system'
  | 'tool'
  | 'unknown'

export interface ToolCall {
  id?: string
  name: string
  args?: JsonValue
  result?: JsonValue
  status?: 'ok' | 'error' | 'pending'
  durationMs?: number
  raw: JsonValue
}

export type TraceEventKind =
  | 'tool_call'
  | 'tool_result'
  | 'reasoning'
  | 'retry'
  | 'error'
  | 'file_change'
  | 'command'
  | 'state_change'
  | 'artifact'
  | 'generic'

export interface TraceEvent {
  kind: TraceEventKind
  label: string
  timestamp?: string
  detail?: string
  raw: JsonValue
  /** Source line, if the event came from its own record. */
  line?: number
}

export type FileChangeKind = 'created' | 'modified' | 'deleted' | 'renamed'

export interface FileChange {
  kind: FileChangeKind
  path: string
  oldPath?: string
  diff?: string
  before?: string
  after?: string
  raw: JsonValue
}

export interface CommandExecution {
  command: string
  exitCode?: number
  output?: string
  durationMs?: number
  raw: JsonValue
}

export interface StateChange {
  key: string
  before?: JsonValue
  after?: JsonValue
  raw: JsonValue
}

export interface TokenUsage {
  input?: number
  output?: number
  total?: number
}

/** A normalized message node in a conversation. */
export interface TraceMessage {
  id: string
  parentId: string | null
  conversationId: string
  role: MessageRole
  /** Preserve original ordering by first source line. */
  line: number
  timestamp?: string
  model?: string
  content?: JsonValue
  contentText: string
  toolCalls: ToolCall[]
  events: TraceEvent[]
  fileChanges: FileChange[]
  commands: CommandExecution[]
  stateChanges: StateChange[]
  errors: string[]
  durationMs?: number
  tokens?: TokenUsage
  status?: string
  /** All raw records that contributed to this message. */
  raw: RawRecord[]
  /** True when the id was synthesized (no explicit message id). */
  syntheticId: boolean
}

export interface TreeNode {
  message: TraceMessage
  children: TreeNode[]
  /** Depth from the root. */
  depth: number
  /** True when the parent has >1 child and this is not the first. */
  isForkBranch: boolean
}

export interface Conversation {
  id: string
  messages: TraceMessage[]
  /** Messages by id. */
  byId: Map<string, TraceMessage>
  roots: TreeNode[]
  /** Count of messages containing errors. */
  errorCount: number
  toolCallCount: number
  forkCount: number
}

/** Detected source format of the loaded trace file. */
export type TraceFormat =
  | 'anthropic-messages'
  | 'openai-chat'
  | 'request-log'
  | 'event-log'
  | 'forge-http-trace'
  | 'unknown'

export interface TraceFormatInfo {
  format: TraceFormat
  /** Human-readable label shown in the UI. */
  label: string
  /** Short explanation of what was detected. */
  detail: string
}

export interface NormalizedTrace {
  fileName: string
  formatInfo: TraceFormatInfo
  conversations: Conversation[]
  errors: ParseError[]
  totalLines: number
  recordCount: number
  /** Records that could not be associated with any conversation. */
  orphanRecords: RawRecord[]
}
