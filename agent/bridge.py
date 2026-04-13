"""桥接后端和agent的中间层"""

import asyncio
from dataclasses import dataclass
from typing import AsyncIterator, Literal

from fastapi.sse import ServerSentEvent
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, Interrupt

from agent.ppt_agent import PPTAgent
from agent.state import InputSchema, State
from agent.temp import (
    first_draft_results,
    ppt_content_files_markdown_contents,
    ppt_outline,
    ppt_page_contents,
    user_content,
    web_fetch_results,
)
from agent.types import PPTInfo


@dataclass
class ResponseSchema:
    type: Literal["interrupts", "current_stage"]
    data: tuple[Interrupt] | str


async def start_ppt_agent(
    agent: CompiledStateGraph[State, None, InputSchema],
    ppt_requirement: str,
    thread_id: str,
) -> AsyncIterator[ServerSentEvent]:

    config: RunnableConfig = {"configurable": {"thread_id": thread_id}}
    async for chunk in agent.astream(
        InputSchema(ppt_requirement=ppt_requirement),
        config=config,
        durability="sync",
        stream_mode=["custom", "values", "updates"],
        version="v2",
    ):
        if chunk["type"] == "values" and len(chunk["interrupts"]) > 0:
            data = {"type": "interrupts", "data": chunk["interrupts"]}
            yield ServerSentEvent(data=data, event="interrupts")

        if chunk["type"] == "custom" and "current_stage" in chunk["data"]:
            data = {"type": "current_stage", "data": chunk["data"]["current_stage"]}

            yield ServerSentEvent(data=data, event="current_stage")

        # 初稿
        if chunk["type"] == "updates" and "generate_first_draft_task" in chunk["data"]:
            data = {
                "first_draft_results": chunk["data"]["generate_first_draft_task"][
                    "first_draft_results"
                ]
            }

            yield ServerSentEvent(data=data, event="first_draft")
        # 终稿
        if chunk["type"] == "updates" and "generate_final_ppt_task" in chunk["data"]:
            data = {
                "final_ppt_results": chunk["data"]["generate_final_ppt_task"][
                    "final_ppt_results"
                ]
            }

            yield ServerSentEvent(data=data, event="final_ppt")


async def resume_ppt_agent(
    agent: CompiledStateGraph[State, None, InputSchema],
    user_input: dict | None,
    thread_id: str,
) -> AsyncIterator[ServerSentEvent]:
    """
    当因为中断而恢复的时候，输入应该是一个dict 或者bool
    当因为abort而恢复的时候，输入应该是None
    """

    config: RunnableConfig = {"configurable": {"thread_id": thread_id}}
    wrap_input: Command | None = (
        Command(resume=user_input) if user_input is not None else None
    )

    async for chunk in agent.astream(
        wrap_input,
        config=config,
        durability="sync",
        stream_mode=["custom", "values", "updates"],
        version="v2",
    ):
        if chunk["type"] == "values" and len(chunk["interrupts"]) > 0:
            data = {"type": "interrupts", "data": chunk["interrupts"]}
            yield ServerSentEvent(data=data, event="interrupts")

        if chunk["type"] == "custom" and "current_stage" in chunk["data"]:
            data = {"type": "current_stage", "data": chunk["data"]["current_stage"]}

            yield ServerSentEvent(data=data, event="current_stage")

        # 初稿
        if chunk["type"] == "updates" and "generate_first_draft_task" in chunk["data"]:
            data = {
                "first_draft_results": chunk["data"]["generate_first_draft_task"][
                    "first_draft_results"
                ]
            }

            yield ServerSentEvent(data=data, event="first_draft")
        # 终稿
        if chunk["type"] == "updates" and "generate_final_ppt_task" in chunk["data"]:
            data = {
                "final_ppt_results": chunk["data"]["generate_final_ppt_task"][
                    "final_ppt_results"
                ]
            }

            yield ServerSentEvent(data=data, event="final_ppt")


async def test_pipeline():
    agent = await PPTAgent.create()
    thread_id = "zwc_test222"
    async for chunk in start_ppt_agent(
        agent,
        ppt_requirement="我是一个学生，我想给导师做一个有关deepseek的论文的汇报,排版使用上下结构的",
        thread_id=thread_id,
    ):
        print(chunk)

    async for chunk in resume_ppt_agent(
        agent,
        user_input={
            "target_audience": "导师以及同学",
            "user_role": "学生",
            "layout_style": "top_bottom",
            "num_pages": 10,
            "theme": "DeekSeek R1的介绍",
        },
        thread_id=thread_id,
    ):
        print(chunk)

    async for chunk in resume_ppt_agent(
        agent,
        user_input={"ppt_content_source_urls": None, "have_ppt_content_files": False},
        thread_id=thread_id,
    ):
        print(chunk)

    async for chunk in resume_ppt_agent(
        agent,
        user_input={"have_ppt_template": False, "ppt_template_path": None},
        thread_id=thread_id,
    ):
        print(chunk)

    async for chunk in resume_ppt_agent(
        agent, user_input={"user_ppt_style": "绿色简约风"}, thread_id=thread_id
    ):
        print(chunk)


async def test_partial_node():
    agent = await PPTAgent.create()
    thread_id = "zwc_test555"
    config: RunnableConfig = {"configurable": {"thread_id": thread_id}}
    origin_state = State(
        ppt_info=PPTInfo(
            target_audience="导师以及同学",
            user_role="学生",
            layout_style="top_bottom",
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
        # first_draft_results=first_draft_results,
        user_ppt_style="绿色简约风",
    )
    fork_config = await agent.aupdate_state(
        config, origin_state, as_node="generate_ppt_content_per_page"
    )
    async for chunk in agent.astream(
        None,
        config=fork_config,
        durability="sync",
        stream_mode=["custom", "values", "tasks", "updates"],
        version="v2",
    ):
        if chunk["type"] == "values" and len(chunk["interrupts"]) > 0:
            print({"type": "interrupts", "data": chunk["interrupts"]})
        if chunk["type"] == "custom" and "current_stage" in chunk["data"]:
            print({"type": "current_stage", "data": chunk["data"]["current_stage"]})
        # 初稿
        if chunk["type"] == "updates" and "generate_first_draft_task" in chunk["data"]:
            print(
                "updates",
                chunk["data"]["generate_first_draft_task"]["first_draft_results"],
            )
        # 终稿
        if chunk["type"] == "updates" and "generate_final_ppt_task" in chunk["data"]:
            print(
                "updates", chunk["data"]["generate_final_ppt_task"]["final_ppt_results"]
            )

    # async for chunk in agent.astream_events(
    #     None,
    #     config=fork_config,
    #     durability="sync",
    #     stream_mode=[
    #         "custom",
    #         "values",
    #         "tasks",
    #     ],
    #     version="v2",
    # ):
    #     print(chunk)


async def main():
    await test_pipeline()
    # await test_partial_node()


if __name__ == "__main__":
    asyncio.run(main())
