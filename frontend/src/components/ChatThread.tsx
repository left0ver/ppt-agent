import { EditOutlined } from '@ant-design/icons'
import { Sender } from '@ant-design/x'
import { Button, Card, Tag, Typography } from 'antd'
import InterruptCard from './InterruptCard'
import type { SessionMessage, SessionStage, SessionStatus } from '../types'

const { Paragraph, Text, Title } = Typography

interface ChatThreadProps {
  sessionTitle: string
  sessionStatus: SessionStatus
  sessionStage: SessionStage
  hasActiveSession?: boolean
  loading: boolean
  actionLoading?: boolean
  messages: SessionMessage[]
  pendingInterruptId: string | null
  requirement: string
  onRequirementChange: (value: string) => void
  onRename: () => void
  onSend: () => void
  onSubmitInterrupt: (messageId: string, payload: unknown) => void
}

function getMessageBody(message: SessionMessage): string {
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content
  }

  if (message.type === 'error') {
    const payload =
      message.payload && typeof message.payload === 'object'
        ? (message.payload as { message?: unknown }).message
        : null
    if (typeof payload === 'string' && payload.trim()) {
      return payload
    }
    return '执行失败'
  }

  if (message.type === 'interrupt_response') {
    return '已提交回复'
  }

  if (message.type === 'status') {
    return '状态已更新'
  }

  return ''
}

export function ChatThread({
  sessionTitle,
  sessionStatus,
  sessionStage,
  hasActiveSession = true,
  loading,
  actionLoading = false,
  messages,
  pendingInterruptId,
  requirement,
  onRequirementChange,
  onRename,
  onSend,
  onSubmitInterrupt,
}: ChatThreadProps) {
  const hasPendingInterrupt = Boolean(pendingInterruptId)
  const senderDisabled =
    !hasActiveSession || loading || hasPendingInterrupt || sessionStatus === 'running'
  const senderPlaceholder = hasPendingInterrupt
    ? '请先完成上方待处理卡片'
    : !hasActiveSession
      ? '先创建会话'
    : sessionStatus === 'running'
      ? '当前会话正在处理中'
      : '输入消息，Enter 发送'

  return (
    <Card className="chat-card" bordered={false}>
      <div className="chat-thread__header">
        <div>
          <p className="chat-thread__eyebrow">Session</p>
          <Title level={3}>{sessionTitle}</Title>
          <Paragraph className="chat-thread__subtitle">
            <Tag color={sessionStatus === 'failed' ? 'error' : sessionStatus === 'completed' ? 'success' : 'processing'}>
              {sessionStatus}
            </Tag>
            <Text type="secondary">{sessionStage}</Text>
          </Paragraph>
        </div>
        <Button type="text" icon={<EditOutlined />} onClick={onRename}>
          重命名
        </Button>
      </div>

      <div className="chat-history">
        {messages.length === 0 ? (
          <div className="chat-thread__empty">
            <span className="chat-thread__assistant-avatar">AI</span>
            <div className="chat-thread__empty-copy">
              <Title level={5}>欢迎使用 PPT Agent</Title>
              <Paragraph type="secondary">先在左侧创建或选择一个会话，再输入你的 PPT 需求。</Paragraph>
            </div>
          </div>
        ) : (
          <div className="message-stream">
            {messages.map((message) => {
              if (message.type === 'interrupt') {
                return (
                  <div key={message.id} className="message-row message-row--assistant">
                    <span className="chat-thread__assistant-avatar">AI</span>
                    <InterruptCard
                      message={message}
                      pending={pendingInterruptId === message.id}
                      loading={actionLoading}
                      onSubmit={onSubmitInterrupt}
                    />
                  </div>
                )
              }

              const body = getMessageBody(message)
              if (!body) {
                return null
              }

              const isUser = message.role === 'user'
              return (
                <div
                  key={message.id}
                  className={`message-row ${isUser ? 'message-row--user' : 'message-row--assistant'}`}
                >
                  {!isUser ? <span className="chat-thread__assistant-avatar">AI</span> : null}
                  <div className={`message-bubble message-bubble--${message.type}${isUser ? ' message-bubble--user' : ''}`}>
                    {body}
                  </div>
                  {isUser ? <span className="chat-thread__user-avatar">U</span> : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="sender-wrap">
        <Sender
          value={requirement}
          onChange={onRequirementChange}
          onSubmit={onSend}
          loading={actionLoading && !hasPendingInterrupt}
          placeholder={senderPlaceholder}
          prefix={<Tag bordered={false}>{hasPendingInterrupt ? '待处理卡片中' : '发送到当前会话'}</Tag>}
          disabled={senderDisabled}
        />
      </div>
    </Card>
  )
}

export default ChatThread
