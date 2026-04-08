import type {
  PreviewResult,
  SessionDetail,
  SessionMessageInput,
  SessionPreview,
  SessionStage,
  SessionStatus,
  SessionSummary,
} from './types'

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8000'

export type { PreviewResult, SessionDetail, SessionPreview, SessionStage, SessionStatus, SessionSummary }

export interface InterruptView {
  type: string
  title: string
  payload: unknown
}

export interface SessionData extends SessionPreview {}

export interface ApiResponse {
  thread_id: string
  status: SessionStatus
  stage: SessionStage
  interrupt: InterruptView | null
  data: SessionData | null
  error: { message: string } | null
  session_meta: {
    created_at: string
    updated_at: string
    generated_first_draft_pages: number
    generated_final_ppt_pages: number
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function getApiBaseUrl(): string {
  return API_BASE_URL
}

export async function createSession(): Promise<SessionSummary> {
  return request('/api/sessions', { method: 'POST' })
}

export async function listSessions(): Promise<SessionSummary[]> {
  return request('/api/sessions')
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  return request(`/api/sessions/${sessionId}`)
}

export async function renameSession(sessionId: string, title: string): Promise<SessionSummary> {
  return request(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export async function sendSessionMessage(
  sessionId: string,
  input: SessionMessageInput,
): Promise<SessionDetail> {
  return request(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function uploadContentFiles(sessionId: string, files: File[]): Promise<void> {
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  await request(`/api/sessions/${sessionId}/attachments/content-files`, {
    method: 'POST',
    body: formData,
  })
}

export async function uploadTemplate(sessionId: string, file: File): Promise<void> {
  const formData = new FormData()
  formData.append('file', file)
  await request(`/api/sessions/${sessionId}/attachments/template`, {
    method: 'POST',
    body: formData,
  })
}

// Legacy thread-centric helpers remain available for unfinished follow-up tasks.
export async function startPpt(thread_id: string, ppt_requirement: string): Promise<ApiResponse> {
  return request('/api/ppt/start', {
    method: 'POST',
    body: JSON.stringify({ thread_id, ppt_requirement }),
  })
}

export async function resumePptInfo(
  thread_id: string,
  ppt_info: {
    target_audience: string
    user_role: string
    num_pages: number
    theme: string
    layout_style: 'top_bottom' | 'grid'
  },
): Promise<ApiResponse> {
  return request('/api/ppt/resume/ppt-info', {
    method: 'POST',
    body: JSON.stringify({ thread_id, ppt_info }),
  })
}

export async function resumeContentSources(
  thread_id: string,
  have_ppt_content_files: boolean,
  ppt_content_source_urls: string[],
): Promise<ApiResponse> {
  return request('/api/ppt/resume/content-sources', {
    method: 'POST',
    body: JSON.stringify({ thread_id, have_ppt_content_files, ppt_content_source_urls }),
  })
}

export async function resumeTemplate(
  thread_id: string,
  have_ppt_template: boolean,
): Promise<ApiResponse> {
  return request('/api/ppt/resume/template', {
    method: 'POST',
    body: JSON.stringify({ thread_id, have_ppt_template }),
  })
}

export async function resumeFinalStyle(
  thread_id: string,
  user_ppt_style: string,
): Promise<ApiResponse> {
  return request('/api/ppt/resume/final-style', {
    method: 'POST',
    body: JSON.stringify({ thread_id, user_ppt_style }),
  })
}

export async function getStatus(thread_id: string): Promise<ApiResponse> {
  return request(`/api/ppt/status?thread_id=${thread_id}`)
}

export async function modifyPage(
  thread_id: string,
  ppt_type: '初稿' | '终稿',
  pages: number[],
  user_instruction: string,
): Promise<ApiResponse> {
  return request('/api/ppt/modify', {
    method: 'POST',
    body: JSON.stringify({ thread_id, ppt_type, pages, user_instruction }),
  })
}
