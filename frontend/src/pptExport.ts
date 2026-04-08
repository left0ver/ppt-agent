import pptxgen from 'pptxgenjs'
import type { PreviewResult } from './api'

const SLIDE_WIDTH = 13.333
const SLIDE_HEIGHT = 7.5

function encodeSvgToDataUri(svg: string): string {
  const normalized = svg.trim()
  const bytes = new TextEncoder().encode(normalized)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

function sortSlides(slides: PreviewResult[]): PreviewResult[] {
  return [...slides].sort((a, b) => a.page - b.page)
}

export async function exportSlidesToPptx(params: {
  slides: PreviewResult[]
  fileName: string
  author?: string
  subject?: string
  title?: string
}): Promise<void> {
  const { slides, fileName, author, subject, title } = params
  const orderedSlides = sortSlides(slides).filter((slide) => Boolean(slide.svg_content))
  if (orderedSlides.length === 0) {
    throw new Error('当前没有可导出的 SVG 页面')
  }

  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = author ?? 'PPT Agent'
  pptx.company = 'PPT Agent'
  pptx.subject = subject ?? 'AI generated presentation'
  pptx.title = title ?? fileName.replace(/\.pptx$/i, '')

  orderedSlides.forEach((slideItem) => {
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addImage({
      data: encodeSvgToDataUri(slideItem.svg_content ?? ''),
      x: 0,
      y: 0,
      w: SLIDE_WIDTH,
      h: SLIDE_HEIGHT,
    })
  })

  await pptx.writeFile({ fileName })
}
