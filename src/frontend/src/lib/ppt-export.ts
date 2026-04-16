import type { DeckVersion, SlidePreview } from '../components/preview/PreviewSidebar'

const PPT_LAYOUT_WIDE_WIDTH = 13.333
const PPT_LAYOUT_WIDE_HEIGHT = 7.5

function encodeSvgAsBase64Data(svgContent: string): string {
  const utf8Bytes = new TextEncoder().encode(svgContent.trim())
  let binary = ''

  for (const byte of utf8Bytes) {
    binary += String.fromCharCode(byte)
  }

  return `data:image/svg+xml;base64,${btoa(binary)}`
}

function createExportFileName(deckVersion: DeckVersion): string {
  return `ppt-agent-${deckVersion}.pptx`
}

export async function exportSlidesAsPpt({
  deckVersion,
  slides,
}: {
  deckVersion: DeckVersion
  slides: SlidePreview[]
}) {
  if (slides.length === 0) {
    return
  }

  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  const fileName = createExportFileName(deckVersion)
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'PPT Agent Frontend'
  pptx.subject = deckVersion === 'draft' ? 'PPT draft export' : 'PPT final export'
  pptx.title = deckVersion === 'draft' ? 'PPT 初稿' : 'PPT 终稿'

  for (const slide of slides) {
    const pptSlide = pptx.addSlide()
    pptSlide.addImage({
      altText: slide.title,
      data: encodeSvgAsBase64Data(slide.svgContent),
      x: 0,
      y: 0,
      w: PPT_LAYOUT_WIDE_WIDTH,
      h: PPT_LAYOUT_WIDE_HEIGHT,
    })
  }

  await pptx.writeFile({
    fileName,
  })

  return fileName
}
