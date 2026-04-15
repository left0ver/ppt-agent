import asyncio
import logging

from agent.ppt_agent.ppt_agent import PPTAgent
from dotenv import load_dotenv
from langchain_core.runnables import RunnableConfig
from agent.ppt_agent.state import PPTInfo, State
from agent.ppt_agent.temp import (
    first_draft_results,
    ppt_content_files_markdown_contents,
    ppt_outline,
    ppt_page_contents,
    user_content,
    web_fetch_results,
)
from agent.ppt_agent.utils import setup_logging

load_dotenv()
setup_logging()

logger = logging.getLogger(__file__)


async def main():
    agent = PPTAgent()
    config: RunnableConfig = {"configurable": {"thread_id": "zwc_test"}}
    origin_state = State(
        ppt_info=PPTInfo(
            target_audience="导师以及同学",
            user_role="学生",
            # purpose="汇报",
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
        first_draft_results=first_draft_results,
        user_ppt_style="绿色简约风",
    )
    fork_config = await agent.aupdate_state(
        config, origin_state, as_node="generate_ppt_content_per_page"
    )
    async for chunk in agent.astream(
        None,
        config=fork_config,
        durability="sync",
        stream_mode=["custom", "values"],
        version="v2",
    ):
        if chunk["type"] == "values" and len(chunk["interrupts"]) > 0:
            print(chunk["interrupts"])
        if chunk["type"] == "custom":
            print(chunk)


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
    # async def resume_when_abort(thread_id: str):
    #     async with AsyncSqliteSaver.from_conn_string("checkpoint.db") as checkpointer:
    #         agent = graph.compile(checkpointer=checkpointer)
    #         config = RunnableConfig(configurable={"thread_id": thread_id})
    #         # state_history = await agent.aget_state(config)
    #         state_history = agent.aget_state_history(config)
    #         # async for state in state_history:
    #         # current_timeline = state.values.get("current_timeline", TimeLine.NO_START)
    #         # print(f"当前timeline: {current_timeline}")
    #         # print(f"当前state: {state}")
    #         response = await agent.ainvoke(None, config, durability="sync")
    #         # response = await agent.ainvoke(Command(resume=user_input), config=config)
    #         return response

    # async def main():
    #     # async with AsyncSqliteSaver.from_conn_string("checkpoint.db") as checkpointer:
    #     checkpointer = (
    #         InMemorySaver()
    #         if is_development()
    #         else AsyncSqliteSaver.from_conn_string("checkpoint.db")
    #     )
    #     # TODO: 开发环境使用内存的checkpointer，生产环境使用sqlite的checkpointer，避免开发过程中频繁的读写数据库
    #     agent = graph.compile(
    #         checkpointer=checkpointer, cache=SqliteCache(path="cache.db")
    #     )
    #     save_graph = True
    #     graph_name = "ppt_generation_agent_graph.png"
    #     if save_graph:
    #         graph_png = agent.get_graph(xray=True).draw_mermaid_png()
    #         save_path = Path(graph_name)
    #         save_path.write_bytes(graph_png)
    #         print(f"Graph image saved to: {save_path}")
    #     # config: RunnableConfig = {"configurable": {"thread_id": "1"}}
    #     # response = agent.invoke({"theme": "AI在企业运营中的落地实践"}, config=config)
    #     # print(response)
    #     """"
    #         test search_ppt_contents
    #         """
    #     config: RunnableConfig = {"configurable": {"thread_id": "zwc_test"}}
    #     # response = await resume_when_abort("zwc_test")
    #     # response = agent.invoke(
    #     #     InputSchema(
    #     #         ppt_requirement="我是一个学生，我想给导师做一个有关deepseek的论文的汇报,排版使用上下结构的"
    #     #     ),
    #     #     config=config,
    #     # )
    #     # print(response)
    #     # response = await agent.ainvoke(
    #     #     Command(
    #     #         resume={
    #     #             "target_audience": "导师以及同学",
    #     #             "user_role": "学生",
    #     #             "layout_style": "top_bottom",
    #     #             "num_pages": 10,
    #     #             "theme": "DeekSeek R1的介绍",
    #     #         }
    #     #     ),
    #     #     config=config,
    #     # )
    #     # print(response)

    #     origin_state = State(
    #         ppt_info=PPTInfo(
    #             target_audience="导师以及同学",
    #             user_role="学生",
    #             # purpose="汇报",
    #             layout_style=LayoutType.TOP_BOTTOM,
    #             num_pages=10,
    #             theme="DeekSeek R1的介绍",
    #         ),
    #         messages=[],
    #         ppt_template_path="user_data/zwc_test/template/template.pdf",
    #         # current_timeline=TimeLine.INFO_GATHERED,
    #         have_ppt_content_files=False,
    #         # ppt_content_source_urls=["https://ghostty.org/docs/install/binary"],
    #         # ppt_content_files_markdown_contents=ppt_content_files_markdown_contents,
    #         have_ppt_template=False,
    #         web_fetch_results=web_fetch_results,
    #         ppt_outline=ppt_outline,
    #         user_content=user_content,
    #         ppt_page_contents=ppt_page_contents,
    #         first_draft_results=first_draft_results,
    #         user_ppt_style="绿色简约风",
    #     )
    #     fork_config = await agent.aupdate_state(
    #         config, origin_state, as_node="ask_for_ppt_info"
    #     )

    #     # response = await agent.ainvoke(None, config=fork_config, durability="sync")
    #     # print(response)

    #     async for chunk in agent.astream(
    #         None,
    #         config=fork_config,
    #         durability="sync",
    #         stream_mode=["custom", "values"],
    #         version="v2",
    #     ):
    #         if chunk["type"] == "values" and len(chunk["interrupts"]) > 0:
    #             print(chunk["interrupts"])
    #         if chunk["type"] == "custom":
    #             print(chunk)

    #     # async for chunk in agent.astream(
    #     #     Command(resume={"user_ppt_style": "绿色简约风"}),
    #     #     config=fork_config,
    #     #     durability="sync",
    #     #     stream_mode=["custom", "values"],
    #     #     version="v2",
    #     # ):
    #     #     if chunk["type"] == "values" and len(chunk["interrupts"]) > 0:
    #     #         print(chunk["interrupts"])
    #     #     if chunk["type"] == "custom":
    #     #         print(chunk)

    #     # if response["__interrupt__"]:
    #     #     # print("Workflow is interrupted, waiting for user input...")
    #     #     response = agent.ainvoke(Command(resume="绿色简约风"), config=fork_config)
    #     # response = await agent.ainvoke()

    asyncio.run(main())
