import operator
from typing import Annotated

from langchain.messages import AnyMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

from agent.types import PPTInfo

# class PPTContentPerPage(TypedDict):
#     type: Literal["cover", "table_of_contents", "part_cover", "part_page", "end_page"]
#     content: Annotated[
#         str,
#         "这一页PPT的内容",
#     ]

#     speaker_notes: Annotated[str, "这一页PPT的演讲者备注"]
#     num_part: Optional[int]


class State(BaseModel):
    messages: Annotated[list[AnyMessage], add_messages]
    ppt_info: PPTInfo | None = Field(default=None, description="用户的PPT需求信息")
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
