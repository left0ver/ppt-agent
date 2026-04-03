import logging
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
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


class InvalidSVGError(Exception):
    """当遇到不合法的SVG时抛出此异常"""

    def __init__(self, message="非法的 SVG 内容"):
        self.message = message
        # 调用父类的初始化方法，将基本错误信息传进去
        super().__init__(f"{message}")


def verify_svg(svg_string):
    try:
        # 尝试解析XML
        root = ET.fromstring(svg_string)
        if root.tag.lower().endswith("svg"):
            return svg_string
        raise InvalidSVGError()
    except ET.ParseError:
        raise InvalidSVGError()


def extract_svg_from_response(response) -> str:
    svg_match = re.search(r"<svg\b[^>]*>[\s\S]*?<\/svg>", response.content)
    if svg_match:
        svg_content = svg_match.group(0)
    else:
        raise ValueError(
            f"在LLM的返回中没有找到<svg>标签来包裹的内容，请确保LLM按照要求输出，并且输出的内容包含一个合法的SVG字符串。LLM的原始输出是: {response.content}"
        )
    return svg_content
