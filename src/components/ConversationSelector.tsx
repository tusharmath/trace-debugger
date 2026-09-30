import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Conversation } from '@/types/trace'

interface ConversationSelectorProps {
  conversations: Conversation[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ConversationSelector({
  conversations,
  selectedId,
  onSelect,
}: ConversationSelectorProps) {
  return (
    <Select value={selectedId ?? undefined} onValueChange={onSelect}>
      <SelectTrigger size="sm" className="h-7 w-72 rounded-none font-mono text-xs">
        <SelectValue placeholder="Select conversation…" />
      </SelectTrigger>
      <SelectContent className="rounded-none">
        {conversations.map((c) => (
          <SelectItem key={c.id} value={c.id} className="rounded-none font-mono text-xs">
            <span className="truncate">{c.id}</span>
            <span className="text-muted-foreground">
              · {c.messages.length} msg
              {c.forkCount > 0 && ` · ${c.forkCount} fork${c.forkCount > 1 ? 's' : ''}`}
              {c.errorCount > 0 && ` · ${c.errorCount} err`}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
