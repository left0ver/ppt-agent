import asyncio
import logging
import re
from pathlib import Path

from langchain_core.output_parsers import JsonOutputParser
from tenacity import retry, stop_after_attempt, wait_fixed

from agent.config import get_config

logger = logging.getLogger(__file__)
USER_DATA_ROOT_DIR =  get_config().get("USER_DATA_ROOT_DIR")

@retry(stop=stop_after_attempt(3), wait=wait_fixed(1))
async def search_page_content_task_with_delay(
    chain, state, ppt_outline_page, index: int, delay: float = 0.0
):
    if delay > 0:
        await asyncio.sleep(index * delay)
    json_parser = JsonOutputParser()
    response = await chain.ainvoke(
        {
            "ppt_theme": state.ppt_info.theme,
            "target_audience": state.ppt_info.target_audience,
            "page_title": ppt_outline_page.get("title", ""),
            "page_content_summary": ";".join(
                ppt_outline_page.get("page", {}).get("content")
            ),
        }
    )
    # 根据[PPT_OUTLINE]和[/PPT_OUTLINE]来提取出PPT的大纲
    match = re.search(r"\[PPT_CONTENT\]([\s\S]*?)\[/PPT_CONTENT\]", response.content)
    if match:
        ppt_page_content_str = match.group(1)
        ppt_page_content_obj = json_parser.parse(ppt_page_content_str)
        return {
            "num_part": ppt_outline_page["part"],
            "content": ppt_page_content_obj["content"],
            "speaker_notes": ppt_page_content_obj["speaker_notes"],
        }

    else:
        raise ValueError(
            f"在LLM的返回中没有找到[PPT_CONTENT]和[/PPT_CONTENT]来包裹的内容，请确保LLM按照要求输出，并且输出的内容是一个合法的JSON字符串。LLM的原始输出是: {response.content}"
        )


@retry(stop=stop_after_attempt(3), wait=wait_fixed(1))
async def extract_page_content_task_with_delay(
    chain, state, ppt_outline_page, index: int, delay: float = 0.0
):
    if delay > 0:
        await asyncio.sleep(index * delay)
    json_parser = JsonOutputParser()
    response = await chain.ainvoke(
        {
            "context": state.user_content,
            "ppt_theme": state.ppt_info.theme,
            "target_audience": state.ppt_info.target_audience,
            "page_title": ppt_outline_page.get("title", ""),
            "page_content_summary": ";".join(
                ppt_outline_page.get("page", {}).get("content")
            ),
        }
    )
    # 根据[PPT_OUTLINE]和[/PPT_OUTLINE]来提取出PPT的大纲
    match = re.search(r"\[PPT_CONTENT\]([\s\S]*?)\[/PPT_CONTENT\]", response.content)
    if match:
        ppt_page_content_str = match.group(1)
        ppt_page_content_obj = json_parser.parse(ppt_page_content_str)
        return {
            "num_part": ppt_outline_page["part"],
            "content": ppt_page_content_obj["content"],
            "speaker_notes": ppt_page_content_obj["speaker_notes"],
        }

    else:
        raise ValueError(
            f"在LLM的返回中没有找到[PPT_CONTENT]和[/PPT_CONTENT]来包裹的内容，请确保LLM按照要求输出，并且输出的内容是一个合法的JSON字符串。LLM的原始输出是: {response.content}"
        )


@retry(stop=stop_after_attempt(3), wait=wait_fixed(1))
async def generate_first_draft_task_with_delay(
    chain, page_content: str, thread_id: str, index: int, delay: float = 0.0
):
    if delay > 0:
        await asyncio.sleep(index * delay)
    svg_content = await chain.ainvoke({"page_content": page_content})
    # # 将LLM的输出保存为svg文件
    svg_file_path = Path(
        f"{USER_DATA_ROOT_DIR}/{thread_id}/first_draft/page_{index + 1}.svg"
    )

    svg_file_path.parent.mkdir(parents=True, exist_ok=True)
    svg_file_path.write_text(svg_content, encoding="utf-8")

    logger.info(f"第{index + 1}页的初稿已经生成并保存到{svg_file_path}")
    return {
        "page": index + 1,
        "svg_content": svg_content,
        "file_path": str(svg_file_path),
    }


# task
@retry(stop=stop_after_attempt(3), wait=wait_fixed(1))
async def generate_final_ppt_task_with_delay(
    chain, first_draft_result, user_ppt_style, thread_id, index, delay=0.0
):
    if delay > 0:
        await asyncio.sleep(index * delay)

    final_ppt_path = Path(
        f"{USER_DATA_ROOT_DIR}/{thread_id}/final_ppt/page_{index + 1}.svg"
    )
    svg_content = await chain.ainvoke(
        {
            "first_draft_svg_code": first_draft_result.get("svg_content", ""),
            "user_ppt_style": user_ppt_style or "",
        }
    )
    final_ppt_path.parent.mkdir(parents=True, exist_ok=True)
    final_ppt_path.write_text(svg_content, encoding="utf-8")
    logger.info(f"第{index + 1}页的终稿已经生成并保存到{final_ppt_path}")
    return {
        "page": index + 1,
        "svg_content": svg_content,
        "file_path": str(final_ppt_path),
    }



