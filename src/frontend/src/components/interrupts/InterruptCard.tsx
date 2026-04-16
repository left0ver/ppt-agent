import { Bubble } from '@ant-design/x'
import type { ReactNode } from 'react'
import type {
  EditFormInterruptValue,
  InterruptEnvelope,
  InterruptValue,
  LayoutStyle,
} from '../../types/ppt-agent'
import ContentUploadInterruptCard from './ContentUploadInterruptCard'
import EditFormInterruptCard from './EditFormInterruptCard'
import StyleInputInterruptCard from './StyleInputInterruptCard'
import TemplateUploadInterruptCard from './TemplateUploadInterruptCard'

export type InterruptActionContext = {
  messageId: string
  interruptId: string
  interruptType: InterruptValue['type']
  interruptTitle: string
}

export type InterruptSubmitHandler<Payload = Record<string, unknown>> = (
  context: InterruptActionContext,
  payload: Payload,
) => Promise<void> | void

export type InterruptSkipHandler = (
  context: InterruptActionContext,
) => Promise<void> | void

export type InterruptCardProps = {
  messageId: string
  interrupt: InterruptEnvelope
  layoutStyleOptions?: LayoutStyle[]
  resolved?: boolean
  onSubmit: InterruptSubmitHandler
  onSkip: InterruptSkipHandler
}

function InterruptShell({
  children,
}: {
  children: ReactNode
}) {
  return (
    <Bubble
      avatar={<div className="chat-bubble-avatar">AI</div>}
      className="chat-bubble chat-bubble--start"
      content={children}
      header={<span className="chat-bubble-label">助手补充请求</span>}
      placement="start"
      shape="round"
      variant="shadow"
    />
  )
}

export default function InterruptCard({
  messageId,
  interrupt,
  layoutStyleOptions,
  resolved = false,
  onSubmit,
  onSkip,
}: InterruptCardProps) {
  const actionContext: InterruptActionContext = {
    messageId,
    interruptId: interrupt.id,
    interruptType: interrupt.value.type,
    interruptTitle: interrupt.value.title,
  }

  switch (interrupt.value.type) {
    case 'edit_form':
      return (
        <InterruptShell>
          <EditFormInterruptCard
            actionContext={actionContext}
            disabled={resolved}
            interrupt={interrupt as InterruptEnvelope<EditFormInterruptValue>}
            layoutStyleOptions={layoutStyleOptions}
            onSubmit={onSubmit}
          />
        </InterruptShell>
      )
    case 'upload_ppt_content_files':
      return (
        <InterruptShell>
          <ContentUploadInterruptCard
            actionContext={actionContext}
            disabled={resolved}
            interrupt={
              interrupt as InterruptEnvelope<
                Extract<InterruptValue, { type: 'upload_ppt_content_files' }>
              >
            }
            onSkip={onSkip}
            onSubmit={onSubmit}
          />
        </InterruptShell>
      )
    case 'upload_ppt_template':
      return (
        <InterruptShell>
          <TemplateUploadInterruptCard
            actionContext={actionContext}
            disabled={resolved}
            interrupt={
              interrupt as InterruptEnvelope<
                Extract<InterruptValue, { type: 'upload_ppt_template' }>
              >
            }
            onSkip={onSkip}
            onSubmit={onSubmit}
          />
        </InterruptShell>
      )
    case 'text_input':
      return (
        <InterruptShell>
          <StyleInputInterruptCard
            actionContext={actionContext}
            disabled={resolved}
            interrupt={
              interrupt as InterruptEnvelope<Extract<InterruptValue, { type: 'text_input' }>>
            }
            onSubmit={onSubmit}
          />
        </InterruptShell>
      )
  }
}
