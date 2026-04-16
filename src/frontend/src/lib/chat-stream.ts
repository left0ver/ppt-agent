import { API_BASE } from './ppt-agent-api'

export type ParsedSseEvent = {
  event: string
  data: unknown
}

const SSE_FRAME_SEPARATOR =
  /(?:\r\n|\r(?!\n)|(?<!\r)\n)[\t\f\v ]*(?:\r\n|\r(?!\n)|(?<!\r)\n)/
const SSE_LINE_SEPARATOR = /\r\n|\r(?!\n)|(?<!\r)\n/

function extractCompleteSseFrames(buffer: string): {
  frames: string[]
  remainder: string
} {
  const frames: string[] = []
  let remainder = buffer

  while (true) {
    const separatorMatch = remainder.match(SSE_FRAME_SEPARATOR)

    if (!separatorMatch || separatorMatch.index === undefined) {
      return { frames, remainder }
    }

    frames.push(remainder.slice(0, separatorMatch.index))
    remainder = remainder.slice(separatorMatch.index + separatorMatch[0].length)
  }
}

function extractCompleteJsonLines(buffer: string): {
  frames: string[]
  remainder: string
} {
  const lines = buffer.split(SSE_LINE_SEPARATOR)

  if (lines.length <= 1) {
    return {
      frames: [],
      remainder: buffer,
    }
  }

  const remainder = lines.pop() ?? ''

  return {
    frames: lines.map((line) => line.trim()).filter(Boolean),
    remainder,
  }
}

function isJsonLineTransport(buffer: string): boolean {
  const trimmedBuffer = buffer.trimStart()

  return trimmedBuffer.startsWith('{')
}

export function parseSseChunk(chunk: string): ParsedSseEvent[] {
  const trimmedChunk = chunk.trim()

  if (!trimmedChunk) {
    return []
  }

  if (trimmedChunk.startsWith('{')) {
    const parsed = JSON.parse(trimmedChunk) as {
      data?: unknown
      event?: unknown
    }

    return [
      {
        event: typeof parsed.event === 'string' ? parsed.event : 'message',
        data: parsed.data,
      },
    ]
  }

  return chunk
    .split(SSE_FRAME_SEPARATOR)
    .filter((block) => block.trim())
    .flatMap((block) => {
      let event = 'message'
      const dataLines: string[] = []

      for (const line of block.split(SSE_LINE_SEPARATOR)) {
        if (!line.trim()) {
          continue
        }

        const trimmedLine = line.trimStart()

        if (trimmedLine.startsWith(':')) {
          continue
        }

        if (trimmedLine.startsWith('event:')) {
          event = trimmedLine.slice('event:'.length).trim()
          continue
        }

        if (trimmedLine.startsWith('data:')) {
          dataLines.push(trimmedLine.slice('data:'.length).trim())
        }
      }

      if (dataLines.length === 0) {
        return []
      }

      return [
        {
          event,
          data: JSON.parse(dataLines.join('\n')),
        },
      ]
    })
}

type StreamChatParams = {
  thread_id: string
  type: 'start' | 'hitl_resume' | 'abort_resume'
  user_input: string | Record<string, unknown> | null
  signal?: AbortSignal
  onEvent: (event: ParsedSseEvent) => void
}

export async function streamChat({
  thread_id,
  type,
  user_input,
  signal,
  onEvent,
}: StreamChatParams): Promise<void> {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      thread_id,
      type,
      user_input,
    }),
    signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(await response.text())
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })

    const { frames, remainder } = isJsonLineTransport(buffer)
      ? extractCompleteJsonLines(buffer)
      : extractCompleteSseFrames(buffer)
    buffer = remainder

    for (const chunk of frames) {
      if (!chunk.trim()) {
        continue
      }

      for (const event of parseSseChunk(chunk)) {
        onEvent(event)
      }
    }
  }

  buffer += decoder.decode()

  if (buffer.trim()) {
    for (const event of parseSseChunk(buffer)) {
      onEvent(event)
    }
  }
}
