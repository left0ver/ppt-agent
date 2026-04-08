export interface SessionSummary {
  id: string
  title: string
  status: string
  stage: string
  created_at: string
  updated_at: string
}

export interface SessionMessage {
  id: string
  role: 'user' | 'ai' | 'system'
  type: 'text' | 'status' | 'interrupt' | 'error'
  content: string
  payload: unknown
  created_at: string
}

export interface PendingInterrupt {
  id: string
  interrupt_type: string
  title: string
  payload: unknown
  status: 'pending' | 'resolved' | 'cancelled'
  message_id: string
}

export interface SessionDetail {
  session: SessionSummary
  messages: SessionMessage[]
  pending_interrupt: PendingInterrupt | null
  preview: {
    first_draft_results: unknown[]
    final_ppt_results: unknown[]
  }
}
