import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import ChatPanel from '../components/chat/ChatPanel'
import FullscreenSlideViewer from '../components/preview/FullscreenSlideViewer'
import PreviewEmptyState from '../components/preview/PreviewEmptyState'
import PreviewSidebar, {
  type DeckVersion,
  type SlidePreview,
} from '../components/preview/PreviewSidebar'
import { exportSlidesAsPpt } from '../lib/ppt-export'
import type { ChatMessage } from '../types/ppt-agent'

const pptWriteFileMock = vi.fn<() => Promise<void>>()
const pptAddImageMock = vi.fn()
const pptInstances: Array<{
  layout: string
  slides: Array<{
    addImage: typeof pptAddImageMock
  }>
}> = []

vi.mock('pptxgenjs', () => ({
  default: class MockPptxGenJS {
    layout = ''
    slides: Array<{ addImage: typeof pptAddImageMock }> = []

    constructor() {
      pptInstances.push(this)
    }

    addSlide() {
      const slide = {
        addImage: pptAddImageMock,
      }
      this.slides.push(slide)
      return slide
    }

    writeFile = pptWriteFileMock
  },
}))

function createSseResponse(...frames: string[]) {
  return new Response(frames.join(''), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

function getRequestBody(mock: { mock: { calls: unknown[][] } }, callIndex: number) {
  const [, init] = mock.mock.calls[callIndex] ?? []
  const requestInit = (init ?? {}) as RequestInit

  return String(requestInit.body ?? '')
}

function PreviewIntegrationHarness() {
  const [activeDeckVersion, setActiveDeckVersion] = useState<DeckVersion>('draft')
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [draftSlides, setDraftSlides] = useState<SlidePreview[]>([
    {
      id: 'draft-1',
      title: 'Draft 1',
      thumbnailLabel: '查看第 1 页',
      previewMode: 'draft',
      svgContent: '<svg><text>draft-1</text></svg>',
    },
    {
      id: 'draft-2',
      title: 'Draft 2',
      thumbnailLabel: '查看第 2 页',
      previewMode: 'draft',
      svgContent: '<svg><text>draft-2</text></svg>',
    },
  ])
  const [finalSlides, setFinalSlides] = useState<SlidePreview[]>([
    {
      id: 'final-1',
      title: 'Final 1',
      thumbnailLabel: '查看第 1 页',
      previewMode: 'final',
      svgContent: '<svg><text>final-1</text></svg>',
    },
    {
      id: 'final-2',
      title: 'Final 2',
      thumbnailLabel: '查看第 2 页',
      previewMode: 'final',
      svgContent: '<svg><text>final-2</text></svg>',
    },
  ])

  const slidesByVersion: Record<DeckVersion, SlidePreview[]> = {
    draft: draftSlides,
    final: finalSlides,
  }
  const slides = slidesByVersion[activeDeckVersion]
  const selectedSlide = selectedSlideId
    ? slides.find((slide) => slide.id === selectedSlideId) ?? null
    : null
  const selectedSlideIndex = selectedSlide
    ? slides.findIndex((slide) => slide.id === selectedSlide.id)
    : -1

  return (
    <div>
      <PreviewSidebar
        activeDeckVersion={activeDeckVersion}
        canViewDraft={slidesByVersion.draft.length > 0}
        canViewFinal={slidesByVersion.final.length > 0}
        selectedSlideId={selectedSlideId}
        selectedSlideIndex={selectedSlideIndex}
        slides={slides}
        onDeckVersionChange={(nextVersion) => {
          setActiveDeckVersion(nextVersion)
          setSelectedSlideId(null)
          setFullscreenOpen(false)
        }}
        onThumbnailClick={(slideIndex) => {
          setSelectedSlideId(slides[slideIndex]?.id ?? null)
          setFullscreenOpen(true)
        }}
        onThumbnailSelect={({ slideId }) => {
          setSelectedSlideId(slideId)
        }}
      />

      <button type="button" onClick={() => setSelectedSlideId('stale-slide-id')}>
        设为过期页面标识
      </button>
      <button
        type="button"
        onClick={() =>
          setDraftSlides([
            {
              id: 'draft-2',
              title: 'Draft 2',
              thumbnailLabel: '查看第 1 页',
              previewMode: 'draft',
              svgContent: '<svg><text>draft-2</text></svg>',
            },
          ])
        }
      >
        缩减草稿页
      </button>
      <button
        type="button"
        onClick={() =>
          setFinalSlides([
            {
              id: 'final-2',
              title: 'Final 2',
              thumbnailLabel: '查看第 1 页',
              previewMode: 'final',
              svgContent: '<svg><text>final-2</text></svg>',
            },
          ])
        }
      >
        缩减终稿页
      </button>

      <div aria-label="left-preview-panel">
        <PreviewEmptyState />
      </div>

      <FullscreenSlideViewer
        open={fullscreenOpen}
        slideCount={slides.length}
        slideIndex={selectedSlideIndex}
        onClose={() => setFullscreenOpen(false)}
        onNext={() => {
          if (selectedSlideIndex < 0) {
            return
          }

          const nextIndex = Math.min(slides.length - 1, selectedSlideIndex + 1)
          setSelectedSlideId(slides[nextIndex]?.id ?? null)
        }}
        onPrevious={() => {
          if (selectedSlideIndex <= 0) {
            return
          }

          const nextIndex = selectedSlideIndex - 1
          setSelectedSlideId(slides[nextIndex]?.id ?? null)
        }}
      >
        {selectedSlide ? (
          <div dangerouslySetInnerHTML={{ __html: selectedSlide.svgContent }} />
        ) : null}
      </FullscreenSlideViewer>
    </div>
  )
}

function ChatComposerLockHarness() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [composerLocked, setComposerLocked] = useState(false)

  return (
    <ChatPanel
      composerDisabled={composerLocked}
      composerLoading={false}
      messages={messages}
      onComposerSubmit={(prompt) => {
        setMessages((currentMessages) => [
          ...currentMessages,
          {
            id: `user-${currentMessages.length + 1}`,
            kind: 'user_prompt',
            text: prompt,
          },
        ])
        setComposerLocked(true)
      }}
      onInterruptSkip={() => {}}
      onInterruptSubmit={() => {}}
    />
  )
}

function InterruptHarness({
  messages,
  onSubmit,
  onSkip,
}: {
  messages: ChatMessage[]
  onSubmit: (context: Record<string, unknown>, payload: Record<string, unknown>) => Promise<void> | void
  onSkip: (context: Record<string, unknown>) => Promise<void> | void
}) {
  return (
    <ChatPanel
      composerDisabled
      composerLoading={false}
      messages={messages}
      onComposerSubmit={() => {}}
      onInterruptSkip={onSkip}
      onInterruptSubmit={onSubmit}
    />
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  pptWriteFileMock.mockReset()
  pptAddImageMock.mockReset()
  pptInstances.length = 0
})

describe('App preview integration', () => {
  it('lets a thumbnail click drive the fullscreen preview flow', async () => {
    render(<PreviewIntegrationHarness />)

    expect(screen.getByText('点击左侧缩略图查看页面预览')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '终稿' }))
    fireEvent.click(screen.getByRole('button', { name: '查看第 2 页' }))

    const viewer = screen.getByRole('dialog', { name: '全屏查看幻灯片' })
    expect(within(viewer).getByText('第 2 / 2 页')).toBeInTheDocument()
    expect(within(viewer).getByText('final-2')).toBeInTheDocument()

    fireEvent.click(within(viewer).getByRole('button', { name: '上一页' }))
    expect(within(viewer).getByText('第 1 / 2 页')).toBeInTheDocument()
    expect(within(viewer).getByText('final-1')).toBeInTheDocument()

    fireEvent.click(within(viewer).getByRole('button', { name: '关闭预览' }))
    expect(
      screen.queryByRole('dialog', { name: '全屏查看幻灯片' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('点击左侧缩略图查看页面预览')).toBeInTheDocument()
  })

  it('keeps the selected slide stable when the slide list changes after selection', () => {
    render(<PreviewIntegrationHarness />)

    fireEvent.click(screen.getByRole('button', { name: '终稿' }))
    fireEvent.click(screen.getByRole('button', { name: '查看第 2 页' }))

    const viewer = screen.getByRole('dialog', { name: '全屏查看幻灯片' })
    expect(within(viewer).getByText('final-2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '缩减终稿页' }))

    expect(within(viewer).getByText('第 1 / 1 页')).toBeInTheDocument()
    expect(within(viewer).getByText('final-2')).toBeInTheDocument()
    expect(screen.getByRole('button', { current: 'page', name: '查看第 1 页' })).toBeInTheDocument()
  })

  it('falls back cleanly when the selected slide id becomes stale', () => {
    render(<PreviewIntegrationHarness />)

    fireEvent.click(screen.getByRole('button', { name: '设为过期页面标识' }))

    expect(
      screen.queryByRole('button', { current: 'page', name: '查看第 1 页' }),
    ).not.toBeInTheDocument()
  })

  it('locks the composer after the first submit in a chat flow', () => {
    render(<ChatComposerLockHarness />)

    const promptInput = screen.getByRole('textbox', { name: '输入 PPT 需求' })
    fireEvent.change(promptInput, { target: { value: '  做一份 AI 行业分析  ' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    expect(within(screen.getByLabelText('用户')).getByText('做一份 AI 行业分析')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '输入 PPT 需求' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送需求' })).toBeDisabled()
  })

  it('passes interrupt identity and edited payload on edit_form submit', async () => {
    const onSubmit = vi.fn()

    render(
      <InterruptHarness
        messages={[
          {
            id: 'message-edit-1',
            kind: 'assistant_interrupt',
            interrupt: {
              id: 'interrupt-envelope-edit-1',
              value: {
                type: 'edit_form',
                title: '补充演示文稿信息',
                payload: {
                  theme: 'AI 营销方案',
                  target_audience: '市场团队',
                  num_pages: 12,
                  user_role: '产品经理',
                  layout_style: 'grid',
                },
              },
            },
          },
        ]}
        onSkip={() => {}}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.change(screen.getByRole('spinbutton', { name: '页数' }), {
      target: { value: '18' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'message-edit-1',
        interruptId: 'interrupt-envelope-edit-1',
        interruptType: 'edit_form',
        interruptTitle: '补充演示文稿信息',
      }),
      expect.objectContaining({
        num_pages: 18,
        theme: 'AI 营销方案',
      }),
    )
  })

  it('prevents duplicate async skip clicks on interrupt cards', async () => {
    let resolveSkip: (() => void) | undefined
    const onSkip = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSkip = resolve
        }),
    )

    render(
      <InterruptHarness
        messages={[
          {
            id: 'message-content-1',
            kind: 'assistant_interrupt',
            interrupt: {
              id: 'interrupt-envelope-content-1',
              value: {
                type: 'upload_ppt_content_files',
                title: '上传内容文件',
                file_type: ['pdf', 'docx'],
              },
            },
          },
        ]}
        onSkip={onSkip}
        onSubmit={() => {}}
      />,
    )

    const skipButton = screen.getByRole('button', { name: '跳过' })
    fireEvent.click(skipButton)
    fireEvent.click(skipButton)

    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'message-content-1',
        interruptId: 'interrupt-envelope-content-1',
        interruptType: 'upload_ppt_content_files',
        interruptTitle: '上传内容文件',
      }),
    )
    expect(skipButton).toBeDisabled()

    resolveSkip?.()

    await waitFor(() => {
      expect(skipButton).not.toBeDisabled()
    })
  })

  it('creates a new thread on mount and renders the chat shell', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ thread_id: 'thread-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ layout_styles: ['top_bottom', 'grid'] }), {
          status: 200,
        }),
      )

    render(<App />)

    expect(await screen.findByText('对话工作区')).toBeInTheDocument()
    expect(screen.queryByText('One active run per fresh session')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/create_session_id'),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('submits interrupt payloads through hitl_resume and exposes draft previews', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ thread_id: 'thread-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ layout_styles: ['top_bottom', 'grid'] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: current_stage\ndata: {"type":"current_stage","data":"正在确认PPT的具体需求"}\n\n',
          'event: interrupts\ndata: {"type":"interrupts","data":[{"id":"interrupt-1","value":{"title":"请确认或者修改以下PPT的相关信息，确认无误后点击提交","type":"edit_form","payload":{"theme":"DeepSeek R1 介绍","target_audience":"导师和同学","num_pages":10,"user_role":"学生","layout_style":"top_bottom"}}}]}\n\n',
        ),
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: current_stage\ndata: {"type":"current_stage","data":"已恢复执行"}\n\n',
          'event: first_draft\ndata: {"first_draft_results":[{"page_index":0,"svg_content":"<svg><text>draft-page-1</text></svg>","file_path":"user_data/thread-1/first_draft/page_1.svg"}]}\n\n',
        ),
      )

    render(<App />)

    fireEvent.change(await screen.findByLabelText('输入 PPT 需求'), {
      target: { value: '帮我做一个 DeepSeek 汇报' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    await screen.findByText('请确认或者修改以下PPT的相关信息，确认无误后点击提交')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    expect(getRequestBody(fetchMock, 2)).toContain('"type":"start"')
    expect(getRequestBody(fetchMock, 3)).toContain('"type":"hitl_resume"')
    expect(getRequestBody(fetchMock, 3)).toContain('"theme":"DeepSeek R1 介绍"')

    expect(await screen.findByText('初稿已更新，可在左侧切换并进入全屏预览。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看第 1 页' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '查看第 1 页' }))
    expect(screen.getByRole('dialog', { name: '全屏查看幻灯片' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '第 1 页' })).toHaveAttribute(
      'src',
      expect.stringContaining('draft-page-1'),
    )
  })

  it('resumes upload interrupts with hitl_resume when the user skips content upload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ thread_id: 'thread-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ layout_styles: ['top_bottom', 'grid'] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: interrupts\ndata: {"type":"interrupts","data":[{"id":"interrupt-content-1","value":{"title":"你可以上传PPT内容相关的文件或者网站,如果没有可以直接跳过","type":"upload_ppt_content_files","file_type":["pdf","docx","markdown","md"]}}]}\n\n',
        ),
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: current_stage\ndata: {"type":"current_stage","data":"已跳过内容资料并继续执行"}\n\n',
        ),
      )

    render(<App />)

    fireEvent.change(await screen.findByLabelText('输入 PPT 需求'), {
      target: { value: '帮我做一个 DeepSeek 汇报' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    await screen.findByText('你可以上传PPT内容相关的文件或者网站,如果没有可以直接跳过')
    fireEvent.click(screen.getByRole('button', { name: '跳过' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    expect(getRequestBody(fetchMock, 3)).toContain('"type":"hitl_resume"')
    expect(getRequestBody(fetchMock, 3)).toContain('"have_ppt_content_files":false')
    expect(getRequestBody(fetchMock, 3)).toContain('"ppt_content_source_urls":null')
    expect(getRequestBody(fetchMock, 3)).not.toContain('"type":"abort_resume"')
  })

  it('keeps a handled interrupt card read-only after the user skips it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ thread_id: 'thread-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ layout_styles: ['top_bottom', 'grid'] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: interrupts\ndata: {"type":"interrupts","data":[{"id":"interrupt-content-1","value":{"title":"你可以上传PPT内容相关的文件或者网站,如果没有可以直接跳过","type":"upload_ppt_content_files","file_type":["pdf","docx","markdown","md"]}}]}\n\n',
        ),
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: current_stage\ndata: {"type":"current_stage","data":"已跳过内容资料并继续执行"}\n\n',
        ),
      )

    render(<App />)

    fireEvent.change(await screen.findByLabelText('输入 PPT 需求'), {
      target: { value: '帮我做一个 DeepSeek 汇报' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    await screen.findByText('你可以上传PPT内容相关的文件或者网站,如果没有可以直接跳过')
    fireEvent.click(screen.getByRole('button', { name: '跳过' }))

    await screen.findByText('已跳过内容资料并继续执行')

    expect(screen.getByRole('button', { name: '跳过' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '提交' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '内容来源网址' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '选择内容文件' })).toBeDisabled()
  })

  it('keeps only the handled interrupt read-only when later interrupts reuse the same backend id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ thread_id: 'thread-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ layout_styles: ['top_bottom', 'grid'] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: interrupts\ndata: {"type":"interrupts","data":[{"id":"reused-interrupt-id","value":{"title":"请确认或者修改以下PPT的相关信息，确认无误后点击提交","type":"edit_form","payload":{"theme":"DeepSeek R1 介绍","target_audience":"导师和同学","num_pages":10,"user_role":"学生","layout_style":"top_bottom"}}}]}\n\n',
        ),
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: interrupts\ndata: {"type":"interrupts","data":[{"id":"reused-interrupt-id","value":{"title":"你可以上传PPT内容相关的文件或者网站,如果没有可以直接跳过","type":"upload_ppt_content_files","file_type":["pdf","docx","markdown","md"]}}]}\n\n',
        ),
      )

    render(<App />)

    fireEvent.change(await screen.findByLabelText('输入 PPT 需求'), {
      target: { value: '帮我做一个 DeepSeek 汇报' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    await screen.findByText('请确认或者修改以下PPT的相关信息，确认无误后点击提交')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await screen.findByText('你可以上传PPT内容相关的文件或者网站,如果没有可以直接跳过')

    const submitButtons = screen.getAllByRole('button', { name: '提交' })
    const skipButtons = screen.getAllByRole('button', { name: '跳过' })
    const urlField = screen.getByRole('textbox', { name: '内容来源网址' })
    const uploadButton = screen.getByRole('button', { name: '选择内容文件' })

    expect(submitButtons).toHaveLength(2)
    expect(submitButtons[0]).toBeDisabled()
    expect(submitButtons[1]).toBeDisabled()
    expect(skipButtons[0]).toBeEnabled()
    expect(urlField).toBeEnabled()
    expect(uploadButton).toBeEnabled()
  })

  it('exports the currently previewed draft deck from the preview sidebar', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ thread_id: 'thread-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ layout_styles: ['top_bottom', 'grid'] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        createSseResponse(
          'event: first_draft\ndata: {"first_draft_results":[{"page_index":0,"svg_content":"<svg><text>draft-page-1</text></svg>","file_path":"user_data/thread-1/first_draft/page_1.svg"}]}\n\n',
        ),
      )

    render(<App />)

    fireEvent.change(await screen.findByLabelText('输入 PPT 需求'), {
      target: { value: '帮我做一个 DeepSeek 汇报' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    await screen.findByRole('button', { name: '查看第 1 页' })
    const exportButton = screen.getByRole('button', { name: '导出 PPT' })
    expect(exportButton).toBeEnabled()

    fireEvent.click(exportButton)

    await waitFor(() => {
      expect(pptWriteFileMock).toHaveBeenCalledWith({
        fileName: 'ppt-agent-draft.pptx',
      })
    })
  })
})

describe('ppt export', () => {
  it('exports the current deck as a wide-screen ppt using slide svg content', async () => {
    await exportSlidesAsPpt({
      deckVersion: 'final',
      slides: [
        {
          id: 'final-1',
          title: 'Final 1',
          thumbnailLabel: '查看第 1 页',
          previewMode: 'final',
          svgContent: '<svg><text>final-1</text></svg>',
        },
      ],
    })

    expect(pptInstances).toHaveLength(1)
    expect(pptInstances[0]?.layout).toBe('LAYOUT_WIDE')
    expect(pptInstances[0]?.slides).toHaveLength(1)
    expect(pptAddImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.stringContaining('data:image/svg+xml'),
        x: 0,
        y: 0,
      }),
    )
    expect(pptWriteFileMock).toHaveBeenCalledWith({
      fileName: 'ppt-agent-final.pptx',
    })
  })
})
