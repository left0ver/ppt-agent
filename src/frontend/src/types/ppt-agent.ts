export type ThreadStatus =
  | 'creating'
  | 'ready'
  | 'running'
  | 'waiting_interrupt'
  | 'completed'
  | 'error'

export type LayoutStyle = 'top_bottom' | 'grid'

export type EditFormInterruptValue = {
  title: string
  type: 'edit_form'
  payload: {
    theme: string
    target_audience: string
    num_pages: number
    user_role: string
    layout_style: LayoutStyle
  }
}

export type InterruptValue =
  | EditFormInterruptValue
  | { title: string; type: 'upload_ppt_content_files'; file_type: string[] }
  | { title: string; type: 'upload_ppt_template'; file_type: string[] }
  | { title: string; type: 'text_input' }

export interface InterruptEnvelope {
  id: string
  value: InterruptValue
}

export interface ThreadReadyEvent {
  type: 'thread_ready'
  threadId: string
}

export interface StartSubmittedEvent {
  type: 'start_submitted'
  threadId: string
  prompt: string
}

export interface StatusReceivedEvent {
  type: 'status_received'
  threadId: string
  text: string
}

export interface InterruptReceivedEvent {
  type: 'interrupt_received'
  threadId: string
  interrupt: InterruptEnvelope
}

export type SessionEvent =
  | ThreadReadyEvent
  | StartSubmittedEvent
  | StatusReceivedEvent
  | InterruptReceivedEvent

export type ChatMessage =
  | { id: string; kind: 'user_prompt'; text: string }
  | { id: string; kind: 'assistant_status'; text: string }
  | { id: string; kind: 'assistant_interrupt'; interrupt: InterruptEnvelope }
  | { id: string; kind: 'user_interrupt_reply'; text: string }
  | { id: string; kind: 'assistant_result_draft'; text: string }
  | { id: string; kind: 'assistant_result_final'; text: string }
  | { id: string; kind: 'assistant_error'; text: string }

export type ChatMessageDraft = ChatMessage extends infer Message
  ? Message extends { id: string }
    ? Omit<Message, 'id'>
    : never
  : never

interface SessionStateBase {
  messages: ChatMessage[]
  messageSequence: number
}

interface CreatingSessionState extends SessionStateBase {
  threadId: null
  composerLocked: false
  threadStatus: 'creating'
  activeInterrupt: null
}

interface ReadySessionState extends SessionStateBase {
  threadId: string
  composerLocked: false
  threadStatus: 'ready'
  activeInterrupt: null
}

interface RunningSessionState extends SessionStateBase {
  threadId: string
  composerLocked: true
  threadStatus: 'running'
  activeInterrupt: null
}

interface WaitingInterruptSessionState extends SessionStateBase {
  threadId: string
  composerLocked: true
  threadStatus: 'waiting_interrupt'
  activeInterrupt: InterruptEnvelope
}

interface CompletedSessionState extends SessionStateBase {
  threadId: string
  composerLocked: false
  threadStatus: 'completed'
  activeInterrupt: null
}

interface ErrorSessionState extends SessionStateBase {
  threadId: string
  composerLocked: false
  threadStatus: 'error'
  activeInterrupt: null
}

export type SessionState =
  | CreatingSessionState
  | ReadySessionState
  | RunningSessionState
  | WaitingInterruptSessionState
  | CompletedSessionState
  | ErrorSessionState
