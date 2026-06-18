import logging
import os
import re
from pathlib import Path
from typing import Annotated, Literal, TypedDict

from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain.messages import ToolMessage
from langchain.tools import tool
from langchain_core.messages import AnyMessage
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate, PromptTemplate
from langchain_core.runnables import RunnableConfig, RunnableLambda
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import Command
from src.ppt_agent.prompt import modify_ppt_prompt_template
from src.ppt_agent.utils import verify_svg
from src.ppt_agent.config import get_config

load_dotenv()

logger = logging.getLogger(__name__)


def extract_svg_from_response(response) -> str:
    svg_match = re.search(r"<svg\b[^>]*>[\s\S]*?<\/svg>", response.content)
    if svg_match:
        svg_content = svg_match.group(0)
    else:
        raise ValueError(
            f"在LLM的返回中没有找到<svg>标签来包裹的内容，请确保LLM按照要求输出，并且输出的内容包含一个合法的SVG字符串。LLM的原始输出是: {response.content}"
        )
    return svg_content


@tool("modify_ppt", return_direct=True)
def modify_ppt(
    thread_id: str,
    ppt_type: Literal["初稿", "终稿"],
    ppt_page: int,
    user_instruction: str,
) -> dict:
    """
    根据用户的修改指令，对指定页码的PPT内容进行修改，并返回修改后的内容
    :param thread_id: 当前对话线程的唯一标识
    :param ppt_page: 用户需要修改的PPT页码,eg.1,2,3
    :param user_instruction: 用户的修改指令，描述需要对该页PPT进行哪些修改
    """
    config = get_config()
    llm = init_chat_model(**config["generate_model_config"])
    chain = (
        modify_ppt_prompt_template
        | llm
        | RunnableLambda(extract_svg_from_response)
        | RunnableLambda(verify_svg)
    )
    if ppt_type == "初稿":
        ppt_page_path = Path(
            f"user_data/{thread_id}/first_draft/page_{int(ppt_page)}.svg"
        )
    elif ppt_type == "终稿":
        ppt_page_path = Path(
            f"user_data/{thread_id}/final_ppt/page_{int(ppt_page)}.svg"
        )
    else:
        raise ValueError("ppt_type must be either '初稿' or '终稿'")
    with open(ppt_page_path, "r", encoding="utf-8") as f:
        previous_svg_code = f.read()

    svg_content = chain.with_retry().invoke(
        {
            "previous_svg_code": previous_svg_code,
            "user_instruction": user_instruction,
        }
    )
    with open(ppt_page_path, "w", encoding="utf-8") as f:
        logger.info(
            f"用户{thread_id}的{ppt_type}第{ppt_page}页PPT已修改,保存至 {ppt_page_path}"
        )
        f.write(svg_content)
    return {"page": ppt_page, "new_svg_content": svg_content}


tools = [modify_ppt]


class NewSvgObj(TypedDict):
    page: int
    new_svg_content: str


class State(TypedDict):
    thread_id: str
    ppt_type: Literal["初稿", "终稿"]
    user_instruction: str
    is_modify_ppt_intent: bool
    messages: Annotated[list[AnyMessage], add_messages]


class OutputSchema(TypedDict):
    response_content: str
    new_svg_list: list[NewSvgObj]


# node
def recognite_intent(state: State):
    """
    意图识别
    """
    intent_prompt = PromptTemplate.from_template(
        template_format="mustache",
        template="""你是一个意图识别助手，我会给你一段用户的指令，你需要判断用户的指令是否是修改PPT的意图.
## 输出格式
    {
      "is_modify_ppt_intent": true/false # 你需要判断用户的指令是否是修改PPT的指令
    }
## 用户输入的指令
{{user_instruction}}    
""",
    )

    recognite_intent_llm = ChatOpenAI(
        model=os.getenv("GEMINI_MODEL") or "gemini-3-flash-preview",
        base_url=os.getenv("GEMINI_BASE_URL"),
        api_key=os.getenv("GEMINI_API_KEY"),
    )
    chain = intent_prompt | recognite_intent_llm | JsonOutputParser()
    response = chain.with_retry().invoke(
        {"user_instruction": state["user_instruction"]}
    )
    logger.info(
        f"用户的意图{'是' if response['is_modify_ppt_intent'] else '不是'}修改PPT的意图"
    )
    return {"is_modify_ppt_intent": response["is_modify_ppt_intent"]}


# node-router
def route_via_intent(state: State) -> Command[Literal["main_assistant", END]]:
    if state["is_modify_ppt_intent"]:
        return Command(goto="main_assistant")
    else:
        return Command(goto=END, update={"response_content": "我只能帮您修改PPT"})


# node
def main_assistant(state: State):
    """ "ppt_mofidy"""
    system_prompt = """你是一个PPT修改助手,你需要调用`modify_ppt`工具来根据用户的修改PPT的指令，对指定页码的PPT内容进行修改，并返回修改后的内容。
"""
    user_prompt = """
# 用户的相关信息
- thread_id: {{thread_id}}
- ppt_type: {{ppt_type}}
## 用户的修改指令
{{user_instruction}}   
"""
    llm = ChatOpenAI(
        model=os.getenv("GEMINI_MODEL") or "gemini-3-flash-preview",
        base_url=os.getenv("GEMINI_BASE_URL"),
        api_key=os.getenv("GEMINI_API_KEY"),
    )
    llm_with_tools = llm.bind_tools(tools)
    prompt_template = ChatPromptTemplate.from_messages(
        messages=[
            ("system", system_prompt),
            ("human", user_prompt),
        ],
        template_format="mustache",
    )
    chain = prompt_template | llm_with_tools
    response = chain.invoke(
        {
            "thread_id": state["thread_id"],
            "ppt_type": state["ppt_type"],
            "user_instruction": state["user_instruction"],
        }
    )
    return {"messages": response}


# node
tool_node = ToolNode(tools)


# ndoe
def post_process(state: State):
    tool_results = [
        message for message in state["messages"] if isinstance(message, ToolMessage)
    ]
    json_parser = JsonOutputParser()
    response_content = ""
    new_svg_list = []
    for tool_result in tool_results:
        if tool_result.name == "modify_ppt":
            if tool_result.status == "success":
                result = json_parser.parse(tool_result.content)
                page, new_svg_content = result["page"], result["new_svg_content"]
                new_svg_obj = NewSvgObj(page=page, new_svg_content=new_svg_content)
                new_svg_list.append(new_svg_obj)
                response_content += f"第{page}页的{state['ppt_type']}修改成功."
            else:
                response_content += f"第{page}页的{state['ppt_type']}修改失败，失败原因是{tool_result.content}"
    return {"response_content": response_content, "new_svg_list": new_svg_list}


graph = StateGraph(state_schema=State, output_schema=OutputSchema)

graph.add_node(
    "recognite_intent",
    recognite_intent,
)
graph.add_node("route_via_intent", route_via_intent)
graph.add_node(
    "main_assistant",
    main_assistant,
)
graph.add_node("tools", tool_node)
graph.add_node("post_process", post_process)


graph.add_edge(START, "recognite_intent")
graph.add_edge("recognite_intent", "route_via_intent")
graph.add_conditional_edges("main_assistant", tools_condition)
graph.add_edge("tools", "post_process")
graph.add_edge("post_process", END)

modify_ppt_agent = graph.compile(checkpointer=InMemorySaver(), name="modify_ppt_agent")

if __name__ == "__main__":
    graph_name = "modify_ppt_agent_graph.png"
    graph_png = modify_ppt_agent.get_graph(xray=True).draw_mermaid_png()
    save_path = Path(graph_name)
    save_path.write_bytes(graph_png)
    print(f"Graph image saved to: {save_path}")

    config: RunnableConfig = {"configurable": {"thread_id": "111"}}
    fork_config = modify_ppt_agent.update_state(
        config,
        values={
            "user_instruction": "第三页的背景修改为蓝色",
            "thread_id": "zwc_test",
            "ppt_type": "终稿",
            "is_modify_ppt_intent": True,
        },
        as_node="recognite_intent",
    )
    response = modify_ppt_agent.invoke(None, config=fork_config)
    print(response)
