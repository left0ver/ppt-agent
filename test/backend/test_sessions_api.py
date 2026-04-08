from __future__ import annotations

import sys
import types
from enum import Enum
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

agent_module = types.ModuleType("agent")
agent_app_module = types.ModuleType("agent.app")
agent_modify_ppt_module = types.ModuleType("agent.modify_ppt")
constant_module = types.ModuleType("constant")


class InputSchema:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs


async def start_workflow(*args: object, **kwargs: object) -> dict[str, object]:
    return {}


async def resume_workflow(*args: object, **kwargs: object) -> dict[str, object]:
    return {}


class _ModifyPpt:
    def invoke(self, payload: object) -> object:
        return payload


class _ModifyPptAgent:
    def invoke(self, payload: object, config: object | None = None) -> object:
        return payload


class _InterruptValue:
    def __init__(self, value: str) -> None:
        self.value = value


class InterruptType:
    EDIT = _InterruptValue("edit")
    UPLOAD_PPT_CONTENT_FILES = _InterruptValue("upload_ppt_content_files")
    UPLOAD_PPT_TEMPLATE = _InterruptValue("upload_ppt_template")
    INPUT = _InterruptValue("input")


agent_app_module.InputSchema = InputSchema
agent_app_module.start_workflow = start_workflow
agent_app_module.resume_workflow = resume_workflow
agent_modify_ppt_module.modify_ppt = _ModifyPpt()
agent_modify_ppt_module.modify_ppt_agent = _ModifyPptAgent()
constant_module.InterruptType = InterruptType
agent_module.app = agent_app_module
agent_module.modify_ppt = agent_modify_ppt_module

sys.modules.setdefault("agent", agent_module)
sys.modules.setdefault("agent.app", agent_app_module)
sys.modules.setdefault("agent.modify_ppt", agent_modify_ppt_module)
sys.modules.setdefault("constant", constant_module)

from backend import app as app_module
from backend.session_store import SessionStore


def make_client(tmp_path: Path) -> TestClient:
    app_module.store = SessionStore(tmp_path / "sessions.sqlite3")
    app_module.USER_DATA_DIR = tmp_path / "user_data"
    app_module._session_interrupt_state.clear()
    app_module._session_error_state.clear()
    return TestClient(app_module.app)


def test_create_and_list_session(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    create_response = client.post("/api/sessions")

    assert create_response.status_code == 200
    created = create_response.json()
    assert created["title"] == "新会话"
    assert created["status"] == "idle"
    assert created["stage"] == "idle"
    assert created["id"]
    assert created["created_at"]
    assert created["updated_at"]

    list_response = client.get("/api/sessions")

    assert list_response.status_code == 200
    sessions = list_response.json()
    assert len(sessions) == 1
    assert sessions[0] == created


def test_get_session_detail_contains_messages_and_preview_fields(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()

    detail_response = client.get(f"/api/sessions/{session['id']}")

    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["session"] == session
    assert detail["messages"] == []
    assert detail["pending_interrupt"] is None
    assert detail["preview"] == {
        "ppt_outline": None,
        "ppt_page_contents": None,
        "ppt_content_files_markdown_contents": None,
        "first_draft_results": [],
        "final_ppt_results": [],
    }


def test_rename_session(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()

    rename_response = client.patch(
        f"/api/sessions/{session['id']}",
        json={"title": "Quarterly Business Review"},
    )

    assert rename_response.status_code == 200
    renamed = rename_response.json()
    assert renamed["id"] == session["id"]
    assert renamed["title"] == "Quarterly Business Review"
    assert renamed["status"] == session["status"]
    assert renamed["stage"] == session["stage"]
    assert renamed["created_at"] == session["created_at"]
    assert renamed["updated_at"] >= session["updated_at"]

    detail_response = client.get(f"/api/sessions/{session['id']}")
    assert detail_response.status_code == 200
    assert detail_response.json()["session"]["title"] == "Quarterly Business Review"


def test_get_session_detail_missing_id_returns_404(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    detail_response = client.get("/api/sessions/missing-session")

    assert detail_response.status_code == 404
    assert detail_response.json() == {"detail": "session not found"}


def test_rename_session_rejects_whitespace_only_title(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()

    rename_response = client.patch(
        f"/api/sessions/{session['id']}",
        json={"title": "   "},
    )

    assert rename_response.status_code == 422


def test_session_store_update_session_updates_only_provided_fields(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite3")
    session = store.create_session()

    renamed = store.update_session(session.id, title="Renamed Session")
    updated_state = store.update_session(session.id, status="running", stage="starting")

    assert renamed.id == session.id
    assert renamed.title == "Renamed Session"
    assert renamed.status == session.status
    assert renamed.stage == session.stage
    assert updated_state.id == session.id
    assert updated_state.title == "Renamed Session"
    assert updated_state.status == "running"
    assert updated_state.stage == "starting"


def test_session_store_serializes_enum_payloads(tmp_path: Path) -> None:
    class TimeLine(Enum):
        INFO_GATHERED = "INFO_GATHERED"

    store = SessionStore(tmp_path / "sessions.sqlite3")
    session = store.create_session()

    store.append_message(
        session_id=session.id,
        role="assistant",
        type="status",
        payload={"current_timeline": TimeLine.INFO_GATHERED},
    )

    detail = store.get_session_detail(session.id)
    assert detail.messages[-1].payload == {"current_timeline": "INFO_GATHERED"}


def test_submit_first_message_starts_workflow_and_persists_interrupt(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()
    calls: dict[str, Any] = {}

    async def fake_start_workflow(input_schema: InputSchema, thread_id: str) -> dict[str, object]:
        calls["input"] = input_schema.kwargs
        calls["thread_id"] = thread_id
        return {
            "__interrupt__": {
                "type": "upload_ppt_content_files",
                "title": "Upload supporting documents",
                "values": {"accepted_types": [".pdf", ".md"]},
            }
        }

    monkeypatch.setattr(app_module, "start_workflow", fake_start_workflow)

    response = client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"type": "text", "content": "Build a QBR deck for the board meeting."},
    )

    assert response.status_code == 200
    body = response.json()
    assert calls == {
        "input": {"ppt_requirement": "Build a QBR deck for the board meeting."},
        "thread_id": session["id"],
    }
    assert body["session"]["id"] == session["id"]
    assert body["session"]["status"] == "interrupted"
    assert body["session"]["stage"] == "awaiting_content_sources"
    assert [message["role"] for message in body["messages"]] == ["user", "assistant"]
    assert [message["type"] for message in body["messages"]] == ["text", "interrupt"]
    assert body["messages"][0]["content"] == "Build a QBR deck for the board meeting."
    assert body["messages"][1]["content"] == "Upload supporting documents"
    assert body["messages"][1]["payload"] == {
        "type": "upload_ppt_content_files",
        "title": "Upload supporting documents",
        "payload": {"accepted_types": [".pdf", ".md"]},
    }
    assert body["pending_interrupt"] == {
        "id": body["pending_interrupt"]["id"],
        "session_id": session["id"],
        "interrupt_type": "upload_ppt_content_files",
        "title": "Upload supporting documents",
        "payload": {"accepted_types": [".pdf", ".md"]},
        "status": "pending",
        "message_id": body["messages"][1]["id"],
        "created_at": body["pending_interrupt"]["created_at"],
        "resolved_at": None,
    }

    persisted = client.get(f"/api/sessions/{session['id']}")
    assert persisted.status_code == 200
    assert persisted.json()["messages"] == body["messages"]
    assert persisted.json()["pending_interrupt"] == body["pending_interrupt"]


def test_submit_interrupt_response_resumes_workflow_and_clears_pending_interrupt(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()
    calls: dict[str, Any] = {}

    async def fake_start_workflow(input_schema: InputSchema, thread_id: str) -> dict[str, object]:
        calls["start_input"] = input_schema.kwargs
        calls["start_thread_id"] = thread_id
        return {
            "__interrupt__": {
                "type": "input",
                "title": "Choose the final style",
                "values": {"options": ["clean", "bold"]},
            }
        }

    async def fake_resume_workflow(thread_id: str, payload: dict[str, object]) -> dict[str, object]:
        calls["resume_thread_id"] = thread_id
        calls["resume_payload"] = payload
        return {}

    monkeypatch.setattr(app_module, "start_workflow", fake_start_workflow)
    monkeypatch.setattr(app_module, "resume_workflow", fake_resume_workflow)

    first_response = client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"type": "text", "content": "Create an investor update deck."},
    )

    assert first_response.status_code == 200
    assert first_response.json()["pending_interrupt"]["interrupt_type"] == "input"

    response = client.post(
        f"/api/sessions/{session['id']}/messages",
        json={
            "type": "interrupt_response",
            "payload": {"selected_style": "clean", "audience": "investors"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert calls["resume_thread_id"] == session["id"]
    assert calls["resume_payload"] == {"selected_style": "clean", "audience": "investors"}
    assert body["session"]["status"] == "completed"
    assert body["session"]["stage"] == "completed"
    assert body["pending_interrupt"] is None
    assert [message["type"] for message in body["messages"]] == [
        "text",
        "interrupt",
        "interrupt_response",
        "status",
    ]
    assert body["messages"][2]["role"] == "user"
    assert body["messages"][2]["content"] is None
    assert body["messages"][2]["payload"] == {"selected_style": "clean", "audience": "investors"}
    assert body["messages"][3]["role"] == "assistant"
    assert body["messages"][3]["content"]

    persisted = client.get(f"/api/sessions/{session['id']}")
    assert persisted.status_code == 200
    detail = persisted.json()
    assert detail["session"] == body["session"]
    assert detail["messages"] == body["messages"]
    assert detail["pending_interrupt"] is None


def test_interrupt_response_uses_theme_as_default_session_title(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()

    async def fake_start_workflow(input_schema: InputSchema, thread_id: str) -> dict[str, object]:
        return {
            "__interrupt__": {
                "type": "edit",
                "title": "请确认 PPT 基本信息",
                "values": {
                    "target_audience": "导师和同学",
                    "user_role": "学生",
                    "num_pages": 12,
                    "theme": "旧主题",
                    "layout_style": "top_bottom",
                },
            }
        }

    async def fake_resume_workflow(thread_id: str, payload: dict[str, object]) -> dict[str, object]:
        return {"response_content": "已完成"}

    monkeypatch.setattr(app_module, "start_workflow", fake_start_workflow)
    monkeypatch.setattr(app_module, "resume_workflow", fake_resume_workflow)

    first_response = client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"type": "text", "content": "帮我做一个答辩 PPT"},
    )
    assert first_response.status_code == 200
    assert first_response.json()["session"]["title"] == "新会话"

    response = client.post(
        f"/api/sessions/{session['id']}/messages",
        json={
            "type": "interrupt_response",
            "content": "已确认 PPT 信息：AI 产品介绍",
            "payload": {
                "target_audience": "投资人",
                "user_role": "产品经理",
                "num_pages": 12,
                "theme": "AI 产品介绍",
                "layout_style": "top_bottom",
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["session"]["title"] == "AI 产品介绍"

    detail_response = client.get(f"/api/sessions/{session['id']}")
    assert detail_response.status_code == 200
    assert detail_response.json()["session"]["title"] == "AI 产品介绍"


def test_upload_attachments_use_session_routes_without_advancing_workflow(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()

    content_response = client.post(
        f"/api/sessions/{session['id']}/attachments/content-files",
        files=[
            (
                "files",
                ("context.md", b"# Notes", "text/markdown"),
            )
        ],
    )
    template_response = client.post(
        f"/api/sessions/{session['id']}/attachments/template",
        files={"file": ("template.pptx", b"pptx-bytes", "application/vnd.ms-powerpoint")},
    )

    assert content_response.status_code == 200
    assert template_response.status_code == 200
    assert content_response.json()["thread_id"] == session["id"]
    assert content_response.json()["files"][0]["name"] == "context.md"
    assert template_response.json()["thread_id"] == session["id"]
    assert template_response.json()["file"]["name"] == "template.pptx"

    detail = client.get(f"/api/sessions/{session['id']}")
    assert detail.status_code == 200
    assert detail.json()["session"]["status"] == "idle"
    assert detail.json()["session"]["stage"] == "idle"
    assert detail.json()["messages"] == []
    assert detail.json()["pending_interrupt"] is None


def test_modify_page_response_preserves_pending_interrupt_view(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()
    calls: dict[str, Any] = {}

    async def fake_start_workflow(input_schema: InputSchema, thread_id: str) -> dict[str, object]:
        return {
            "__interrupt__": {
                "type": "input",
                "title": "Choose the final style",
                "values": {"options": ["clean", "bold"]},
            }
        }

    class FakeModifyPptAgent:
        def invoke(self, payload: object, config: object | None = None) -> object:
            calls["payload"] = payload
            calls["config"] = config
            return {
                "response_content": "第1页的终稿修改成功.",
                "new_svg_list": [{"page": 1, "new_svg_content": "<svg />"}],
            }

    monkeypatch.setattr(app_module, "start_workflow", fake_start_workflow)
    monkeypatch.setattr(app_module, "modify_ppt_agent", FakeModifyPptAgent())

    start_response = client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"type": "text", "content": "Create an investor update deck."},
    )
    assert start_response.status_code == 200
    assert start_response.json()["pending_interrupt"]["interrupt_type"] == "input"

    modify_response = client.post(
        "/api/ppt/modify",
        json={
            "thread_id": session["id"],
            "ppt_type": "终稿",
            "pages": [1],
            "user_instruction": "Update the title slide.",
        },
    )

    assert modify_response.status_code == 200
    body = modify_response.json()
    assert calls["payload"] == {
        "thread_id": session["id"],
        "ppt_type": "终稿",
        "user_instruction": "请只修改以下页面：第1页。\n用户原始修改要求：Update the title slide.",
        "messages": [],
    }
    assert calls["config"] == {"configurable": {"thread_id": session["id"]}}
    assert body["status"] == "interrupted"
    assert body["stage"] == "awaiting_final_style"
    assert body["interrupt"] == {
        "type": "input",
        "title": "Choose the final style",
        "payload": {"options": ["clean", "bold"]},
    }

    status_response = client.get("/api/ppt/status", params={"thread_id": session["id"]})
    assert status_response.status_code == 200
    assert status_response.json()["interrupt"] == body["interrupt"]

    detail = client.get(f"/api/sessions/{session['id']}")
    assert detail.status_code == 200
    assert detail.json()["pending_interrupt"]["interrupt_type"] == "input"


def test_interrupt_transition_rolls_back_partial_persistence_on_failure(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()

    async def fake_start_workflow(input_schema: InputSchema, thread_id: str) -> dict[str, object]:
        return {
            "__interrupt__": {
                "type": "upload_ppt_content_files",
                "title": "Upload supporting documents",
                "values": {"accepted_types": [".pdf", ".md"]},
            }
        }

    def broken_insert_pending_interrupt_row(
        self: SessionStore,
        session_id: str,
        interrupt_type: str,
        title: str,
        payload: object,
        message_id: str,
        status: str,
    ) -> None:
        raise RuntimeError("interrupt write failed")

    monkeypatch.setattr(app_module, "start_workflow", fake_start_workflow)
    monkeypatch.setattr(
        SessionStore,
        "_insert_pending_interrupt_row",
        broken_insert_pending_interrupt_row,
    )

    response = client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"type": "text", "content": "Build a QBR deck for the board meeting."},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["session"]["status"] == "failed"
    assert body["session"]["stage"] == "failed"
    assert body["pending_interrupt"] is None
    assert [message["type"] for message in body["messages"]] == ["text", "error"]
    assert all(message["type"] != "interrupt" for message in body["messages"])

    detail = client.get(f"/api/sessions/{session['id']}")
    assert detail.status_code == 200
    assert detail.json()["pending_interrupt"] is None
    assert [message["type"] for message in detail.json()["messages"]] == ["text", "error"]


def test_legacy_start_route_persists_initiating_user_message(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    client = make_client(tmp_path)
    session = client.post("/api/sessions").json()

    async def fake_start_workflow(input_schema: InputSchema, thread_id: str) -> dict[str, object]:
        return {
            "__interrupt__": {
                "type": "upload_ppt_content_files",
                "title": "Upload supporting documents",
                "values": {"accepted_types": [".pdf", ".md"]},
            }
        }

    monkeypatch.setattr(app_module, "start_workflow", fake_start_workflow)

    response = client.post(
        "/api/ppt/start",
        json={"thread_id": session["id"], "ppt_requirement": "Build a board update deck."},
    )

    assert response.status_code == 200

    detail = client.get(f"/api/sessions/{session['id']}")
    assert detail.status_code == 200
    messages = detail.json()["messages"]
    assert [message["type"] for message in messages] == ["text", "interrupt"]
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Build a board update deck."
