import type { ReactNode } from 'react'

interface FullscreenSlideViewerProps {
  open: boolean
  slideCount: number
  slideIndex: number
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
  children?: ReactNode
}

export default function FullscreenSlideViewer({
  open,
  slideCount,
  slideIndex,
  onClose,
  onPrevious,
  onNext,
  children,
}: FullscreenSlideViewerProps) {
  if (!open) {
    return null
  }

  const hasSlides = slideCount > 0
  const safeSlideIndex = hasSlides
    ? Math.min(Math.max(slideIndex, 0), slideCount - 1)
    : -1
  const displayIndex = hasSlides ? safeSlideIndex + 1 : 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="全屏查看幻灯片"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
      }}
    >
      <div
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '100%',
          background: '#fff',
          borderRadius: '20px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <button type="button" onClick={onClose}>
            关闭预览
          </button>
          <strong>{`第 ${displayIndex} / ${slideCount} 页`}</strong>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onPrevious}
              disabled={!hasSlides || safeSlideIndex <= 0}
            >
              上一页
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!hasSlides || safeSlideIndex >= slideCount - 1}
            >
              下一页
            </button>
          </div>
        </div>
        <div
          style={{
            minHeight: '420px',
            overflow: 'auto',
            borderRadius: '16px',
            border: '1px solid #e5e7eb',
            padding: '20px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
