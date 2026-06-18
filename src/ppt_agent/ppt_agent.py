from aiosqlitepool import SQLiteConnectionPool
from langgraph.cache.sqlite import SqliteCache
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import CachePolicy, RetryPolicy

from src.ppt_agent.cache_key_func import (
    generate_final_ppt_task_key_func,
    generate_first_draft_task_key_func,
    generate_ppt_content_per_page_key_func,
)
from src.ppt_agent.config import get_config
from src.ppt_agent.node import (
    ask_for_ppt_info,
    ask_for_style,
    assign_generate_final_ppt_task,
    assign_generate_first_draft_task,
    generate_ppt_content_per_page,
    generate_ppt_outline,
    parse_ppt_content_files,
    parse_ppt_content_urls,
    parse_ppt_template,
    route_via_ppt_content_files,
    search_ppt_contents,
)
from src.ppt_agent.state import InputSchema, State
from src.ppt_agent.task_node import (
    generate_final_ppt_task,
    generate_first_draft_task,
)
from src.ppt_agent.utils import draw_graph, is_development


class PPTAgent:
    agent = None

    def _build_graph(self) -> StateGraph[State, None, InputSchema]:

        graph = StateGraph(state_schema=State, input_schema=InputSchema)
        graph.add_node("ask_for_ppt_info", ask_for_ppt_info)
        graph.add_node("search_ppt_contents", search_ppt_contents)
        graph.add_node("parse_ppt_content_files", parse_ppt_content_files)
        graph.add_node("parse_ppt_content_urls", parse_ppt_content_urls)
        # 该节点延迟执行
        # graph.add_node("parse_ppt_template", parse_ppt_template, defer=True)
        graph.add_node("generate_ppt_outline", generate_ppt_outline, defer=True)
        graph.add_node(
            "generate_ppt_content_per_page",
            generate_ppt_content_per_page,
            cache_policy=CachePolicy(
                key_func=generate_ppt_content_per_page_key_func,
                ttl=None if is_development() else 3600 * 24,
            ),
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

        # graph.add_edge("search_ppt_contents", "parse_ppt_template")
        # graph.add_edge("parse_ppt_content_urls", "parse_ppt_template")
        # graph.add_edge("parse_ppt_template", "generate_ppt_outline")
        graph.add_edge("search_ppt_contents", "generate_ppt_outline")
        graph.add_edge("parse_ppt_content_urls", "generate_ppt_outline")
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

        return graph

    async def _build_agent(
        self, pool: SQLiteConnectionPool | None = None
    ) -> CompiledStateGraph[State, None, InputSchema]:
        config = get_config()
        graph = self._build_graph()
        checkpointer = None

        if is_development():
            checkpointer = InMemorySaver()
        else:
            async with pool.connection() as conn:
                checkpointer = AsyncSqliteSaver(conn)

        cache = SqliteCache(path=config["cache_path"])
        agent = graph.compile(checkpointer=checkpointer, cache=cache)
        draw_graph(agent, save_path="ppt_generation_agent_graph.png")
        return agent

    @classmethod
    async def create(
        cls, pool: SQLiteConnectionPool | None = None
    ) -> CompiledStateGraph[State, None, InputSchema]:
        instance = cls()
        if instance.agent is None:
            instance.agent = await instance._build_agent(pool)
        return instance.agent
