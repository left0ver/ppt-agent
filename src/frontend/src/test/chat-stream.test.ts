import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSseChunk, streamChat } from '../lib/chat-stream'

describe('parseSseChunk', () => {
  it('parses a current_stage SSE event block', () => {
    const chunk =
      'event: current_stage\ndata: {"type":"current_stage","data":"正在生成PPT的大纲"}'

    expect(parseSseChunk(chunk)).toEqual([
      {
        event: 'current_stage',
        data: {
          type: 'current_stage',
          data: '正在生成PPT的大纲',
        },
      },
    ])
  })

  it('parses multiple SSE blocks into an array of events', () => {
    const chunk = [
      'event: current_stage',
      'data: {"type":"current_stage","data":"outline"}',
      '',
      'event: message',
      'data: {"type":"reply","data":"done"}',
    ].join('\n')

    expect(parseSseChunk(chunk)).toEqual([
      {
        event: 'current_stage',
        data: {
          type: 'current_stage',
          data: 'outline',
        },
      },
      {
        event: 'message',
        data: {
          type: 'reply',
          data: 'done',
        },
      },
    ])
  })

  it('ignores comment and metadata-only frames', () => {
    const chunk = [
      ': keepalive',
      '',
      'id: 42',
      'retry: 1000',
      '',
      'event: message',
      'data: {"type":"reply","data":"done"}',
    ].join('\n')

    expect(parseSseChunk(chunk)).toEqual([
      {
        event: 'message',
        data: {
          type: 'reply',
          data: 'done',
        },
      },
    ])
  })

  it('supports CRLF separators and blank lines with whitespace', () => {
    const chunk =
      'event: current_stage\r\n' +
      'data: {"type":"current_stage","data":"outline"}\r\n' +
      '\r\n' +
      '   \r\n' +
      'event: message\r\n' +
      'data: {"type":"reply","data":"done"}'

    expect(parseSseChunk(chunk)).toEqual([
      {
        event: 'current_stage',
        data: {
          type: 'current_stage',
          data: 'outline',
        },
      },
      {
        event: 'message',
        data: {
          type: 'reply',
          data: 'done',
        },
      },
    ])
  })

  it('parses newline-delimited JSON events from the current backend transport', () => {
    const chunk =
      '{"data":{"type":"current_stage","data":"正在确认PPT的具体需求"},"raw_data":null,"event":"current_stage","id":null,"retry":null,"comment":null}\n' +
      '{"data":{"type":"interrupts","data":[{"value":{"title":"请确认或者修改以下PPT的相关信息，确认无误后点击提交","type":"edit_form","payload":{"theme":"DeepSeek","target_audience":"导师和同学","num_pages":10,"user_role":"学生","layout_style":"top_bottom"}},"id":"interrupt-1"}]},"raw_data":null,"event":"interrupts","id":null,"retry":null,"comment":null}'

    expect(parseSseChunk(chunk.split('\n')[0]!)).toEqual([
      {
        event: 'current_stage',
        data: {
          type: 'current_stage',
          data: '正在确认PPT的具体需求',
        },
      },
    ])

    expect(parseSseChunk(chunk.split('\n')[1]!)).toEqual([
      {
        event: 'interrupts',
        data: {
          type: 'interrupts',
          data: [
            {
              value: {
                title: '请确认或者修改以下PPT的相关信息，确认无误后点击提交',
                type: 'edit_form',
                payload: {
                  theme: 'DeepSeek',
                  target_audience: '导师和同学',
                  num_pages: 10,
                  user_role: '学生',
                  layout_style: 'top_bottom',
                },
              },
              id: 'interrupt-1',
            },
          ],
        },
      },
    ])
  })
})

describe('streamChat', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when the response body is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: null,
      text: vi.fn().mockResolvedValue('missing body'),
    } as unknown as Response)

    await expect(
      streamChat({
        thread_id: 'thread-1',
        type: 'start',
        user_input: 'hello',
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow()
  })

  it('forwards each parsed SSE event to onEvent', async () => {
    const onEvent = vi.fn()
    const payload = [
      'event: current_stage',
      'data: {"type":"current_stage","data":"outline"}',
      '',
      'event: message',
      'data: {"type":"reply","data":"done"}',
      '',
    ].join('\n')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload))
          controller.close()
        },
      }),
      text: vi.fn().mockResolvedValue(''),
    } as unknown as Response)

    await streamChat({
      thread_id: 'thread-1',
      type: 'start',
      user_input: 'hello',
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      event: 'current_stage',
      data: {
        type: 'current_stage',
        data: 'outline',
      },
    })
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      event: 'message',
      data: {
        type: 'reply',
        data: 'done',
      },
    })
  })

  it('delivers CRLF-delimited frames incrementally and skips keepalive frames', async () => {
    const onEvent = vi.fn()
    const encoder = new TextEncoder()
    let releaseSecondChunk: (() => void) | undefined
    const secondChunkReady = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: current_stage\r\n' +
                'data: {"type":"current_stage","data":"outline"}\r\n' +
                '\r\n' +
                ' \r\n',
            ),
          )
          await secondChunkReady
          controller.enqueue(
            encoder.encode(
              ': keepalive\r\n' +
                '\r\n' +
                'event: message\r\n' +
                'data: {"type":"reply","data":"done"}\r\n' +
                '\r\n',
            ),
          )
          controller.close()
        },
      }),
      text: vi.fn().mockResolvedValue(''),
    } as unknown as Response)

    const streamPromise = streamChat({
      thread_id: 'thread-1',
      type: 'start',
      user_input: 'hello',
      onEvent,
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledTimes(1)
      expect(onEvent).toHaveBeenNthCalledWith(1, {
        event: 'current_stage',
        data: {
          type: 'current_stage',
          data: 'outline',
        },
      })
    })

    releaseSecondChunk?.()

    await streamPromise

    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      event: 'message',
      data: {
        type: 'reply',
        data: 'done',
      },
    })
  })

  it('forwards newline-delimited JSON events from the current backend implementation', async () => {
    const onEvent = vi.fn()
    const payload = [
      '{"data":{"type":"current_stage","data":"正在确认PPT的具体需求"},"raw_data":null,"event":"current_stage","id":null,"retry":null,"comment":null}\n',
      '{"data":{"type":"interrupts","data":[{"value":{"title":"请确认或者修改以下PPT的相关信息，确认无误后点击提交","type":"edit_form","payload":{"theme":"DeepSeek","target_audience":"导师和同学","num_pages":10,"user_role":"学生","layout_style":"top_bottom"}},"id":"interrupt-1"}]},"raw_data":null,"event":"interrupts","id":null,"retry":null,"comment":null}\n',
    ].join('')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload))
          controller.close()
        },
      }),
      text: vi.fn().mockResolvedValue(''),
    } as unknown as Response)

    await streamChat({
      thread_id: 'thread-1',
      type: 'start',
      user_input: 'hello',
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      event: 'current_stage',
      data: {
        type: 'current_stage',
        data: '正在确认PPT的具体需求',
      },
    })
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      event: 'interrupts',
      data: {
        type: 'interrupts',
        data: [
          {
            value: {
              title: '请确认或者修改以下PPT的相关信息，确认无误后点击提交',
              type: 'edit_form',
              payload: {
                theme: 'DeepSeek',
                target_audience: '导师和同学',
                num_pages: 10,
                user_role: '学生',
                layout_style: 'top_bottom',
              },
            },
            id: 'interrupt-1',
          },
        ],
      },
    })
  })
})
