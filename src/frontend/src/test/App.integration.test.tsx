import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import FullscreenSlideViewer from '../components/preview/FullscreenSlideViewer'
import PreviewEmptyState from '../components/preview/PreviewEmptyState'
import PreviewSidebar, {
  type DeckVersion,
  type SlidePreview,
} from '../components/preview/PreviewSidebar'

function PreviewIntegrationHarness() {
  const [activeDeckVersion, setActiveDeckVersion] = useState<DeckVersion>('draft')
  const [selectedSlideIndex, setSelectedSlideIndex] = useState<number>(-1)
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
  const selectedSlide =
    (selectedSlideId
      ? slides.find((slide) => slide.id === selectedSlideId) ?? null
      : null) ??
    (selectedSlideIndex >= 0 && selectedSlideIndex < slides.length
      ? slides[selectedSlideIndex]
      : null)
  const resolvedSelectedSlideIndex = selectedSlide
    ? slides.findIndex((slide) => slide.id === selectedSlide.id)
    : -1

  return (
    <div>
      <PreviewSidebar
        activeDeckVersion={activeDeckVersion}
        canViewDraft={slidesByVersion.draft.length > 0}
        canViewFinal={slidesByVersion.final.length > 0}
        selectedSlideIndex={resolvedSelectedSlideIndex}
        selectedSlideId={selectedSlideId}
        slides={slides}
        onDeckVersionChange={(nextVersion) => {
          setActiveDeckVersion(nextVersion)
          setSelectedSlideIndex(-1)
          setSelectedSlideId(null)
          setFullscreenOpen(false)
        }}
        onThumbnailClick={(slideIndex) => {
          setSelectedSlideIndex(slideIndex)
          setSelectedSlideId(slides[slideIndex]?.id ?? null)
          setFullscreenOpen(true)
        }}
        onThumbnailSelect={({ slideId, slideIndex }) => {
          setSelectedSlideId(slideId)
          setSelectedSlideIndex(slideIndex)
        }}
      />

      <button
        type="button"
        onClick={() => setSelectedSlideIndex(99)}
      >
        设为无效页码
      </button>
      <button
        type="button"
        onClick={() => {
          setSelectedSlideId('stale-slide-id')
          setSelectedSlideIndex(1)
        }}
      >
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
        {selectedSlide ? (
          <div>
            <div dangerouslySetInnerHTML={{ __html: selectedSlide.svgContent }} />
            <button type="button" onClick={() => setFullscreenOpen(true)}>
              打开全屏预览
            </button>
          </div>
        ) : (
          <PreviewEmptyState />
        )}
      </div>

      <FullscreenSlideViewer
        open={fullscreenOpen}
        slideCount={slides.length}
        slideIndex={resolvedSelectedSlideIndex}
        onClose={() => setFullscreenOpen(false)}
        onPrevious={() => {
          if (resolvedSelectedSlideIndex <= 0) {
            return
          }

          const nextIndex = resolvedSelectedSlideIndex - 1
          setSelectedSlideIndex(nextIndex)
          setSelectedSlideId(slides[nextIndex]?.id ?? null)
        }}
        onNext={() => {
          if (resolvedSelectedSlideIndex < 0) {
            return
          }

          const nextIndex = Math.min(slides.length - 1, resolvedSelectedSlideIndex + 1)
          setSelectedSlideIndex(nextIndex)
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
    expect(screen.getByRole('button', { name: '打开全屏预览' })).toBeInTheDocument()
  })

  it('keeps fullscreen pagination valid when the selected index becomes stale while open', () => {
    render(<PreviewIntegrationHarness />)

    fireEvent.click(screen.getByRole('button', { name: '查看第 2 页' }))

    const viewer = screen.getByRole('dialog', { name: '全屏查看幻灯片' })
    expect(within(viewer).getByText('第 2 / 2 页')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '设为无效页码' }))

    expect(within(viewer).getByText('第 2 / 2 页')).toBeInTheDocument()
    expect(within(viewer).getByRole('button', { name: '上一页' })).not.toBeDisabled()
    expect(within(viewer).getByRole('button', { name: '下一页' })).toBeDisabled()
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

  it('falls back to a valid selected index when the selected slide id is stale', () => {
    render(<PreviewIntegrationHarness />)

    fireEvent.click(screen.getByRole('button', { name: '设为过期页面标识' }))

    expect(
      screen.getByRole('button', { current: 'page', name: '查看第 2 页' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { current: 'page', name: '查看第 1 页' }),
    ).not.toBeInTheDocument()
  })
})
