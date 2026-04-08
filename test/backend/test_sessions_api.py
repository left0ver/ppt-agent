from __future__ import annotations

import sys
import types
from pathlib import Path

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
