import json
import os
from enum import Enum
from pathlib import Path
from typing import Annotated, Any, Literal, Optional
from utils import extract_via_travily
import json_repair
from dotenv import load_dotenv
from langchain.messages import AnyMessage
from langchain_core.messages import HumanMessage
from langchain_core.output_parsers import JsonOutputParser

# from gohumanloop.adapters.langgraph_adapter import interrupt, create_resume_command
from langchain_core.runnables import RunnableConfig
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import Command
from langgraph.runtime import Runtime
from langgraph.types import Command, RetryPolicy, interrupt
from prompt import grok_search_prompt_template
from pydantic import BaseModel, Field
from tavily import TavilyClient

load_dotenv()


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


# class Grok_Search_Result(BaseModel):

#     title: str = Field(description="结果的标题")
#     description: str = Field(description="20-50字的结果描述")
#     url: str = Field(description="有效的访问链接")


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
    have_ppt_template: bool = Field(
        default=False,
        description="用户是否有PPT模板,如果有则使用用户的模板",
    )
    grok_search_results: list[dict] | None = Field(
        default=None,
        description="根据用户的ppt需求使用grok来搜索相关的页面，list的每一项包含title, description, url字段",
    )
    tavily_claw_results: list[dict] | None = Field(
        default=None,
        description="根据grok_search_results的搜索到的urls,通过tavily来抓取对应的页面的内容转为markdown的格式,list的每一项包含url, title, raw_content,images字段",
    )


class InputSchema(BaseModel):
    theme: str = Field(
        description="PPT的主题，例如'dify的介绍', '人工智能的发展趋势', '如何提升工作效率'等"
    )




def ask_for_ppt_info(input: InputSchema, runtime: Runtime) -> dict:
    # PPT的相关信息
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

    have_ppt_content_files = interrupt(
        {
            "title": "你可以上传PPT内容相关的文件,如果没有可以直接跳过",
            "type": InterruptType.UPLOAD_PPT_CONTENT_FILES,
            "file_type": ["pdf", "docx", "markdown"],
        }
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
        # TODO:设置一下ppt_template_path
        # "ppt_template_path": None,
    }


def search_ppt_contents(state: State, runtime: Runtime, config: RunnableConfig):
    # 根据用户输入的ppt信息来搜索相关内容
    thread_id = config["configurable"].get("thread_id")
    ppt_info: PPTInfo = state.ppt_info
    user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

    grok_search_model = ChatOpenAI(
        model="grok-4.20-beta",
        base_url=os.environ["GROK_SEARCH_BASE_URL"],
        api_key=os.environ["GROK_SEARCH_API_KEY"],
        default_headers={"User-Agent": user_agent},
    )

    # chain = grok_search_prompt_template | grok_search_model
    # structured_grok_search_model = grok_search_model.with_structured_output(
    #     Grok_Search_Result
    # )
    chain = grok_search_prompt_template | grok_search_model
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
    urls = [result.get("url") for result in grok_search_results if result.get("url") is not None]
    tavily_claw_results = extract_via_travily(urls)
    return {
        "grok_search_results": grok_search_results,
        "tavily_claw_results":tavily_claw_results
    }


def parser_ppt_content_files(state: State, runtime: Runtime):
    # 解析用户上传的内容文件来获取相关内容
    pass


def parser_ppt_template(
    state: State,
    runtime: Runtime,
):
    # 解析用户上传的PPT模板文件来获取模板信息
    pass


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

    # while True:
    #     new_required = {}
    #     if target_audience is None:
    #         new_required["target_audience"] = "PPT的目标群体"
    #     if user_role is None:
    #         new_required["user_role"] = "用户的角色，例如软件工程师、学生、产品经理"
    #     if purpose is None:
    #         new_required["purpose"] = "PPT的目的，例如汇报、演讲、培训"
    #     if style is None:
    #         new_required["style"] = "PPT的风格，例如商务风、简约风、科技风"
    #     if num_pages is None or not (1 <= num_pages <= 30):
    #         new_required["num_pages"] = "PPT的页数,1—30页"
    #     new_user_input = interrupt(
    #         {
    #             "title": "请你输入以下信息来帮助我更好地理解你的需求：",
    #             "required_data": new_required,
    #         }
    #     )


# graph = StateGraph(state_schema=State, input_schema=InputSchema)
# graph.add_node("ask_for_ppt_info", ask_for_ppt_info)
# graph.add_edge(START, "ask_for_ppt_info")
# graph.add_edge("ask_for_ppt_info", END)

""""
test search_ppt_contents node
"""
graph = StateGraph(state_schema=State)
graph.add_node(
    "search_ppt_contents", search_ppt_contents)
)
graph.add_edge(START, "search_ppt_contents")
graph.add_edge("search_ppt_contents", END)


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

    """"
    test search_ppt_contents
    """
    config: RunnableConfig = {"configurable": {"thread_id": "zwc_test"}}
    origin_state = State(
        ppt_info=PPTInfo(
            target_audience="企业管理者",
            user_role="产品经理",
            purpose="汇报",
            style="科技风",
            num_pages=20,
            theme="dify的介绍",
        ),
        messages=[],
        ppt_template_path="user_data/zwc_test/template/template.pdf",
        current_timeline=TimeLine.INFO_GATHERED,
        have_ppt_content_files=False,
        have_ppt_template=True,
    )
    response = agent.invoke(origin_state, config=config)
