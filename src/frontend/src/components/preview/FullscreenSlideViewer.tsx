import { Button, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

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
  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) {
    return null
  }

  const hasSlides = slideCount > 0
  const safeSlideIndex = hasSlides
    ? Math.min(Math.max(slideIndex, 0), slideCount - 1)
    : -1
  const displayIndex = hasSlides ? safeSlideIndex + 1 : 0
  const canGoPrevious = hasSlides && safeSlideIndex > 0
  const canGoNext = hasSlides && safeSlideIndex < slideCount - 1

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="全屏查看幻灯片"
      className="fullscreen-viewer"
    >
      <div className="fullscreen-viewer__topbar">
        <Button onClick={onClose}>关闭预览</Button>
        <Typography.Text className="fullscreen-viewer__counter">
          {`第 ${displayIndex} / ${slideCount} 页`}
        </Typography.Text>
        <div className="fullscreen-viewer__actions">
          {canGoPrevious ? <Button onClick={onPrevious}>上一页</Button> : null}
          {canGoNext ? (
            <Button onClick={onNext} type="primary">
              下一页
            </Button>
          ) : null}
        </div>
      </div>

      <div className="fullscreen-viewer__stage">{children}</div>
    </div>,
    document.body,
  )
}
