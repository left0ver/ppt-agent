import aspose.slides as slides
from pathlib import Path

# with slides.Presentation("ppt/工作汇报.pptx") as pres:
#     for i, slide in enumerate(pres.slides):
#         with open(f"slide-{i+1}.svg", "wb") as f:
#             slide.write_as_svg(f)

# def read_svg(file_path):
#     svg_content = Path(file_path).read_text()
#     return svg_content
# svg_data = read_svg("slide-1.svg")
# print(svg_data)


## pptx2pdf2svg
import subprocess
from pathlib import Path
import pymupdf

pptx = "ppt/工作汇报.pptx"
out_dir = Path("out")
out_dir.mkdir(exist_ok=True)

# 1) PPTX -> PDF
subprocess.run([
    "soffice",
    "--headless",
    "--convert-to", "pdf",
    "--outdir", str(out_dir),
    pptx
], check=True)

pdf_path = out_dir / "工作汇报.pdf"

# 2) PDF -> per-page SVG
doc = pymupdf.open(pdf_path)
for i, page in enumerate(doc):
    svg = page.get_svg_image()
    (out_dir / f"slide-{i+1}.svg").write_text(svg, encoding="utf-8")
doc.close()
