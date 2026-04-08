from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.session_store import SessionStore


def make_store(tmp_path: Path) -> SessionStore:
    return SessionStore(tmp_path / "sessions.sqlite3")


def test_create_and_list_sessions(tmp_path: Path) -> None:
    store = make_store(tmp_path)

    created = store.create_session()
    sessions = store.list_sessions()

    assert len(sessions) == 1
    assert sessions[0].id == created.id
    assert sessions[0].title == "新会话"


def test_append_message_and_pending_interrupt(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    session = store.create_session()

    message = store.append_message(
        session.id,
        role="ai",
        type="interrupt",
        content="需要补充信息",
        payload={"type": "input", "title": "补充信息", "payload": {"field": "value"}},
    )
    store.upsert_pending_interrupt(
        session.id,
        interrupt_type="input",
        title="补充信息",
        payload={"field": "value"},
        message_id=message.id,
    )

    detail = store.get_session_detail(session.id)
    pending_interrupt = store.get_pending_interrupt(session.id)

    assert detail.messages[-1].id == message.id
    assert detail.messages[-1].type == "interrupt"
    assert detail.pending_interrupt is not None
    assert detail.pending_interrupt.message_id == message.id
    assert pending_interrupt is not None
    assert pending_interrupt.title == "补充信息"


def test_resolve_interrupt_clears_pending_state(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    session = store.create_session()

    message = store.append_message(
        session.id,
        role="ai",
        type="interrupt",
        content="请确认",
        payload={"type": "confirm", "title": "请确认", "payload": {"accepted": False}},
    )
    store.upsert_pending_interrupt(
        session.id,
        interrupt_type="confirm",
        title="请确认",
        payload={"accepted": False},
        message_id=message.id,
    )

    store.resolve_interrupt(session.id, status="resolved")

    assert store.get_pending_interrupt(session.id) is None
