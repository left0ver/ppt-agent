import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type {
  FirstDraftEventPayload,
  FinalPptEventPayload,
  GeneratedSlideResult,
  InterruptEnvelope,
  LayoutStyle,
} from '../types/ppt-agent'
import {
  createSessionId,
  getLayoutStyles,
  normalizeApiError,
  uploadContentFiles,
  uploadTemplateFile,
} from '../lib/ppt-agent-api'
import { exportSlidesAsPpt } from '../lib/ppt-export'
import { streamChat, type ParsedSseEvent } from '../lib/chat-stream'
import { createInitialSessionState, sessionReducer } from '../state/session-state'
import type {
  ContentUploadSubmitPayload,
} from '../components/interrupts/ContentUploadInterruptCard'
import type {
  InterruptActionContext,
} from '../components/interrupts/InterruptCard'
import type {
  TemplateUploadSubmitPayload,
} from '../components/interrupts/TemplateUploadInterruptCard'
import type { DeckVersion, SlidePreview } from '../components/preview/PreviewSidebar'

const DEFAULT_LAYOUT_STYLES: LayoutStyle[] = ['top_bottom', 'grid']

function encodeSvgAsDataUrl(svgContent: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`
}

function mergeGeneratedSlides(
  currentSlides: SlidePreview[],
  nextResults: GeneratedSlideResult[],
  previewMode: DeckVersion,
): SlidePreview[] {
  const slideMap = new Map(
    currentSlides.map((slide, index) => [
      Number(slide.id.split('-').at(-1) ?? index),
      slide,
    ]),
  )

  for (const result of nextResults) {
    const pageNumber = result.page_index + 1
    slideMap.set(pageNumber, {
      id: `${previewMode}-${pageNumber}`,
      title: `第 ${pageNumber} 页`,
      thumbnailLabel: `查看第 ${pageNumber} 页`,
      previewMode,
      imageUrl: encodeSvgAsDataUrl(result.svg_content),
      svgContent: result.svg_content,
    })
  }

  return [...slideMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, slide]) => slide)
}

function extractStatusText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  if ('data' in payload && typeof payload.data === 'string') {
    return payload.data
  }

  return null
}

function extractInterrupt(payload: unknown): InterruptEnvelope | null {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    return null
  }

  const data = payload.data
  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  const maybeInterrupt = data[0]
  if (
    maybeInterrupt &&
    typeof maybeInterrupt === 'object' &&
    'id' in maybeInterrupt &&
    'value' in maybeInterrupt
  ) {
    return maybeInterrupt as InterruptEnvelope
  }

  return null
}

function extractDraftResults(payload: unknown): GeneratedSlideResult[] {
  if (
    payload &&
    typeof payload === 'object' &&
    'first_draft_results' in payload &&
    Array.isArray(payload.first_draft_results)
  ) {
    return payload.first_draft_results as FirstDraftEventPayload['first_draft_results']
  }

  return []
}

function extractFinalResults(payload: unknown): GeneratedSlideResult[] {
  if (
    payload &&
    typeof payload === 'object' &&
    'final_ppt_results' in payload &&
    Array.isArray(payload.final_ppt_results)
  ) {
    return payload.final_ppt_results as FinalPptEventPayload['final_ppt_results']
  }

  return []
}

function summarizeInterruptResponse(
  context: InterruptActionContext,
  payload: Record<string, unknown> | null,
): string {
  switch (context.interruptType) {
    case 'edit_form':
      return `已确认 PPT 信息：${String(payload?.theme ?? '')} · ${String(payload?.num_pages ?? '')} 页`
    case 'upload_ppt_content_files': {
      const contentFiles = Array.isArray(payload?.contentFiles)
        ? payload.contentFiles.length
        : 0
      const urls = Array.isArray(payload?.ppt_content_source_urls)
        ? payload.ppt_content_source_urls.length
        : 0
      const parts = [
        contentFiles > 0 ? `上传了 ${contentFiles} 份内容文件` : null,
        urls > 0 ? `补充了 ${urls} 个网址` : null,
      ].filter(Boolean)

      return parts.length > 0 ? `已补充内容资料：${parts.join('，')}` : '已跳过内容资料'
    }
    case 'upload_ppt_template':
      return payload?.templateFile && payload.templateFile instanceof File
        ? `已上传模板文件：${(payload.templateFile as File).name}`
        : '已跳过模板文件'
    case 'text_input': {
      const style = String(payload?.user_ppt_style ?? '').trim()
      return style ? `已确认终稿风格：${style}` : '已使用默认终稿风格'
    }
  }
}

function summarizeInterruptSkip(context: InterruptActionContext): string {
  switch (context.interruptType) {
    case 'upload_ppt_content_files':
      return '已跳过内容资料补充'
    case 'upload_ppt_template':
      return '已跳过模板上传'
    default:
      return `已跳过：${context.interruptTitle}`
  }
}

function buildSkipResumePayload(context: InterruptActionContext): Record<string, unknown> | null {
  switch (context.interruptType) {
    case 'upload_ppt_content_files':
      return {
        have_ppt_content_files: false,
        ppt_content_source_urls: null,
      }
    case 'upload_ppt_template':
      return {
        have_ppt_template: false,
        ppt_template_path: null,
      }
    default:
      return null
  }
}

export function usePptAgentSession() {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState)
  const [bootError, setBootError] = useState<string | null>(null)
  const [composerLoading, setComposerLoading] = useState(false)
  const [layoutStyleOptions, setLayoutStyleOptions] =
    useState<LayoutStyle[]>(DEFAULT_LAYOUT_STYLES)
  const [draftSlides, setDraftSlides] = useState<SlidePreview[]>([])
  const [finalSlides, setFinalSlides] = useState<SlidePreview[]>([])
  const [activeDeckVersion, setActiveDeckVersion] = useState<DeckVersion>('draft')
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [resolvedInterruptMessageIds, setResolvedInterruptMessageIds] = useState<string[]>([])
  const [exportLoading, setExportLoading] = useState(false)
  const streamAbortRef = useRef<AbortController | null>(null)

  const slides = activeDeckVersion === 'draft' ? draftSlides : finalSlides
  const selectedSlideById = selectedSlideId
    ? slides.find((slide) => slide.id === selectedSlideId) ?? null
    : null
  const selectedSlideIndex = selectedSlideById
    ? slides.findIndex((slide) => slide.id === selectedSlideById.id)
    : -1
  const selectedSlide = selectedSlideIndex >= 0 ? slides[selectedSlideIndex] ?? null : null

  const composerDisabled = useMemo(
    () => state.threadStatus !== 'ready' || state.composerLocked,
    [state.composerLocked, state.threadStatus],
  )

  useEffect(() => {
    const controller = new AbortController()

    setBootError(null)
    void Promise.allSettled([
      createSessionId(controller.signal),
      getLayoutStyles(controller.signal),
    ]).then((results) => {
      if (controller.signal.aborted) {
        return
      }

      const [sessionResult, layoutResult] = results

      if (sessionResult.status === 'fulfilled') {
        setDraftSlides([])
        setFinalSlides([])
        setActiveDeckVersion('draft')
        setSelectedSlideId(null)
        setViewerOpen(false)
        setResolvedInterruptMessageIds([])
        dispatch({
          type: 'thread_ready',
          threadId: sessionResult.value.thread_id,
        })
      } else {
        setBootError(normalizeApiError(sessionResult.reason).message)
      }

      if (layoutResult.status === 'fulfilled') {
        const nextLayoutStyles = layoutResult.value.layout_styles.filter(
          Boolean,
        ) as LayoutStyle[]
        setLayoutStyleOptions(
          nextLayoutStyles.length > 0 ? nextLayoutStyles : DEFAULT_LAYOUT_STYLES,
        )
      }
    })

    return () => {
      controller.abort()
      streamAbortRef.current?.abort()
    }
  }, [])

  async function runChatStream({
    threadId,
    type,
    userInput,
  }: {
    threadId: string
    type: 'start' | 'hitl_resume' | 'abort_resume'
    userInput: string | Record<string, unknown> | null
  }) {
    streamAbortRef.current?.abort()
    const controller = new AbortController()
    const flags = {
      sawDraft: false,
      sawFinal: false,
    }

    streamAbortRef.current = controller

    const handleEvent = (event: ParsedSseEvent) => {
      switch (event.event) {
        case 'current_stage': {
          const text = extractStatusText(event.data)
          if (text) {
            dispatch({
              type: 'status_received',
              threadId,
              text,
            })
          }
          break
        }
        case 'interrupts': {
          const interrupt = extractInterrupt(event.data)
          if (interrupt) {
            dispatch({
              type: 'interrupt_received',
              threadId,
              interrupt,
            })
          }
          break
        }
        case 'first_draft': {
          const results = extractDraftResults(event.data)
          if (results.length > 0) {
            flags.sawDraft = true
            setDraftSlides((currentSlides) =>
              mergeGeneratedSlides(currentSlides, results, 'draft'),
            )
          }
          break
        }
        case 'final_ppt': {
          const results = extractFinalResults(event.data)
          if (results.length > 0) {
            flags.sawFinal = true
            setFinalSlides((currentSlides) =>
              mergeGeneratedSlides(currentSlides, results, 'final'),
            )
          }
          break
        }
      }
    }

    try {
      await streamChat({
        thread_id: threadId,
        type,
        user_input: userInput,
        signal: controller.signal,
        onEvent: handleEvent,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }

      dispatch({
        type: 'error_received',
        threadId,
        text: normalizeApiError(error).message,
      })
      return
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
      }
    }

    if (flags.sawDraft) {
      dispatch({
        type: 'draft_generated',
        threadId,
        text: '初稿已更新，可在左侧切换并进入全屏预览。',
      })
    }

    if (flags.sawFinal) {
      dispatch({
        type: 'final_generated',
        threadId,
        text: '终稿已生成，可切换到终稿查看完整页面。',
      })
    }
  }

  async function start(prompt: string) {
    if (!state.threadId || state.threadStatus !== 'ready') {
      return
    }

    setComposerLoading(true)
    dispatch({
      type: 'start_submitted',
      threadId: state.threadId,
      prompt,
    })

    await runChatStream({
      threadId: state.threadId,
      type: 'start',
      userInput: prompt,
    })

    setComposerLoading(false)
  }

  async function submitInterrupt(
    context: InterruptActionContext,
    payload: Record<string, unknown>,
  ) {
    if (!state.threadId) {
      return
    }

    try {
      setResolvedInterruptMessageIds((currentIds) =>
        currentIds.includes(context.messageId)
          ? currentIds
          : [...currentIds, context.messageId],
      )

      let resumePayload: Record<string, unknown> = payload

      if (context.interruptType === 'upload_ppt_content_files') {
        const contentPayload = payload as ContentUploadSubmitPayload

        if (contentPayload.contentFiles.length > 0) {
          await uploadContentFiles({
            threadId: state.threadId,
            files: contentPayload.contentFiles,
          })
        }

        resumePayload = {
          have_ppt_content_files: contentPayload.have_ppt_content_files,
          ppt_content_source_urls: contentPayload.ppt_content_source_urls,
        }
      }

      if (context.interruptType === 'upload_ppt_template') {
        const templatePayload = payload as TemplateUploadSubmitPayload

        if (templatePayload.templateFile) {
          const uploadResult = await uploadTemplateFile({
            threadId: state.threadId,
            file: templatePayload.templateFile,
          })

          resumePayload = {
            have_ppt_template: true,
            ppt_template_path: uploadResult.template_file_path,
          }
        } else {
          resumePayload = {
            have_ppt_template: false,
            ppt_template_path: null,
          }
        }
      }

      dispatch({
        type: 'interrupt_response_recorded',
        threadId: state.threadId,
        text: summarizeInterruptResponse(context, payload),
      })

      await runChatStream({
        threadId: state.threadId,
        type: 'hitl_resume',
        userInput: resumePayload,
      })
    } catch (error) {
      dispatch({
        type: 'error_received',
        threadId: state.threadId,
        text: normalizeApiError(error).message,
      })
    }
  }

  async function skipInterrupt(context: InterruptActionContext) {
    if (!state.threadId) {
      return
    }

    setResolvedInterruptMessageIds((currentIds) =>
      currentIds.includes(context.messageId)
        ? currentIds
        : [...currentIds, context.messageId],
    )

    const resumePayload = buildSkipResumePayload(context)

    dispatch({
      type: 'interrupt_response_recorded',
      threadId: state.threadId,
      text: summarizeInterruptSkip(context),
    })

    await runChatStream({
      threadId: state.threadId,
      type: 'hitl_resume',
      userInput: resumePayload,
    })
  }

  async function exportDeck() {
    if (slides.length === 0 || exportLoading) {
      return
    }

    setExportLoading(true)

    try {
      await exportSlidesAsPpt({
        deckVersion: activeDeckVersion,
        slides,
      })
    } finally {
      setExportLoading(false)
    }
  }

  function openSlide(slideIndex: number) {
    const nextSlide = slides[slideIndex]
    if (!nextSlide) {
      return
    }

    setSelectedSlideId(nextSlide.id)
    setViewerOpen(true)
  }

  function selectSlide(selection: { slideId: string; slideIndex: number }) {
    const nextSlide = slides[selection.slideIndex]
    setSelectedSlideId(nextSlide?.id ?? selection.slideId)
  }

  function changeDeckVersion(version: DeckVersion) {
    setActiveDeckVersion(version)
    setSelectedSlideId(null)
    setViewerOpen(false)
  }

  function moveViewer(offset: -1 | 1) {
    if (slides.length === 0) {
      return
    }

    const currentIndex =
      selectedSlideIndex >= 0 ? selectedSlideIndex : 0
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), slides.length - 1)
    setSelectedSlideId(slides[nextIndex]?.id ?? null)
  }

  return {
    activeDeckVersion,
    bootError,
    canViewDraft: draftSlides.length > 0,
    canViewFinal: finalSlides.length > 0,
    changeDeckVersion,
    composerDisabled,
    composerLoading,
    exportDeck,
    exportLoading,
    layoutStyleOptions,
    openSlide,
    resolvedInterruptMessageIds,
    selectedSlide,
    selectedSlideId,
    selectedSlideIndex,
    selectSlide,
    skipInterrupt,
    slides,
    start,
    state,
    submitInterrupt,
    viewerOpen,
    closeViewer: () => setViewerOpen(false),
    showNextSlide: () => moveViewer(1),
    showPreviousSlide: () => moveViewer(-1),
  }
}
