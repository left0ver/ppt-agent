import { Bubble } from '@ant-design/x'
import { Typography } from 'antd'
import type { ChatMessage } from '../../types/ppt-agent'

type NonInterruptMessage = Exclude<ChatMessage, { kind: 'assistant_interrupt' }>

const messageToneByKind: Record<
  NonInterruptMessage['kind'],
  {
    accent: string
    avatar: string
    label: string
    placement: 'start' | 'end'
    variant: 'filled' | 'outlined' | 'shadow' | 'borderless'
  }
> = {
  user_prompt: {
    accent: 'linear-gradient(135deg, #2f6bff 0%, #1e56d4 100%)',
    avatar: '你',
    label: '用户',
    placement: 'end',
    variant: 'shadow',
  },
  user_interrupt_reply: {
    accent: 'linear-gradient(135deg, #2f6bff 0%, #1e56d4 100%)',
    avatar: '补',
    label: '用户补充',
    placement: 'end',
    variant: 'shadow',
  },
  assistant_status: {
    accent: 'linear-gradient(135deg, #f4ddbf 0%, #f9efe2 100%)',
    avatar: 'AI',
    label: '助手进度',
    placement: 'start',
    variant: 'shadow',
  },
  assistant_result_draft: {
    accent: 'linear-gradient(135deg, #fff8ed 0%, #ffffff 100%)',
    avatar: '稿',
    label: '助手初稿',
    placement: 'start',
    variant: 'outlined',
  },
  assistant_result_final: {
    accent: 'linear-gradient(135deg, #fff2dc 0%, #ffffff 100%)',
    avatar: '终',
    label: '助手终稿',
    placement: 'start',
    variant: 'outlined',
  },
  assistant_error: {
    accent: 'linear-gradient(135deg, #ffe5df 0%, #fff7f5 100%)',
    avatar: '!',
    label: '助手错误',
    placement: 'start',
    variant: 'outlined',
  },
}

export type MessageBubbleProps = {
  message: NonInterruptMessage
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const tone = messageToneByKind[message.kind]

  return (
    <div
      aria-label={tone.label}
      className={`chat-bubble-row chat-bubble-row--${tone.placement}`}
    >
      <Bubble
        avatar={
          <div
            className="chat-bubble-avatar"
            style={{
              background: tone.accent,
            }}
          >
            {tone.avatar}
          </div>
        }
        className={`chat-bubble chat-bubble--${tone.placement}`}
        content={
          <Typography.Paragraph className="chat-bubble-text">
            {message.text}
          </Typography.Paragraph>
        }
        header={<span className="chat-bubble-label">{tone.label}</span>}
        placement={tone.placement}
        shape="round"
        variant={tone.variant}
      />
    </div>
  )
}
