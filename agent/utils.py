import logging
import shutil
import subprocess
from pathlib import Path

import pymupdf

logger = logging.getLogger(__name__)


def ppt2svg(ppt_file_path: str | Path) -> list[str]:
    """
    将ppt转为svg格式
    """

    data_dir = Path(ppt_file_path).parent
    file_name = Path(ppt_file_path).stem
    temp_pdf_dir = data_dir / "temp_pdf"
    if temp_pdf_dir.exists():
        raise FileExistsError(f"PDF目录已存在: {temp_pdf_dir}")
    temp_pdf_dir.mkdir(parents=True, exist_ok=False)

    # 1) PPTX -> PDF
    subprocess.run(
        [
            "soffice",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(temp_pdf_dir),
            ppt_file_path,
        ],
        check=True,
    )

    pdf_path = temp_pdf_dir / Path(file_name).with_suffix(".pdf")

    # 2) PDF -> per-page SVG
    svg_result: list[str] = []
    with pymupdf.open(pdf_path) as doc:
        for page in doc:
            svg = page.get_svg_image()
            svg_result.append(svg)
    try:
        shutil.rmtree(temp_pdf_dir)
        logging.info(f"已删除临时PDF目录: {temp_pdf_dir}")
    except Exception as e:
        logging.warning(f"删除临时PDF目录失败: {temp_pdf_dir}, 错误: {e}")
    return svg_result


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
