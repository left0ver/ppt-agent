export type DeckVersion = 'draft' | 'final'

export interface SlidePreview {
  id: string
  title: string
  thumbnailLabel: string
  previewMode: DeckVersion
  imageUrl?: string
  svgContent: string
}

interface PreviewSidebarProps {
  activeDeckVersion: DeckVersion
  canViewDraft: boolean
  canViewFinal: boolean
  selectedSlideIndex: number
  selectedSlideId?: string | null
  slides: SlidePreview[]
  onDeckVersionChange: (version: DeckVersion) => void
  onThumbnailClick: (slideIndex: number) => void
  onThumbnailSelect?: (selection: { slideId: string; slideIndex: number }) => void
}

const switchButtonStyle = {
  border: '1px solid #d9d9d9',
  borderRadius: '999px',
  padding: '8px 14px',
  background: '#fff',
  cursor: 'pointer',
}

export default function PreviewSidebar({
  activeDeckVersion,
  canViewDraft,
  canViewFinal,
  selectedSlideIndex,
  selectedSlideId,
  slides,
  onDeckVersionChange,
  onThumbnailClick,
  onThumbnailSelect,
}: PreviewSidebarProps) {
  const hasMatchedSelectedSlideId = selectedSlideId != null
    && slides.some((slide) => slide.id === selectedSlideId)

  return (
    <aside
      aria-label="预览侧边栏"
      style={{
        width: '280px',
        padding: '16px',
        borderRight: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div
        role="group"
        aria-label="预览版本切换"
        style={{ display: 'flex', gap: '8px' }}
      >
        <button
          type="button"
          disabled={!canViewDraft}
          aria-pressed={activeDeckVersion === 'draft'}
          onClick={() => onDeckVersionChange('draft')}
          style={{
            ...switchButtonStyle,
            fontWeight: activeDeckVersion === 'draft' ? 700 : 500,
            background: activeDeckVersion === 'draft' ? '#111827' : '#fff',
            color: activeDeckVersion === 'draft' ? '#fff' : '#111827',
            opacity: canViewDraft ? 1 : 0.5,
            cursor: canViewDraft ? 'pointer' : 'not-allowed',
          }}
        >
          草稿
        </button>
        <button
          type="button"
          disabled={!canViewFinal}
          aria-pressed={activeDeckVersion === 'final'}
          onClick={() => onDeckVersionChange('final')}
          style={{
            ...switchButtonStyle,
            fontWeight: activeDeckVersion === 'final' ? 700 : 500,
            background: activeDeckVersion === 'final' ? '#111827' : '#fff',
            color: activeDeckVersion === 'final' ? '#fff' : '#111827',
            opacity: canViewFinal ? 1 : 0.5,
            cursor: canViewFinal ? 'pointer' : 'not-allowed',
          }}
        >
          终稿
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {slides.length === 0 ? (
          <p style={{ margin: 0, color: '#6b7280' }}>暂无可预览页面</p>
        ) : (
          slides.map((slide, slideIndex) => {
            const isSelected = hasMatchedSelectedSlideId
              ? selectedSlideId === slide.id
              : selectedSlideIndex === slideIndex

            return (
              <button
                key={slide.id}
                type="button"
                aria-label={slide.thumbnailLabel}
                aria-current={isSelected ? 'page' : undefined}
                onClick={() => {
                  onThumbnailClick(slideIndex)
                  onThumbnailSelect?.({ slideId: slide.id, slideIndex })
                }}
                style={{
                  border: isSelected
                    ? '1px solid #111827'
                    : '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '12px',
                  background: '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <strong style={{ display: 'block', marginBottom: '8px' }}>
                  {slide.thumbnailLabel}
                </strong>
                <span
                  aria-hidden="true"
                  style={{ color: '#6b7280', fontSize: '14px' }}
                >
                  {slide.previewMode === 'draft' ? '草稿' : '终稿'} · {slide.title}
                </span>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
