import { Button, Card, Empty, Tag, Typography } from 'antd'

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
  exportDisabled?: boolean
  exportLoading?: boolean
  selectedSlideIndex: number
  selectedSlideId?: string | null
  slides: SlidePreview[]
  onDeckVersionChange: (version: DeckVersion) => void
  onExport?: () => Promise<void> | void
  onThumbnailClick: (slideIndex: number) => void
  onThumbnailSelect?: (selection: { slideId: string; slideIndex: number }) => void
}

export default function PreviewSidebar({
  activeDeckVersion,
  canViewDraft,
  canViewFinal,
  exportDisabled = false,
  exportLoading = false,
  selectedSlideIndex,
  selectedSlideId,
  slides,
  onDeckVersionChange,
  onExport,
  onThumbnailClick,
  onThumbnailSelect,
}: PreviewSidebarProps) {
  const hasMatchedSelectedSlideId =
    selectedSlideId != null && slides.some((slide) => slide.id === selectedSlideId)

  return (
    <Card
      aria-label="预览侧边栏"
      className="preview-sidebar"
      variant="borderless"
    >
      <div className="preview-sidebar__header">
        <div>
          <Typography.Text className="preview-sidebar__eyebrow">
            Slide Deck
          </Typography.Text>
          <Typography.Title level={4}>PPT 预览</Typography.Title>
        </div>
        <Tag color="gold" variant="filled">
          {slides.length} 页
        </Tag>
      </div>

      <div className="preview-sidebar__toolbar">
        <div
          aria-label="预览版本切换"
          className="preview-sidebar__switch"
          role="group"
        >
          <Button
            aria-label="初稿"
            aria-pressed={activeDeckVersion === 'draft'}
            disabled={!canViewDraft}
            type={activeDeckVersion === 'draft' ? 'primary' : 'default'}
            onClick={() => onDeckVersionChange('draft')}
          >
            初稿
          </Button>
          <Button
            aria-label="终稿"
            aria-pressed={activeDeckVersion === 'final'}
            disabled={!canViewFinal}
            type={activeDeckVersion === 'final' ? 'primary' : 'default'}
            onClick={() => onDeckVersionChange('final')}
          >
            终稿
          </Button>
        </div>
        <Button
          aria-label="导出 PPT"
          className="preview-sidebar__export"
          disabled={exportDisabled}
          loading={exportLoading}
          onClick={() => void onExport?.()}
        >
          导出 PPT
        </Button>
      </div>

      <div className="preview-sidebar__list">
        {slides.length === 0 ? (
          <div className="preview-sidebar__empty">
            <Empty
              description="当前版本暂无可预览页面"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        ) : (
          slides.map((slide, slideIndex) => {
            const isSelected = hasMatchedSelectedSlideId
              ? selectedSlideId === slide.id
              : selectedSlideIndex === slideIndex

            return (
              <Button
                key={slide.id}
                aria-current={isSelected ? 'page' : undefined}
                aria-label={slide.thumbnailLabel}
                className={`preview-thumb${isSelected ? ' preview-thumb--selected' : ''}`}
                type="text"
                onClick={() => {
                  onThumbnailClick(slideIndex)
                  onThumbnailSelect?.({ slideId: slide.id, slideIndex })
                }}
              >
                <div className="preview-thumb__frame">
                  {slide.imageUrl ? (
                    <img alt="" className="preview-thumb__image" src={slide.imageUrl} />
                  ) : (
                    <div
                      className="preview-thumb__svg"
                      dangerouslySetInnerHTML={{ __html: slide.svgContent }}
                    />
                  )}
                </div>
                <div className="preview-thumb__meta">
                  <Typography.Text strong>{slide.title}</Typography.Text>
                </div>
              </Button>
            )
          })
        )}
      </div>
    </Card>
  )
}
