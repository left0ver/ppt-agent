import asyncio
import logging
from pathlib import Path
from typing import Literal, TypedDict, cast

from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import RunnableConfig, RunnableLambda
from langgraph.config import get_stream_writer
from agent.prompt import (
    ppt_final_draft_prompt_template,
    ppt_first_draft_grid_style_prompt_template,
    ppt_first_draft_guide_page_prompt_template,
    ppt_first_draft_Top_Bottom_style_prompt_template,
)
from agent.utils import extract_svg_from_response, verify_svg

from agent.build_model import build_model
from agent.config import get_config
from agent.types import LayoutType

logger = logging.getLogger(__file__)

user_config = get_config()
USER_DATA_ROOT_DIR = user_config.get("USER_DATA_ROOT_DIR")


class FirstDraftTaskState(TypedDict):
    page_content: str
    page_index: int  # 下标从0开始
    layout_style: LayoutType
    page_type: Literal["cover", "part_page"]  # 封面页和内容页的提示词不一样
    delay: float  # 可选的延迟参数，单位为秒，默认为0


# node
async def generate_first_draft_task(
    worker_state: FirstDraftTaskState, config: RunnableConfig
):
    page_content = worker_state["page_content"]
    page_index = worker_state["page_index"]
    layout_style = worker_state["layout_style"]
    page_type = worker_state["page_type"]
    delay = worker_state["delay"]
    thread_id = config["configurable"]["thread_id"]
    generate_first_draft_model = cast(
        BaseChatModel, build_model().get("generate_model")
    )
    if delay > 0:
        await asyncio.sleep(page_index * delay)

    match layout_style:
        case "top_bottom":
            content_page_prompt_template = (
                ppt_first_draft_Top_Bottom_style_prompt_template
            )
        case "grid":
            content_page_prompt_template = ppt_first_draft_grid_style_prompt_template
        case _:
            raise ValueError(
                f"不支持的布局风格{layout_style},目前仅支持{LayoutType.__args__}的布局风格"
            )
    prompt_template = (
        content_page_prompt_template
        if page_type == "part_page"
        else ppt_first_draft_guide_page_prompt_template
    )

    chain = (
        prompt_template
        | generate_first_draft_model
        | RunnableLambda(extract_svg_from_response)
        | RunnableLambda(verify_svg)
    )

    ppt_page_content = await chain.ainvoke({"page_content": page_content})
    svg_file_path = Path(
        f"{USER_DATA_ROOT_DIR}/{thread_id}/first_draft/page_{page_index + 1}.svg"
    )
    svg_file_path.parent.mkdir(parents=True, exist_ok=True)
    svg_file_path.write_text(ppt_page_content, encoding="utf-8")

    logger.info(f"第{page_index + 1}页的初稿已经生成并保存到{svg_file_path}")
    writer = get_stream_writer()
    writer(
        {
            "first_draft": {
                "page_index": page_index,
                "svg_content": ppt_page_content,
                "file_path": str(svg_file_path),
            }
        }
    )
    return {
        "first_draft_results": [
            {
                "page_index": page_index,
                "svg_content": ppt_page_content,
                "file_path": str(svg_file_path),
            }
        ]
    }


class FinalPPTTaskState(TypedDict):
    user_ppt_style: str
    first_draft_svg_code: str
    page_index: int  # 下标从0开始
    delay: float  # 可选的延迟参数，单位为秒，默认为0


# node
async def generate_final_ppt_task(
    generate_final_ppt_worker_state: FinalPPTTaskState, config: RunnableConfig
):
    thread_id = config["configurable"].get("thread_id")
    first_draft_svg_code = generate_final_ppt_worker_state["first_draft_svg_code"]
    user_ppt_style = generate_final_ppt_worker_state["user_ppt_style"]
    page_index = generate_final_ppt_worker_state["page_index"]
    delay = generate_final_ppt_worker_state["delay"]
    if delay > 0:
        await asyncio.sleep(page_index * delay)

    generate_final_ppt_model = cast(BaseChatModel, build_model().get("generate_model"))
    chain = (
        ppt_final_draft_prompt_template
        | generate_final_ppt_model
        | RunnableLambda(extract_svg_from_response)
        | RunnableLambda(verify_svg)
    )

    final_ppt_path = Path(
        f"{USER_DATA_ROOT_DIR}/{thread_id}/final_ppt/page_{page_index + 1}.svg"
    )
    final_ppt_svg_content = await chain.ainvoke(
        {"first_draft_svg_code": first_draft_svg_code, "user_ppt_style": user_ppt_style}
    )
    final_ppt_path.parent.mkdir(parents=True, exist_ok=True)
    final_ppt_path.write_text(final_ppt_svg_content, encoding="utf-8")
    logger.info(f"第{page_index + 1}页的终稿已经生成并保存到{final_ppt_path}")
    writer = get_stream_writer()
    writer(
        {
            "final_ppt": {
                "page_index": page_index,
                "svg_content": final_ppt_svg_content,
                "file_path": final_ppt_path,
            }
        }
    )

    return {
        "final_ppt_results": [
            {
                "page_index": page_index,
                "svg_content": final_ppt_svg_content,
                "file_path": final_ppt_path,
            }
        ]
    }
