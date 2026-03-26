import os
from pathlib import Path
from typing import Annotated, Literal, Optional, Any

from dotenv import load_dotenv
from langchain.messages import AnyMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

# from gohumanloop.adapters.langgraph_adapter import interrupt, create_resume_command
from langchain_core.runnables import RunnableConfig

from langgraph.graph.state import Command
from langgraph.types import Command, interrupt
from langgraph.checkpoint.memory import InMemorySaver
from enum import Enum
from langgraph.runtime import Runtime

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


class State(BaseModel):
    ppt_info: PPTInfo | None
    messages: Annotated[list[AnyMessage], add_messages]
    ppt_template: str | None = Field(
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
    }



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


graph = StateGraph(state_schema=State, input_schema=InputSchema)
graph.add_node("ask_for_ppt_info", ask_for_ppt_info)
graph.add_edge(START, "ask_for_ppt_info")
graph.add_edge("ask_for_ppt_info", END)


agent = graph.compile(checkpointer=InMemorySaver())

if __name__ == "__main__":
    config: RunnableConfig = {"configurable": {"thread_id": "1"}}
    response = agent.invoke({"theme": "AI在企业运营中的落地实践"}, config=config)
    print(response)
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
