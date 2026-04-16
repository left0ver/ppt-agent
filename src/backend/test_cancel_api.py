import asyncio
import unittest
from contextlib import suppress

from fastapi import HTTPException

import src.backend.main as main_module


class CancelApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        main_module.app.state.running_agent_tasks = {}
        main_module.app.state.agent = object()

    async def asyncTearDown(self) -> None:
        running_tasks = list(main_module.app.state.running_agent_tasks.values())
        main_module.app.state.running_agent_tasks = {}
        for task in running_tasks:
            if isinstance(task, asyncio.Task) and not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    async def test_cancel_agent_cancels_registered_task(self) -> None:
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def blocking_task():
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        task = asyncio.create_task(blocking_task())
        await started.wait()
        main_module.app.state.running_agent_tasks["thread-1"] = task

        response = await main_module.cancel_agent(
            main_module.CancelRequest(thread_id="thread-1")
        )

        self.assertEqual(
            response,
            {
                "thread_id": "thread-1",
                "status": "cancelled",
                "resumable": True,
            },
        )
        self.assertTrue(cancelled.is_set())
        self.assertTrue(task.cancelled())
        self.assertNotIn("thread-1", main_module.app.state.running_agent_tasks)

    async def test_cancel_agent_raises_for_unknown_thread(self) -> None:
        with self.assertRaises(HTTPException) as context:
            await main_module.cancel_agent(main_module.CancelRequest(thread_id="missing"))

        self.assertEqual(context.exception.status_code, 404)

    async def test_chat_rejects_duplicate_inflight_thread(self) -> None:
        async def fake_resume_ppt_agent(agent, user_input, thread_id):
            yield {"event": "current_stage", "data": "running"}

        original_resume = main_module.resume_ppt_agent
        main_module.resume_ppt_agent = fake_resume_ppt_agent
        running_chat_task = asyncio.create_task(asyncio.sleep(10))
        main_module.app.state.running_agent_tasks["thread-1"] = running_chat_task

        try:
            with self.assertRaises(HTTPException) as context:
                await anext(
                    main_module.chat(
                        main_module.ChatRequest(
                            thread_id="thread-1",
                            type="abort_resume",
                            user_input=None,
                        )
                    )
                )
        finally:
            main_module.resume_ppt_agent = original_resume
            running_chat_task.cancel()
            with suppress(asyncio.CancelledError):
                await running_chat_task

        self.assertEqual(context.exception.status_code, 409)

    async def test_chat_unregisters_running_task_after_completion(self) -> None:
        async def fake_resume_ppt_agent(agent, user_input, thread_id):
            yield {"event": "current_stage", "data": "running"}

        original_resume = main_module.resume_ppt_agent
        main_module.resume_ppt_agent = fake_resume_ppt_agent

        try:
            chunks = []
            async for chunk in main_module.chat(
                main_module.ChatRequest(
                    thread_id="thread-1",
                    type="abort_resume",
                    user_input=None,
                )
            ):
                chunks.append(chunk)
        finally:
            main_module.resume_ppt_agent = original_resume

        self.assertEqual(len(chunks), 1)
        self.assertNotIn("thread-1", main_module.app.state.running_agent_tasks)


if __name__ == "__main__":
    unittest.main()
