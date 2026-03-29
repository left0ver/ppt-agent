import asyncio
import json
import logging
import os
import re
from enum import Enum
from pathlib import Path
from typing import Annotated, Any, Literal, Optional, TypedDict

import json_repair
from dotenv import load_dotenv
from extractors import ExtractorFactory
from langchain.messages import AnyMessage
from langchain_core.messages import HumanMessage
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate, PromptTemplate

# from gohumanloop.adapters.langgraph_adapter import interrupt, create_resume_command
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import Command
from langgraph.runtime import Runtime
from langgraph.types import Command, interrupt
from mineru_parser_batch import MinerUBatchClient
from prompt import (
    extracted_page_content_from_user_content_prompt_template,
    grok_search_ppt_content_per_page_prompt_template,
    grok_search_prompt_template,
    ppt_final_draft_prompt_template,
    ppt_first_draft_grid_style_prompt_template,
    ppt_first_draft_guide_page_prompt_template,
    ppt_outline_prompt_template,
)
from pydantic import BaseModel, Field
from task import (
    generate_final_ppt_task_with_delay,
    generate_first_draft_task_with_delay,
    search_page_content_task_with_delay,
    extract_page_content_task_with_delay,
)
from temp import (
    first_draft_results,
    ppt_content_files_markdown_contents,
    ppt_outline,
    ppt_page_contents,
    web_fetch_results,
    user_content,
)
from utils import ppt2svg, setup_logging

load_dotenv()
setup_logging()
logger = logging.getLogger(__file__)


class TimeLine(Enum):
    NO_START = "no_start"
    INFO_GATHERED = "info_gathered"  # 信息收集完成
    OUTLINE_GENERATED = "outline_generated"
    SKETCH_GENERATED = "sketch_generated"
    COMPLETED = "completed"


class InterruptType(Enum):
    FORM = "form"
    CONFIRMATION = "confirmation"
    UPLOAD_PPT_CONTENT_FILES = "upload_ppt_content_files"
    UPLOAD_PPT_TEMPLATE = "upload_ppt_template"
    INPUT = "input"


class PPTInfo(BaseModel):
    target_audience: Optional[str] = Field(description="PPT的目标群体")
    user_role: Optional[str] = Field(
        description="用户的角色，例如软件工程师、学生、产品经理"
    )
    purpose: Optional[str] = Field(description="PPT的目的，例如汇报、演讲、培训")
    style: Optional[str] = Field(description="PPT的风格，例如商务风、简约风、科技风")
    num_pages: Optional[int] = Field(description="PPT的页数,1—30页", gt=0, le=30)
    theme: Optional[str] = Field(
        description="PPT的主题，例如'dify的介绍', '人工智能的发展趋势', '如何提升工作效率'等"
    )


class PPTContentPerPage(TypedDict):
    type: Literal["cover", "table_of_contents", "part_cover", "part_page", "end_page"]
    content: Annotated[
        str,
        "这一页PPT的内容",
    ]

    speaker_notes: Annotated[str, "这一页PPT的演讲者备注"]
    num_part: Optional[int]


class State(BaseModel):
    ppt_info: PPTInfo | None
    messages: Annotated[list[AnyMessage], add_messages]
    ppt_template_path: str | None = Field(
        description="PPT模板的文件路径，例如template/template.pdf"
    )
    current_timeline: TimeLine = Field(
        default=TimeLine.NO_START, description="当前timeline"
    )
    have_ppt_content_files: bool = Field(
        default=False,
        description="用户是否有相关内容文件,如果有则使用用户的文档来做PPT,没有则会根据用户的ppt的需求来搜索内容",
    )
    ppt_content_source_urls: list[str] | None = Field(
        default=None, description="用户提供的ppt内容相关的urls,如果用户有提供的话"
    )

    have_ppt_template: bool = Field(
        default=False,
        description="用户是否有PPT模板,如果有则使用用户的模板",
    )
    grok_search_results: list[dict] | None = Field(
        default=None,
        description="根据用户的ppt需求使用grok来搜索相关的页面，list的每一项包含title, description, url字段",
    )
    web_fetch_results: list[dict] | None = Field(
        default=None,
        description="根据grok_search_results的搜索到的urls,通过Tavily或者Firecrawl来抓取对应的页面的内容转为markdown的格式,list的每一项包含url, title, markdown_content字段",
    )
    ppt_content_files_markdown_contents: list[str] | None = Field(
        default=None, description="用户上传的PPT内容相关的文件解析成markdown文本"
    )
    svg_template_lists: list[str] | None = Field(
        default=None,
        description="用户上传的PPT模板转为svg格式后的内容，list的每一项是一个svg文本，后续LLM会根据这个svg文本来生成对应的ppt",
    )
    ppt_outline: dict | None = Field(
        default=None,
        description="根据用户的需求和背景调研信息生成的PPT大纲，包含封面、目录、各个部分的标题和每一页的标题以及结尾页",
    )
    user_content: str | None = Field(
        default=None,
        description="用户上传的内容文件解析成的文本形式，会在之后生成每一页的内容时作为上下文提供给LLM",
    )
    ppt_page_contents: list[dict] | None = Field(
        default=None,
        description="每一项包含该页ppt的内容以及演讲者的备注，内容会在后面用来生成ppt的初稿和最终稿",
    )
    first_draft_results: list[dict] | None = Field(
        default=None, description="初稿的内容，包含每一页的svg内容和保存的文件路径"
    )
    user_ppt_style: str | None = Field(
        default=None,
        description="用户需要的最终的PPT风格，例如绿色简约风，黑色科技风等",
    )
    final_ppt_results: list[dict] | None = Field(
        default=None, description="根据初稿和用户所需的ppt的风格生成的最终的ppt"
    )


class InputSchema(BaseModel):
    theme: str = Field(
        description="PPT的主题，例如'dify的介绍', '人工智能的发展趋势', '如何提升工作效率'等"
    )


# node
def ask_for_ppt_info(input: InputSchema, runtime: Runtime) -> dict:
    # PPT的相关信息
    # TODO: 去掉一些不需要的信息的询问
    required_data = {
        "target_audience": {"type": "str", "description": "PPT的目标群体"},
        "user_role": {
            "type": "str",
            "description": "用户的角色，例如软件工程师、学生、产品经理",
        },
        "purpose": {"type": "str", "description": "PPT的目的,例如汇报、演讲、培训"},
        "style": {
            "type": "str",
            "description": "PPT的风格，例如商务风、简约风、科技风",
        },
        "num_pages": {"type": "int", "description": "PPT的页数,1—30页"},
    }
    while True:
        user_input = interrupt(
            {
                "title": "请你输入以下信息来帮助我更好地理解你的需求：",
                "type": InterruptType.FORM,
                "form_key": "ppt_info",
                "required_data": required_data,
            }
        )
        if isinstance(user_input, dict):
            target_audience = user_input.get("target_audience", None)
            if target_audience is not None:
                required_data.pop("target_audience")

            user_role = user_input.get("user_role", None)
            if user_role is not None:
                required_data.pop("user_role")
            purpose = user_input.get("purpose", None)
            if purpose is not None:
                required_data.pop("purpose")

            style = user_input.get("style", None)
            if style is not None:
                required_data.pop("style")
            num_pages = user_input.get("num_pages", None)
            if num_pages is not None and 1 <= num_pages <= 30:
                required_data.pop("num_pages")
        if len(required_data) == 0:
            ppt_info = PPTInfo(
                target_audience=target_audience,
                user_role=user_role,
                purpose=purpose,
                style=style,
                num_pages=num_pages,
                theme=input.theme,
            )
            break

    ppt_content_source_from_user = interrupt(
        {
            "title": "你可以上传PPT内容相关的文件或者网站,如果没有可以直接跳过",
            "type": InterruptType.UPLOAD_PPT_CONTENT_FILES,
            "file_type": ["pdf", "docx", "markdown"],
        }
    )
    # ppt_content_source_urls:list[str]
    have_ppt_content_files, ppt_content_source_urls = (
        ppt_content_source_from_user["have_ppt_content_files"],
        ppt_content_source_from_user.get("ppt_content_source_urls", None),
    )

    have_ppt_template = interrupt(
        {
            "title": "你可以上传一个PPT模板文件，如果没有可以直接跳过",
            "type": InterruptType.UPLOAD_PPT_TEMPLATE,
            "file_type": ["pptx", "pdf"],
        }
    )
    return {
        "ppt_info": ppt_info,
        "have_ppt_content_files": have_ppt_content_files,
        "have_ppt_template": have_ppt_template,
        "current_timeline": TimeLine.INFO_GATHERED,
        "ppt_content_source_urls": ppt_content_source_urls,
        # TODO:设置一下ppt_template_path
        # "ppt_template_path": None,
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
# 如果用户没有上传文档，则会使用grok+tavily 来根据ppt的主题来搜索一些相关的内容，结果会被用来生成ppt-outline
def search_ppt_contents(state: State, runtime: Runtime, config: RunnableConfig):
    thread_id = config["configurable"].get("thread_id")
    ppt_info: PPTInfo = state.ppt_info
    # 设置User-Agent来解决被cf拦截的问题
    user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

    grok_search_model = ChatOpenAI(
        model="grok-4.20-beta",
        base_url=os.environ["GROK_SEARCH_BASE_URL"],
        api_key=os.environ["GROK_SEARCH_API_KEY"],
        default_headers={"User-Agent": user_agent},
    )
    chain = grok_search_prompt_template | grok_search_model
    # 使用grok的搜索能力来搜索ppt的内容
    grok_search_response = chain.with_retry().invoke(
        {
            "theme": ppt_info.theme,
            "target_audience": ppt_info.target_audience,
            "user_role": ppt_info.user_role,
            "purpose": ppt_info.purpose,
        }
    )
    json_parser = JsonOutputParser()
    grok_search_results = json_parser.parse(
        json_repair.repair_json(grok_search_response.content)
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
def parser_ppt_content_files(state: State, runtime: Runtime, config: RunnableConfig):
    """
    使用mineru解析用户上传的文件
    """
    thread_id = config["configurable"].get("thread_id")
    ppt_content_dir = Path(f"user_data/{thread_id}/context_files")
    parsed_output_dir = Path(f"user_data/{thread_id}/context_parse")
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
    for markdown_file_path in markdown_file_paths:
        markdown_content = markdown_file_path.read_text(encoding="utf-8")
        ppt_content_files_markdown_contents.append(markdown_content)

    with open(
        f"user_data/{thread_id}/ppt_content_files_markdown_contents.json",
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(ppt_content_files_markdown_contents, f, ensure_ascii=False, indent=2)
    return {
        "ppt_content_files_markdown_contents": ppt_content_files_markdown_contents,
    }


def parser_ppt_content_urls(state: State, runtime: Runtime, config: RunnableConfig):
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
def parser_ppt_template(
    state: State,
    runtime: Runtime,
    config: RunnableConfig,
):
    """
    将用户上传的ppt、pptx、pdf模板转为svg的格式，用来后面LLM根据这个模板的svg来生成对应的ppt
    """
    # TODO: 可能得加一些pptx的页数的限制，页数太多会导致上下文太长
    thread_id = config["configurable"].get("thread_id")
    if not state.have_ppt_template:
        logging.info("用户没有上传PPT模板")
        return {
            "svg_template_lists": None,
        }
    ppt_template_dir = Path(f"user_data/{thread_id}/template")
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

    svg_template_lists = ppt2svg(ppt_template_file)
    return {"svg_template_lists": svg_template_lists}


# node
def generate_ppt_outline(state: State, runtime: Runtime, config: RunnableConfig):
    thread_id = config["configurable"].get("thread_id")
    # context =
    # context_list = state.ppt_content_files_markdown_contents or state.web_fetch_results or None
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
    generate_ppt_outline_model = ChatOpenAI(
        model=os.getenv("GEMINI_MODEL") or "gemini-3-flash-preview",
        base_url=os.getenv("GEMINI_BASE_URL"),
        api_key=os.getenv("GEMINI_API_KEY"),
    )
    chain = ppt_outline_prompt_template | generate_ppt_outline_model
    ppt_outline_response = chain.invoke(
        {
            "theme": state.ppt_info.theme,
            "user_role": state.ppt_info.user_role,
            "purpose": state.ppt_info.purpose,
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
    with open(f"user_data/{thread_id}/ppt_outline.json", "w", encoding="utf-8") as f:
        json.dump(ppt_outline, f, ensure_ascii=False, indent=2)
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
    have_ppt_content_files = state.have_ppt_content_files
    thread_id = config["configurable"].get("thread_id")
    # 设置User-Agent来解决被cf拦截的问题
    user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    grok_search_model = ChatOpenAI(
        model="grok-4.1-thinking",
        base_url=os.environ["GROK_SEARCH_BASE_URL"],
        api_key=os.environ["GROK_SEARCH_API_KEY"],
        default_headers={"User-Agent": user_agent},
    )
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
        chain = (
            extracted_page_content_from_user_content_prompt_template | grok_search_model
        )
        for i, ppt_outline_page in enumerate(ppt_outline_pages):
            ppt_part_page_contents_task.append(
                extract_page_content_task_with_delay(
                    chain, state, ppt_outline_page, i, delay=0.0
                )
            )
        ppt_part_page_contents: list[dict] = await asyncio.gather(
            *ppt_part_page_contents_task
        )

    else:
        chain = grok_search_ppt_content_per_page_prompt_template | grok_search_model
        for i, ppt_outline_page in enumerate(ppt_outline_pages):
            ppt_part_page_contents_task.append(
                search_page_content_task_with_delay(
                    chain, state, ppt_outline_page, i, delay=0.0
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
    with open(
        f"user_data/{thread_id}/ppt_page_contents.json", "w", encoding="utf-8"
    ) as f:
        json.dump(ppt_page_contents, f, ensure_ascii=False, indent=2)
    return {
        "ppt_page_contents": ppt_page_contents,
    }


# node
async def generate_first_draft(state: State, runtime: Runtime, config: RunnableConfig):
    thread_id = config["configurable"].get("thread_id")
    # 封面结尾页的生成
    # prompt = PromptTemplate.from_template(prompt_template, template_format="mustache")

    generate_first_draft_model = ChatOpenAI(
        model=os.getenv("GEMINI_MODEL") or "gemini-3-flash-preview",
        base_url=os.getenv("GEMINI_BASE_URL"),
        api_key=os.getenv("GEMINI_API_KEY"),
    )
    content_page_chain = (
        ppt_first_draft_grid_style_prompt_template | generate_first_draft_model
    )
    cover_page_chain = (
        ppt_first_draft_guide_page_prompt_template | generate_first_draft_model
    )
    ppt_page_contents = state.ppt_page_contents

    tasks = []
    for i, ppt_page_content in enumerate(ppt_page_contents):
        page_content = ppt_page_content.get("content")
        if ppt_page_content["type"] == "part_page":
            chain = content_page_chain
        else:
            chain = cover_page_chain
        tasks.append(
            generate_first_draft_task_with_delay(
                chain, page_content, thread_id, i, delay=0.0
            )
        )
    first_draft_results = await asyncio.gather(*tasks)

    with open(
        f"user_data/{thread_id}/first_draft_results.json", "w", encoding="utf-8"
    ) as f:
        json.dump(first_draft_results, f, ensure_ascii=False, indent=2)
    return {
        "first_draft_results": first_draft_results,
    }


def inquire_style(state: State, runtime: Runtime, config: RunnableConfig):
    thread_id = config["configurable"].get("thread_id")
    # 使用中断来让给用户确定PPT的风格
    user_ppt_style = interrupt(
        {
            "title": "请输入你想要的PPT的整体风格(包含颜色+风格)，例如绿色简约风，黑色科技风等",
            "type": InterruptType.INPUT,
        }
    )
    return {
        "user_ppt_style": user_ppt_style,
    }


# node
async def generate_final_ppt(state: State, runtime: Runtime, config: RunnableConfig):
    """根据用户最终的PPT风格以及生成的初稿来生成终稿"""
    thread_id = config["configurable"].get("thread_id")
    generate_final_ppt_model = ChatOpenAI(
        model=os.getenv("GEMINI_MODEL") or "gemini-3-flash-preview",
        base_url=os.getenv("GEMINI_BASE_URL"),
        api_key=os.getenv("GEMINI_API_KEY"),
    )
    chain = ppt_final_draft_prompt_template | generate_final_ppt_model
    first_draft_results = state.first_draft_results
    final_ppt_results = []
    final_ppt_generate_tasks = []

    for index, first_draft_result in enumerate(first_draft_results):
        final_ppt_generate_tasks.append(
            generate_final_ppt_task_with_delay(
                chain,
                first_draft_result,
                state.user_ppt_style,
                thread_id,
                index,
                delay=0.0,
            )
        )
    final_ppt_results = await asyncio.gather(*final_ppt_generate_tasks)
    with open(
        f"user_data/{thread_id}/final_ppt_results.json", "w", encoding="utf-8"
    ) as f:
        json.dump(final_ppt_results, f, ensure_ascii=False, indent=2)
    return {"final_ppt_results": final_ppt_results}


def start_workflow(input: InputSchema, thread_id: str):
    config = RunnableConfig(configurable={"thread_id": thread_id})
    response = agent.invoke(input, config=config)
    return response


def resume_workflow(thread_id: str, user_input: Any):
    config = RunnableConfig(configurable={"thread_id": thread_id})
    response = agent.invoke(Command(resume=user_input), config=config)
    return response


def get_status(thread_id: str):
    config = RunnableConfig(configurable={"thread_id": thread_id})
    current_state = agent.get_state(config)
    return current_state.values.get("current_timeline", TimeLine.NO_START)


graph = StateGraph(state_schema=State, input_schema=InputSchema)
graph.add_node("ask_for_ppt_info", ask_for_ppt_info)
graph.add_node("search_ppt_contents", search_ppt_contents)
graph.add_node("parser_ppt_content_files", parser_ppt_content_files)
graph.add_node("parser_ppt_content_urls", parser_ppt_content_urls)
graph.add_node("parser_ppt_template", parser_ppt_template)
graph.add_node("generate_ppt_outline", generate_ppt_outline)
graph.add_node("generate_ppt_content_per_page", generate_ppt_content_per_page)
graph.add_node("generate_first_draft", generate_first_draft)
graph.add_node("inquire_style", inquire_style)
graph.add_node("generate_final_ppt", generate_final_ppt)
graph.add_edge(START, "ask_for_ppt_info")
graph.add_conditional_edges(
    "ask_for_ppt_info",
    route_via_ppt_content_files,
    {
        "parser": "parser_ppt_content_files",
        "search": "search_ppt_contents",
    },
)
graph.add_edge("parser_ppt_content_files", "parser_ppt_content_urls")

graph.add_edge("search_ppt_contents", "parser_ppt_template")
graph.add_edge("parser_ppt_content_urls", "parser_ppt_template")
graph.add_edge("parser_ppt_template", "generate_ppt_outline")
graph.add_edge("generate_ppt_outline", "generate_ppt_content_per_page")
graph.add_edge("generate_ppt_content_per_page", "generate_first_draft")
graph.add_edge("generate_first_draft", "inquire_style")
graph.add_edge("inquire_style", "generate_final_ppt")
graph.add_edge("generate_final_ppt", END)

agent = graph.compile(checkpointer=InMemorySaver())


if __name__ == "__main__":
    # config: RunnableConfig = {"configurable": {"thread_id": "1"}}
    # response = agent.invoke({"theme": "AI在企业运营中的落地实践"}, config=config)
    # print(response)

    # while response["__interrupt__"]:
    # if response["__interrupt__"]:
    # user_input = {
    #     "target_audience": "企业管理者",
    #     "user_role": "产品经理",
    #     "purpose": "汇报",
    #     "style": "商务风",
    #     "num_pages": 80,
    # }

    # response = agent.invoke(Command(resume=user_input), config=config)
    # print(response)
    async def main():
        save_graph = True
        graph_name = "ppt_generation_agent_graph.png"
        if save_graph:
            graph_png = agent.get_graph(xray=True).draw_mermaid_png()
            save_path = Path(graph_name)
            save_path.write_bytes(graph_png)
            print(f"Graph image saved to: {save_path}")

        """"
        test search_ppt_contents
        """
        config: RunnableConfig = {"configurable": {"thread_id": "zwc_test"}}

        origin_state = State(
            ppt_info=PPTInfo(
                target_audience="导师以及同学",
                user_role="学生",
                purpose="汇报",
                style="学术风",
                num_pages=10,
                theme="DeekSeek R1的介绍",
            ),
            messages=[],
            ppt_template_path="user_data/zwc_test/template/template.pdf",
            current_timeline=TimeLine.INFO_GATHERED,
            have_ppt_content_files=True,
            ppt_content_source_urls=["https://ghostty.org/docs/install/binary"],
            ppt_content_files_markdown_contents=ppt_content_files_markdown_contents,
            have_ppt_template=False,
            web_fetch_results=web_fetch_results,
            ppt_outline=ppt_outline,
            user_content=user_content,
            ppt_page_contents=ppt_page_contents,
            first_draft_results=first_draft_results,
            user_ppt_style="绿色简约风",
        )
        fork_config = agent.update_state(
            config, origin_state, as_node="ask_for_ppt_info"
        )
        response = await agent.ainvoke(None, config=fork_config)
        # if response["__interrupt__"]:
        #     # print("Workflow is interrupted, waiting for user input...")
        #     response = agent.invoke(Command(resume="绿色简约风"), config=config)
        # # response = await agent.ainvoke()
        print(response)

    asyncio.run(main())
