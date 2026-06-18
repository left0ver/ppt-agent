export const API_BASE = import.meta.env.VITE_API_BASE_URL

export type NormalizedApiError = {
  detail?: unknown
  error: Error
  message: string
}

function formatFastApiDetail(detail: unknown): string | undefined {
  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim()
        }

        if (
          item &&
          typeof item === 'object' &&
          'msg' in item &&
          typeof item.msg === 'string'
        ) {
          return item.msg.trim()
        }

        return ''
      })
      .filter(Boolean)

    if (messages.length > 0) {
      return messages.join('; ')
    }
  }

  return undefined
}

function parseApiErrorMessage(rawMessage: string): {
  detail?: unknown
  message: string
} {
  const message = rawMessage.trim()

  if (!message) {
    return { message: '请求失败' }
  }

  try {
    const parsed = JSON.parse(message) as unknown

    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      const detail = parsed.detail
      const detailMessage = formatFastApiDetail(detail)

      if (detailMessage) {
        return { detail, message: detailMessage }
      }

      return { detail, message }
    }
  } catch {
    // Ignore non-JSON payloads and fall back to the raw message.
  }

  return { message }
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  if (error instanceof Error) {
    const normalized = parseApiErrorMessage(error.message)

    if (normalized.message === error.message) {
      return {
        detail: normalized.detail,
        error,
        message: normalized.message,
      }
    }

    return {
      detail: normalized.detail,
      error: new Error(normalized.message, { cause: error }),
      message: normalized.message,
    }
  }

  if (typeof error === 'string') {
    const normalized = parseApiErrorMessage(error)

    return {
      detail: normalized.detail,
      error: new Error(normalized.message),
      message: normalized.message,
    }
  }

  return {
    error: new Error('请求失败', { cause: error }),
    message: '请求失败',
  }
}

export async function createSessionId(
  signal?: AbortSignal,
): Promise<{ thread_id: string }> {
  const response = await fetch(`${API_BASE}/create_session_id`, {
    method: 'GET',
    signal,
  })

  if (!response.ok) {
    throw Error('创建会话失败')
  }

  return response.json()
}

export async function getLayoutStyles(
  signal?: AbortSignal,
): Promise<{ layout_styles: string[] }> {
  const response = await fetch(`${API_BASE}/layout_styles`, {
    method: 'GET',
    signal,
  })

  if (!response.ok) {
    throw new Error('获取布局风格失败')
  }

  return response.json()
}

export async function cancelAgent({
  threadId,
}: {
  threadId: string
}): Promise<{
  resumable: boolean
  status: string
  thread_id: string
}> {
  const response = await fetch(`${API_BASE}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
    }),
  })

  if (!response.ok) {
    throw await response.text()
  }

  return response.json()
}

type UploadContentFilesParams = {
  threadId: string
  files: File[]
}

export async function uploadContentFiles({
  threadId,
  files,
}: UploadContentFilesParams): Promise<{
  file_dir: string
  status: string
  thread_id: string
}> {
  const formData = new FormData()
  formData.append('thread_id', threadId)

  for (const file of files) {
    formData.append('files', file)
  }

  const response = await fetch(`${API_BASE}/upload/content_files`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw await response.text()
  }

  return response.json()
}

type UploadTemplateFileParams = {
  threadId: string
  file: File
}

export async function uploadTemplateFile({
  threadId,
  file,
}: UploadTemplateFileParams): Promise<{
  status: string
  template_file_path: string
  thread_id: string
}> {
  const formData = new FormData()
  formData.append('thread_id', threadId)
  formData.append('file', file)

  const response = await fetch(`${API_BASE}/upload/ppt_template`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw await response.text()
  }

  return response.json()
}
