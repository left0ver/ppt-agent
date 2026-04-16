import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import json_repair
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.runtime import Runtime
from langgraph.types import Send, interrupt

from src.ppt_agent.build_model import build_model
from src.ppt_agent.config import get_config
from src.ppt_agent.extractors import ExtractorFactory
from src.ppt_agent.mineru_parser_batch import MinerUBatchClient
from src.ppt_agent.prompt import (
    extract_ppt_info_prompt_template,
    extracted_page_content_from_user_content_prompt_template,
    grok_search_ppt_content_per_page_prompt_template,
    grok_search_prompt_template,
    ppt_outline_prompt_template,
)
from src.ppt_agent.state import InputSchema, PPTInfo, State
from src.ppt_agent.task import (
    extract_page_content_task_with_delay,
    search_page_content_task_with_delay,
)
from src.ppt_agent.types import (
    LayoutType,
    PPTInfoInterruptValues,
    PPTStyleInterruptValues,
    UploadPPTContentFilesInterruptValues,
    UploadPPTTemplateInterruptValues,
)
from src.ppt_agent.utils import ensure_session_dirs, ppt2svg

logger = logging.getLogger(__file__)

model_info = build_model()
search_model = model_info["search_model"]
generate_model = model_info["generate_model"]
intent_recognition_model = model_info["intent_recognition_model"]
user_config = get_config()
USER_DATA_ROOT_DIR = user_config["USER_DATA_ROOT_DIR"]
delay = user_config["delay"]

# node
def ask_for_ppt_info(
    input: InputSchema, runtime: Runtime, config: RunnableConfig
) -> dict:
    writer = get_stream_writer()
    writer({"current_stage": "正在确认PPT的具体需求"})

    thread_id = config["configurable"].get("thread_id")

    # 确保相关的用户目录已经创建
    ensure_session_dirs(thread_id)
    json_parser = JsonOutputParser()
    chain = extract_ppt_info_prompt_template | intent_recognition_model | json_parser

    ppt_info = chain.invoke({"user_input": input.ppt_requirement})

    ppt_info_from_user: dict = interrupt(
        PPTInfoInterruptValues(
            title="请确认或者修改以下PPT的相关信息，确认无误后点击提交",
            payload=ppt_info,
        )
    )
    ppt_info = PPTInfo(
        theme=ppt_info_from_user["theme"],
        target_audience=ppt_info_from_user["target_audience"],
        num_pages=ppt_info_from_user["num_pages"],
        user_role=ppt_info_from_user["user_role"],
        layout_style=ppt_info_from_user["layout_style"],
    )

    ppt_content_source_from_user = interrupt(
        UploadPPTContentFilesInterruptValues(
            title="你可以上传PPT内容相关的文件或者网站,如果没有可以直接跳过",
        )
    )
    # TODO: 验证url是否正确
    have_ppt_content_files, ppt_content_source_urls = (
        ppt_content_source_from_user["have_ppt_content_files"],
        ppt_content_source_from_user.get("ppt_content_source_urls", None),
    )

    ppt_template_info = interrupt(
        UploadPPTTemplateInterruptValues(
            title="你可以上传一个PPT模板文件，如果没有可以直接跳过",
        )
    )
    # 如果 have_ppt_template=False, ppt_template_path则为None
    have_ppt_template, ppt_template_path = (
        ppt_template_info["have_ppt_template"],
        ppt_template_info["ppt_template_path"],
    )

    return {
        "ppt_info": ppt_info,
        "have_ppt_content_files": have_ppt_content_files,
        "have_ppt_template": have_ppt_template,
        "ppt_content_source_urls": ppt_content_source_urls,
        "ppt_template_path": ppt_template_path if have_ppt_template else None,
    }


# conditional_edge
def route_via_ppt_content_files(state: State):
    # 如果用户有内容文件则走内容文件的流程，没有则走搜索内容的流程
    have_ppt_content_files = state.have_ppt_content_files
    if have_ppt_content_files:
        return "parser"
    else:
        return "search"


# node
# 使用grok+tavily 来根据ppt的主题来搜索一些相关的内容，结果会被用来生成ppt-outline
def search_ppt_contents(state: State, runtime: Runtime, config: RunnableConfig):
    writer = get_stream_writer()
    writer({"current_stage": "用户没有上传内容文件，正在根据PPT的相关信息来搜索内容"})
    thread_id = config["configurable"].get("thread_id")
    ppt_info: PPTInfo = state.ppt_info

    chain = grok_search_prompt_template | search_model | JsonOutputParser()
    # 使用grok的搜索能力来搜索ppt的内容
    grok_search_results = chain.with_retry().invoke(
        {
            "theme": ppt_info.theme,
            "target_audience": ppt_info.target_audience,
            "user_role": ppt_info.user_role,
        },
    )
    urls = [
        result.get("url")
        for result in grok_search_results
        if result.get("url") is not None
    ]
    # 使用tavily或者firecrawl等提取搜素到的网站的内容，返回markdown格式的内容
    web_fetch_client = ExtractorFactory(
        provider=os.environ.get("PAGE_EXTRACTOR_PROVIDER", "tavily")
    )
    web_fetch_results = web_fetch_client.extract_with_retry(urls)
    return {
        "grok_search_results": grok_search_results,
        "web_fetch_results": web_fetch_results,
    }


# node
def parse_ppt_content_files(state: State, runtime: Runtime, config: RunnableConfig):
    """
    使用mineru解析用户上传的文件
    """
    writer = get_stream_writer()
    writer({"current_stage": "正在解析用户PPT的内容文件"})
    thread_id = config["configurable"].get("thread_id")
    ppt_content_dir = Path(f"{USER_DATA_ROOT_DIR}/{thread_id}/context_files")
    parsed_output_dir = Path(f"{USER_DATA_ROOT_DIR}/{thread_id}/context_parse")
    if not ppt_content_dir.exists():
        return {
            "parsed_ppt_content_files": [],
            "ppt_content_parse_batch_id": None,
        }
    # markdown格式不需要解析,mineru只要解析pdf和docx格式的文件即可
    need_parsed_file_extensions = [".pdf", ".docx"]
    markdown_file_extensions = [".markdown", ".md"]
    need_parse_file_paths = sorted(
        path
        for path in ppt_content_dir.iterdir()
        if path.is_file() and path.suffix in need_parsed_file_extensions
    )
    markdown_file_paths = [
        path
        for path in ppt_content_dir.iterdir()
        if path.is_file() and path.suffix in markdown_file_extensions
    ]

    if len(need_parse_file_paths) <= 0 and len(markdown_file_paths) <= 0:
        return {
            "ppt_content_files_markdown_contents": None,
        }

    mineru_client = MinerUBatchClient.from_env()
    batch_result = mineru_client.batch_parse_local_files(
        need_parse_file_paths, parsed_output_dir
    )

    parsed_files: list[dict[str, Any]] = []
    for item in batch_result["downloads"]:
        full_md_path = item.get("full_md_path")
        markdown_content = ""
        if full_md_path and Path(full_md_path).exists():
            markdown_content = Path(full_md_path).read_text(encoding="utf-8")
        parsed_files.append(
            {
                "file_name": item.get("file_name"),
                "state": item.get("state"),
                "zip_path": item.get("zip_path"),
                "output_dir": item.get("output_dir"),
                "full_md_path": full_md_path,
                "markdown_content": markdown_content,
                "error": item.get("error"),
            }
        )
    ppt_content_files_markdown_contents = [
        file["markdown_content"] for file in parsed_files
    ]
    # 处理markdown文件
    for markdown_file_path in markdown_file_paths:
        markdown_content = markdown_file_path.read_text(encoding="utf-8")
        ppt_content_files_markdown_contents.append(markdown_content)
    return {
        "ppt_content_files_markdown_contents": ppt_content_files_markdown_contents,
    }


# node
def parse_ppt_content_urls(state: State, runtime: Runtime, config: RunnableConfig):
    """解析用户所给的ppt内容相关的urls,通过Tavily或者Firecrawl来抓取对应的页面的内容转为markdown的格式"""
    writer = get_stream_writer()
    writer({"current_stage": "正在解析用户提供的内容相关的网站内容"})
    ppt_content_source_urls = state.ppt_content_source_urls
    if ppt_content_source_urls is None or len(ppt_content_source_urls) <= 0:
        return {}
    else:
        ppt_content_files_markdown_contents: list[str] = (
            state.ppt_content_files_markdown_contents or []
        )
        web_fetch_client = ExtractorFactory(
            provider=os.environ.get("PAGE_EXTRACTOR_PROVIDER", "tavily")
        )
        web_fetch_results = web_fetch_client.extract_with_retry(ppt_content_source_urls)
        for web_fetch_result in web_fetch_results:
            markdown_content = web_fetch_result.get("markdown_content", "")
            ppt_content_files_markdown_contents.append(markdown_content)
        return {
            "ppt_content_files_markdown_contents": ppt_content_files_markdown_contents,
        }


# node
def parse_ppt_template(
    state: State,
    runtime: Runtime,
    config: RunnableConfig,
):
    """
    将用户上传的ppt、pptx模板转为svg的格式，用来后面LLM根据这个模板的svg来生成对应的ppt
    """
    writer = get_stream_writer()
    writer({"current_stage": "正在解析用户上传的PPT模板"})
    # TODO: 可能得加一些pptx的页数的限制，页数太多会导致上下文太长
    thread_id = config["configurable"].get("thread_id")
    if not state.have_ppt_template:
        logging.info("用户没有上传PPT模板")
        return {
            "svg_template_lists": None,
        }
    ppt_template_dir = Path(f"{USER_DATA_ROOT_DIR}/{thread_id}/template")
    all_ext = ["pptx", "ppt"]
    for ext in all_ext:
        maybe_ppt_template_file = ppt_template_dir / f"template.{ext}"
        if maybe_ppt_template_file.exists():
            ppt_template_file = maybe_ppt_template_file
            break
    else:
        raise FileNotFoundError(
            f"在目录{ppt_template_dir}下没有找到ppt的模板文件，支持的格式有{','.join(all_ext)},但是用户却上传了模板文件。"
        )
    # 将ppt转为svg
    svg_template_lists = ppt2svg(ppt_template_file)
    return {"svg_template_lists": svg_template_lists}


# node
async def generate_ppt_outline(state: State, runtime: Runtime, config: RunnableConfig):
    """生成ppt的大纲"""
    writer = get_stream_writer()
    writer({"current_stage": "正在生成PPT的大纲"})
    thread_id = config["configurable"].get("thread_id")
    if (
        state.ppt_content_files_markdown_contents is not None
        and len(state.ppt_content_files_markdown_contents) > 0
    ):
        context_list = state.ppt_content_files_markdown_contents
    elif state.web_fetch_results is not None:
        context_list = [
            web_fetch_result.get("markdown_content")
            for web_fetch_result in state.web_fetch_results
        ]
    else:
        raise ValueError(
            "没有找到可以用来生成PPT大纲的内容，用户既没有上传内容文件，也没有搜索到相关的内容。"
        )
    context = ""
    for i, item in enumerate(context_list, start=1):
        context += f"# 第{i}部分\n\n{item}\n\n"

    chain = ppt_outline_prompt_template | generate_model
    ppt_outline_response = await chain.ainvoke(
        {
            "theme": state.ppt_info.theme,
            "user_role": state.ppt_info.user_role,
            "target_audience": state.ppt_info.target_audience,
            "num_pages": state.ppt_info.num_pages,
            "context": context,
        }
    )
    # 根据[PPT_OUTLINE]和[/PPT_OUTLINE]来提取出PPT的大纲
    json_parser = JsonOutputParser()
    match = re.search(
        r"\[PPT_OUTLINE\]([\s\S]*?)\[/PPT_OUTLINE\]", ppt_outline_response.content
    )
    if match:
        ppt_outline_json_str = match.group(1)
        ppt_outline = json_parser.parse(ppt_outline_json_str)["ppt_outline"]
    if (
        state.ppt_content_files_markdown_contents is not None
        and len(state.ppt_content_files_markdown_contents) > 0
    ):
        return {"ppt_outline": ppt_outline, "user_content": context}
    else:
        return {"ppt_outline": ppt_outline, "user_content": None}


# node
async def generate_ppt_content_per_page(
    state: State, runtime: Runtime, config: RunnableConfig
):
    """根据ppt的大纲来搜索每一页的内容或者根据用户上传的内容文件来提取出每一页所需的内容"""
    writer = get_stream_writer()
    writer({"current_stage": "正在根据大纲来生成PPT每一页的内容"})
    have_ppt_content_files = state.have_ppt_content_files
    thread_id = config["configurable"].get("thread_id")

    ppt_outline_parts = state.ppt_outline["parts"]
    ppt_outline_pages = [
        {"type": "page", "part": i, "page": page}
        for i, part in enumerate(ppt_outline_parts)
        for page in part["pages"]
    ]

    ppt_part_page_contents_task = []
    ppt_part_page_contents: list[dict] = []
    if have_ppt_content_files:
        # 使用用户上传的文件来作为内容的来源
        chain = extracted_page_content_from_user_content_prompt_template | search_model
        for i, ppt_outline_page in enumerate(ppt_outline_pages):
            ppt_part_page_contents_task.append(
                extract_page_content_task_with_delay(
                    chain, state, ppt_outline_page, i, delay=delay
                )
            )
        ppt_part_page_contents: list[dict] = await asyncio.gather(
            *ppt_part_page_contents_task
        )

    else:
        chain = grok_search_ppt_content_per_page_prompt_template | search_model
        for i, ppt_outline_page in enumerate(ppt_outline_pages):
            ppt_part_page_contents_task.append(
                search_page_content_task_with_delay(
                    chain, state, ppt_outline_page, i, delay=delay
                )
            )
        ppt_part_page_contents: list[dict] = await asyncio.gather(
            *ppt_part_page_contents_task
        )

    # ppt的封面
    cover_content = json.dumps(state.ppt_outline["cover"], ensure_ascii=False)
    catalog_content = json.dumps(
        state.ppt_outline["table_of_contents"], ensure_ascii=False
    )
    end_page_content = json.dumps(state.ppt_outline["end_page"], ensure_ascii=False)
    # 处理不同部分的封面
    part_contents = []
    for part in state.ppt_outline["parts"]:
        part_title = part.get("part_title", "")
        page_titles = [page.get("title", "") for page in part.get("pages", [])]
        part_content = json.dumps(
            {
                "part_title": part_title,
                "page_titles": page_titles,
            },
            ensure_ascii=False,
        )
        part_contents.append(part_content)
    # 最后得到 ppt_page_contents包含ppt的所有页用于生成初稿的内容
    current_part = -1
    ppt_page_contents = []
    for ppt_page_content in ppt_part_page_contents:
        if current_part != ppt_page_content["num_part"]:
            current_part = ppt_page_content["num_part"]
            ppt_page_contents.append(
                {
                    "type": "part_cover",
                    "content": part_contents[current_part],
                    "speaker_notes": "",
                }
            )
        ppt_page_contents.append(
            {
                "type": "part_page",
                "content": ppt_page_content["content"],
                "speaker_notes": ppt_page_content["speaker_notes"],
            }
        )

    ppt_page_contents = (
        [
            # 封面
            {"type": "cover", "content": cover_content, "speaker_notes": ""},
            # 目录
            {
                "type": "table_of_contents",
                "content": catalog_content,
                "speaker_notes": "",
            },
        ]
        + ppt_page_contents
        # 结尾页
        + [{"type": "end_page", "content": end_page_content, "speaker_notes": ""}]
    )
    writer({"current_stage": "正在生成PPT的初稿"})
    return {
        "ppt_page_contents": ppt_page_contents,
    }


# 条件边
def assign_generate_first_draft_task(state: State):
    ppt_page_contents = state.ppt_page_contents or []
    layout_style: LayoutType = state.ppt_info.layout_style or "top_bottom"

    return [
        Send(
            "generate_first_draft_task",
            {
                "page_content": ppt_page_content.get("content"),
                "page_index": i,
                "layout_style": layout_style,
                "page_type": "part_page"
                if ppt_page_content.get("type") == "part_page"
                else "cover",
                "delay": delay,
            },
        )
        for i, ppt_page_content in enumerate(ppt_page_contents)
    ]


# node
def ask_for_style(state: State, runtime: Runtime, config: RunnableConfig):
    writer = get_stream_writer()
    writer({"current_stage": "正在确认需要的PPT风格"})
    user_ppt_style_info = interrupt(
        PPTStyleInterruptValues(
            title="请输入你想要的PPT的整体风格(包含颜色+风格)，例如绿色简约风，黑色科技风等",
        )
    )
    user_ppt_style = user_ppt_style_info["user_ppt_style"]
    writer({"current_stage": "正在生成最终的PPT"})
    return {
        "user_ppt_style": user_ppt_style,
    }


# 条件边
def assign_generate_final_ppt_task(state: State):

    user_ppt_style = state.user_ppt_style
    if user_ppt_style is None or len(user_ppt_style.strip()) == 0:
        user_ppt_style = "绿色简约风"
        logging.info(f"用户没有输入PPT风格，默认使用{user_ppt_style}作为PPT的风格")

    first_draft_results = state.first_draft_results or []

    return [
        Send(
            "generate_final_ppt_task",
            {
                "first_draft_svg_code": first_draft_result["svg_content"],
                "user_ppt_style": user_ppt_style,
                "page_index": i,
                "delay": delay,
            },
        )
        for i, first_draft_result in enumerate(first_draft_results)
    ]
