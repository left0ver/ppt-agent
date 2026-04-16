import { Badge, Card, Tag, Typography } from 'antd'
import type { LayoutStyle, ChatMessage, ThreadStatus } from '../../types/ppt-agent'
import Composer from './Composer'
import type { ComposerActionMode } from './Composer'
import MessageList from './MessageList'
import type {
  InterruptSkipHandler,
  InterruptSubmitHandler,
} from '../interrupts/InterruptCard'

const threadStatusText: Record<ThreadStatus, string> = {
  creating: '正在建立新会话',
  ready: '等待输入需求',
  running: '正在生成中',
  waiting_interrupt: '等待你的补充',
  completed: '生成完成',
  error: '当前会话异常',
}

export type ChatPanelProps = {
  messages: ChatMessage[]
  composerActionDisabled: boolean
  composerActionMode: ComposerActionMode
  composerInputDisabled: boolean
  layoutStyleOptions?: LayoutStyle[]
  resolvedInterruptMessageIds?: string[]
  threadId?: string | null
  threadStatus?: ThreadStatus
  onComposerSubmit: (prompt: string) => Promise<void> | void
  onComposerCancel: () => Promise<void> | void
  onComposerContinue: () => Promise<void> | void
  onInterruptSubmit: InterruptSubmitHandler
  onInterruptSkip: InterruptSkipHandler
}

export default function ChatPanel({
  messages,
  composerActionDisabled,
  composerActionMode,
  composerInputDisabled,
  layoutStyleOptions,
  resolvedInterruptMessageIds,
  threadId,
  threadStatus = 'ready',
  onComposerCancel,
  onComposerContinue,
  onComposerSubmit,
  onInterruptSubmit,
  onInterruptSkip,
}: ChatPanelProps) {
  return (
    <Card
      aria-label="PPT 助手聊天面板"
      className="chat-panel"
      variant="borderless"
    >
      <header className="chat-panel__header">
        <div className="chat-panel__meta">
          <Badge color={threadStatus === 'error' ? '#e84545' : '#c8924b'} />
          <Tag variant="filled">{threadId ? '会话ID' : threadStatusText[threadStatus]}</Tag>
          {threadId ? (
            <Typography.Text code ellipsis>
              {threadId}
            </Typography.Text>
          ) : null}
        </div>
      </header>

      <MessageList
        layoutStyleOptions={layoutStyleOptions}
        messages={messages}
        resolvedInterruptMessageIds={resolvedInterruptMessageIds}
        onInterruptSkip={onInterruptSkip}
        onInterruptSubmit={onInterruptSubmit}
      />

      <Composer
        actionDisabled={composerActionDisabled}
        actionMode={composerActionMode}
        inputDisabled={composerInputDisabled}
        onCancel={onComposerCancel}
        onContinue={onComposerContinue}
        onSubmit={onComposerSubmit}
      />
    </Card>
  )
}
