export type SessionStatus = 'idle' | 'running' | 'interrupted' | 'completed' | 'failed' | string

export type SessionStage =
  | 'idle'
  | 'starting'
  | 'awaiting_ppt_info'
  | 'awaiting_content_sources'
  | 'awaiting_template'
  | 'generating_outline'
  | 'generating_final_ppt'
  | 'awaiting_final_style'
  | 'completed'
  | 'failed'
  | 'modifying_page'
  | string

export interface PreviewResult {
  page: number
  svg_content?: string | null
  svg_url: string
  file_path: string
}

export interface SessionPreview {
  ppt_outline?: unknown
  ppt_page_contents?: unknown[]
  ppt_content_files_markdown_contents?: string[]
  first_draft_results: PreviewResult[]
  final_ppt_results: PreviewResult[]
  response_content?: string
  new_svg_list?: Array<{ page: number; new_svg_content: string }>
}

export interface SessionSummary {
  id: string
  title: string
  status: SessionStatus
  stage: SessionStage
  created_at: string
  updated_at: string
}

export interface SessionMessage {
  id: string
  session_id: string
  role: 'user' | 'ai' | 'system' | string
  type: 'text' | 'status' | 'interrupt' | 'interrupt_response' | 'error' | string
  content: string | null
  payload: unknown
  created_at: string
}

export interface PendingInterrupt {
  id: string
  session_id: string
  interrupt_type: string
  title: string
  payload: unknown
  status: 'pending' | 'resolved' | 'cancelled' | string
  message_id: string
  created_at: string
  resolved_at: string | null
}

export interface SessionDetail {
  session: SessionSummary
  messages: SessionMessage[]
  pending_interrupt: PendingInterrupt | null
  preview: SessionPreview
}

export interface SessionMessageInput {
  type: 'text' | 'interrupt_response'
  content?: string | null
  payload?: unknown
}
