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

export interface InterruptEnvelope<TValue extends InterruptValue = InterruptValue> {
  id: string
  value: TValue
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

export interface InterruptResponseRecordedEvent {
  type: 'interrupt_response_recorded'
  threadId: string
  text: string
}

export interface DraftGeneratedEvent {
  type: 'draft_generated'
  threadId: string
  text: string
}

export interface FinalGeneratedEvent {
  type: 'final_generated'
  threadId: string
  text: string
}

export interface ErrorReceivedEvent {
  type: 'error_received'
  threadId: string
  text: string
}

export type SessionEvent =
  | ThreadReadyEvent
  | StartSubmittedEvent
  | StatusReceivedEvent
  | InterruptReceivedEvent
  | InterruptResponseRecordedEvent
  | DraftGeneratedEvent
  | FinalGeneratedEvent
  | ErrorReceivedEvent

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

export type GeneratedSlideResult = {
  file_path: string
  page_index: number
  svg_content: string
}

export type FirstDraftEventPayload = {
  first_draft_results: GeneratedSlideResult[]
}

export type FinalPptEventPayload = {
  final_ppt_results: GeneratedSlideResult[]
}

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
