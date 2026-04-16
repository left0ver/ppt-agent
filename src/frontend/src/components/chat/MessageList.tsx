import { Empty } from 'antd'
import { useEffect, useRef } from 'react'
import type { LayoutStyle, ChatMessage } from '../../types/ppt-agent'
import MessageBubble from './MessageBubble'
import InterruptCard, {
  type InterruptSkipHandler,
  type InterruptSubmitHandler,
} from '../interrupts/InterruptCard'

export type MessageListProps = {
  messages: ChatMessage[]
  layoutStyleOptions?: LayoutStyle[]
  resolvedInterruptMessageIds?: string[]
  onInterruptSubmit: InterruptSubmitHandler
  onInterruptSkip: InterruptSkipHandler
}

export default function MessageList({
  messages,
  layoutStyleOptions,
  resolvedInterruptMessageIds,
  onInterruptSubmit,
  onInterruptSkip,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!scrollRef.current || typeof scrollRef.current.scrollTo !== 'function') {
      return
    }

    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  if (messages.length === 0) {
    return (
      <section
        aria-label="消息时间线"
        className="chat-empty-state"
      >
        <Empty
          description="输入需求后，助手会在这里展示阶段进度、补充卡片与生成结果。"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </section>
    )
  }

  return (
    <section
      ref={scrollRef}
      aria-label="消息时间线"
      className="chat-message-list"
    >
      {messages.map((message) =>
        message.kind === 'assistant_interrupt' ? (
          <div
            key={message.id}
            className="chat-bubble-row chat-bubble-row--start"
          >
            <InterruptCard
              messageId={message.id}
              interrupt={message.interrupt}
              layoutStyleOptions={layoutStyleOptions}
              resolved={resolvedInterruptMessageIds?.includes(message.id) ?? false}
              onSkip={onInterruptSkip}
              onSubmit={onInterruptSubmit}
            />
          </div>
        ) : (
          <MessageBubble key={message.id} message={message} />
        ),
      )}
    </section>
  )
}
