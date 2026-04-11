import asyncio
import json
import logging
import operator
import os
import re
from pathlib import Path
from typing import (
    Annotated,
    Any,
    Literal,
    Optional,
    TypedDict,
    Union,
    get_args,
    get_origin,
)

import json_repair
from build_model import build_model
from cache_key_func import (
    generate_final_ppt_task_key_func,
    generate_first_draft_task_key_func,
)
from constant import USER_DATA_ROOT_DIR, InterruptType, LayoutType
from dotenv import load_dotenv
from extractors import ExtractorFactory
from langchain.messages import AnyMessage
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.cache.sqlite import SqliteCache
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import Command
from langgraph.runtime import Runtime
from langgraph.types import CachePolicy, Command, RetryPolicy, Send, interrupt
from mineru_parser_batch import MinerUBatchClient
from prompt import (
    extract_ppt_info_prompt_template,
    extracted_page_content_from_user_content_prompt_template,
    grok_search_ppt_content_per_page_prompt_template,
    grok_search_prompt_template,
    ppt_final_draft_prompt_template,
    ppt_first_draft_grid_style_prompt_template,
    ppt_first_draft_guide_page_prompt_template,
    ppt_first_draft_Top_Bottom_style_prompt_template,
    ppt_outline_prompt_template,
)
from pydantic import BaseModel, Field
from task import (
    extract_page_content_task_with_delay,
    generate_final_ppt_task_with_delay,
    generate_first_draft_task_with_delay,
    search_page_content_task_with_delay,
)
from task_node import (
    FinalPPTTaskState,
    FirstDraftTaskState,
    generate_final_ppt_task,
    generate_first_draft_task,
)
from temp import (
    first_draft_results,
    ppt_content_files_markdown_contents,
    ppt_outline,
    ppt_page_contents,
    user_content,
    web_fetch_results,
)
from utils import (
    extract_svg_from_response,
    is_development,
    ppt2svg,
    setup_logging,
    verify_svg,
)

load_dotenv()
setup_logging()
logger = logging.getLogger(__file__)

model_info = build_model()
search_model = model_info["search_model"]
generate_model = model_info["generate_model"]
intent_recognition_model = model_info["intent_recognition_model"]


class PPTInfo(BaseModel):
    target_audience: Optional[str] = Field(description="PPT的目标群体")
    user_role: Optional[str] = Field(
        description="用户的角色，例如软件工程师、学生、产品经理"
    )
    # purpose: Optional[str] = Field(description="PPT的目的，例如汇报、演讲、培训")
    num_pages: Optional[int] = Field(description="PPT的页数,1—30页", gt=0, le=30)
    theme: Optional[str] = Field(
        description="PPT的主题，例如'dify的介绍', '人工智能的发展趋势', '如何提升工作效率'等"
    )
    layout_style: Optional[LayoutType] = Field(
        default=LayoutType.TOP_BOTTOM,
        description=f"PPT的布局风格,可选的有{[t.value for t in LayoutType]}",
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
        default=None, description="PPT模板的文件路径，例如template/template.pdf"
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
    first_draft_results: Annotated[list[dict] | None, operator.add] = Field(
        default=None,
        description="初稿的内容，包含每一页的svg内容、保存的文件路径、以及对应的页码",
    )
    user_ppt_style: str | None = Field(
        default=None,
        description="用户需要的最终的PPT风格，例如绿色简约风，黑色科技风等",
    )
    final_ppt_results: Annotated[list[dict] | None, operator.add] = Field(
        default=None,
        description="根据初稿和用户所需的ppt的风格生成的最终的ppt,包含每一页的svg内容、保存的文件路径、以及对应的页码",
    )


class InputSchema(BaseModel):
    ppt_requirement: str = Field(description="用户的ppt的请求")


def get_core_type(field_name: str, model_class):
    field_annotation = model_class.model_fields[field_name].annotation

    # 检查是否为 Union (Optional 就是一种 Union)
    if get_origin(field_annotation) is Union:
        # 获取 Union 内部的所有类型，例如 (int, <class 'NoneType'>)
        args = get_args(field_annotation)
        # 过滤掉 NoneType，拿到真实的业务类型
        core_types = [arg for arg in args if arg is not type(None)]
        return core_types[0] if core_types else field_annotation

    return field_annotation


# node
def ask_for_ppt_info(
    input: InputSchema, runtime: Runtime, config: RunnableConfig
) -> dict:
    writer = get_stream_writer()
    writer({"current_stage": "正在确认PPT的具体需求"})
    thread_id = config["configurable"].get("thread_id")
    json_parser = JsonOutputParser()
    chain = extract_ppt_info_prompt_template | intent_recognition_model | json_parser

    ppt_info = chain.invoke({"user_input": input.ppt_requirement})

    # 前端让用户进行编辑，前端需要保证所有的信息不为None
    ppt_info = interrupt(
        {"title": "ppt的相关信息", "type": InterruptType.EDIT, "values": ppt_info}
    )
    ppt_content_source_from_user = interrupt(
        {
            "title": "你可以上传PPT内容相关的文件或者网站,如果没有可以直接跳过",
            "type": InterruptType.UPLOAD_PPT_CONTENT_FILES,
            "file_type": ["pdf", "docx", "markdown", "md"],
        }
    )
    # ppt_content_source_urls:list[str]
    # TODO: 验证url是否正确
    have_ppt_content_files, ppt_content_source_urls = (
        ppt_content_source_from_user["have_ppt_content_files"],
        ppt_content_source_from_user.get("ppt_content_source_urls", None),
    )

    ppt_template_info = interrupt(
        {
            "title": "你可以上传一个PPT模板文件，如果没有可以直接跳过",
            "type": InterruptType.UPLOAD_PPT_TEMPLATE,
            "file_type": ["pptx", "pdf"],
        }
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

    chain = grok_search_prompt_template | search_model
    # 使用grok的搜索能力来搜索ppt的内容
    search_response = chain.with_retry().invoke(
        {
            "theme": ppt_info.theme,
            "target_audience": ppt_info.target_audience,
            "user_role": ppt_info.user_role,
        },
    )
    json_parser = JsonOutputParser()
    grok_search_results = json_parser.parse(
        json_repair.repair_json(search_response.content)
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
                    chain, state, ppt_outline_page, i, delay=0.0
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
        f"{USER_DATA_ROOT_DIR}/{thread_id}/ppt_page_contents.json",
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(ppt_page_contents, f, ensure_ascii=False, indent=2)
    writer({"current_stage": "正在生成PPT的初稿"})
    return {
        "ppt_page_contents": ppt_page_contents,
    }


# 条件边
def assign_generate_first_draft_task(state: State):
    ppt_page_contents = state.ppt_page_contents or []
    layout_style = state.ppt_info.layout_style or LayoutType.GRID

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
                "delay": 0.0,
            },
        )
        for i, ppt_page_content in enumerate(ppt_page_contents)
    ]


# node
def ask_for_style(state: State, runtime: Runtime, config: RunnableConfig):
    writer = get_stream_writer()
    writer({"current_stage": "正在确认需要的PPT风格"})
    # 使用中断来让给用户确定PPT的风格
    user_ppt_style = interrupt(
        {
            "title": "请输入你想要的PPT的整体风格(包含颜色+风格)，例如绿色简约风，黑色科技风等",
            "type": InterruptType.INPUT,
        }
    )
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
                "delay": 0.0,
            },
        )
        for i, first_draft_result in enumerate(first_draft_results)
    ]


async def start_workflow(input: InputSchema, thread_id: str):
    async with AsyncSqliteSaver.from_conn_string("checkpoint.db") as checkpointer:
        agent = graph.compile(checkpointer=checkpointer)
    config = RunnableConfig(configurable={"thread_id": thread_id})
    response = await agent.ainvoke(input, config=config)
    return response


async def resume_workflow(thread_id: str, user_input: Any):
    async with AsyncSqliteSaver.from_conn_string("checkpoint.db") as checkpointer:
        agent = graph.compile(checkpointer=checkpointer)
    config = RunnableConfig(configurable={"thread_id": thread_id})
    response = await agent.ainvoke(Command(resume=user_input), config=config)
    return response


graph = StateGraph(state_schema=State, input_schema=InputSchema)
graph.add_node("ask_for_ppt_info", ask_for_ppt_info)
graph.add_node("search_ppt_contents", search_ppt_contents)
graph.add_node("parse_ppt_content_files", parse_ppt_content_files)
graph.add_node("parse_ppt_content_urls", parse_ppt_content_urls)
# 该节点延迟执行
graph.add_node("parse_ppt_template", parse_ppt_template, defer=True)
graph.add_node("generate_ppt_outline", generate_ppt_outline)
graph.add_node(
    "generate_ppt_content_per_page",
    generate_ppt_content_per_page,
)
graph.add_node(
    "generate_first_draft_task",
    generate_first_draft_task,
    retry_policy=RetryPolicy(),
    cache_policy=CachePolicy(
        key_func=generate_first_draft_task_key_func,
        ttl=None if is_development() else 3600 * 24,
    ),
)
graph.add_node("ask_for_style", ask_for_style)
graph.add_node(
    "generate_final_ppt_task",
    generate_final_ppt_task,
    retry_policy=RetryPolicy(),
    cache_policy=CachePolicy(
        key_func=generate_final_ppt_task_key_func,
        ttl=None if is_development() else 3600 * 24,
    ),
)
graph.add_edge(START, "ask_for_ppt_info")
graph.add_conditional_edges(
    "ask_for_ppt_info",
    route_via_ppt_content_files,
    {
        "parser": "parse_ppt_content_files",
        "search": "search_ppt_contents",
    },
)
graph.add_edge("parse_ppt_content_files", "parse_ppt_content_urls")

graph.add_edge("search_ppt_contents", "parse_ppt_template")
graph.add_edge("parse_ppt_content_urls", "parse_ppt_template")
graph.add_edge("parse_ppt_template", "generate_ppt_outline")
graph.add_edge("generate_ppt_outline", "generate_ppt_content_per_page")
graph.add_conditional_edges(
    "generate_ppt_content_per_page",
    assign_generate_first_draft_task,
    ["generate_first_draft_task"],
)


graph.add_edge("generate_first_draft_task", "ask_for_style")
graph.add_conditional_edges(
    "ask_for_style",
    assign_generate_final_ppt_task,
    ["generate_final_ppt_task"],
)
graph.add_edge("generate_final_ppt_task", END)


if __name__ == "__main__":
    # while response["__interrupt__"]:
    # if response["__interrupt__"]:
    # user_input = {
    #     "target_audience": "企业管理者",
    #     "user_role": "产品经理",
    #     "purpose": "汇报",
    #     "style": "商务风",
    #     "num_pages": 80,
    # }
    async def resume_when_abort(thread_id: str):
        async with AsyncSqliteSaver.from_conn_string("checkpoint.db") as checkpointer:
            agent = graph.compile(checkpointer=checkpointer)
            config = RunnableConfig(configurable={"thread_id": thread_id})
            # state_history = await agent.aget_state(config)
            state_history = agent.aget_state_history(config)
            # async for state in state_history:
            # current_timeline = state.values.get("current_timeline", TimeLine.NO_START)
            # print(f"当前timeline: {current_timeline}")
            # print(f"当前state: {state}")
            response = await agent.ainvoke(None, config, durability="sync")
            # response = await agent.ainvoke(Command(resume=user_input), config=config)
            return response

    async def main():
        # async with AsyncSqliteSaver.from_conn_string("checkpoint.db") as checkpointer:
        checkpointer = (
            InMemorySaver()
            if is_development()
            else AsyncSqliteSaver.from_conn_string("checkpoint.db")
        )
        agent = graph.compile(
            checkpointer=checkpointer, cache=SqliteCache(path="cache.db")
        )
        save_graph = True
        graph_name = "ppt_generation_agent_graph.png"
        if save_graph:
            graph_png = agent.get_graph(xray=True).draw_mermaid_png()
            save_path = Path(graph_name)
            save_path.write_bytes(graph_png)
            print(f"Graph image saved to: {save_path}")
        # config: RunnableConfig = {"configurable": {"thread_id": "1"}}
        # response = agent.invoke({"theme": "AI在企业运营中的落地实践"}, config=config)
        # print(response)
        """"
            test search_ppt_contents
            """
        config: RunnableConfig = {"configurable": {"thread_id": "zwc_test"}}
        # response = await resume_when_abort("zwc_test")
        # response = agent.invoke(
        #     InputSchema(
        #         ppt_requirement="我是一个学生，我想给导师做一个有关deepseek的论文的汇报,排版使用上下结构的"
        #     ),
        #     config=config,
        # )
        # response = await agent.ainvoke(
        #     Command(
        #         resume={
        #             "target_audience": "导师以及同学",
        #             "user_role": "学生",
        #             "layout_style": "top_bottom",
        #             "num_pages": 10,
        #             "theme": "DeekSeek R1的介绍",
        #         }
        #     ),
        #     config=config,
        # )
        # print(response)

        origin_state = State(
            ppt_info=PPTInfo(
                target_audience="导师以及同学",
                user_role="学生",
                # purpose="汇报",
                layout_style=LayoutType.TOP_BOTTOM,
                num_pages=10,
                theme="DeekSeek R1的介绍",
            ),
            messages=[],
            ppt_template_path="user_data/zwc_test/template/template.pdf",
            # current_timeline=TimeLine.INFO_GATHERED,
            have_ppt_content_files=False,
            # ppt_content_source_urls=["https://ghostty.org/docs/install/binary"],
            # ppt_content_files_markdown_contents=ppt_content_files_markdown_contents,
            have_ppt_template=False,
            web_fetch_results=web_fetch_results,
            ppt_outline=ppt_outline,
            user_content=user_content,
            ppt_page_contents=ppt_page_contents,
            first_draft_results=first_draft_results,
            user_ppt_style="绿色简约风",
        )
        fork_config = await agent.aupdate_state(
            config, origin_state, as_node="ask_for_style"
        )
        response = await agent.ainvoke(None, config=fork_config, durability="sync")
        print(response)

        # async for chunk in agent.astream(
        #     None,
        #     config=fork_config,
        #     durability="sync",
        #     stream_mode=["custom"],
        #     version="v2",
        # ):
        #     # passp
        #     print(chunk)
        # if response["__interrupt__"]:
        #     # print("Workflow is interrupted, waiting for user input...")
        #     response = agent.ainvoke(Command(resume="绿色简约风"), config=fork_config)
        # response = await agent.ainvoke()

    asyncio.run(main())
