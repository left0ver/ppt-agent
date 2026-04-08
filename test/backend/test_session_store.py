from __future__ import annotations

import sys
from pathlib import Path
import sqlite3

import pytest

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


def test_reopen_store_persists_session_message_and_pending_interrupt(tmp_path: Path) -> None:
    db_path = tmp_path / "sessions.sqlite3"

    store = SessionStore(db_path)
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
    store.close()

    reopened = SessionStore(db_path)
    detail = reopened.get_session_detail(session.id)

    assert reopened.list_sessions()[0].id == session.id
    assert detail.session.title == "新会话"
    assert detail.messages[-1].id == message.id
    assert detail.pending_interrupt is not None
    assert detail.pending_interrupt.message_id == message.id
    reopened.close()


def test_cross_session_interrupt_message_linkage_is_rejected(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    first = store.create_session()
    second = store.create_session()
    message = store.append_message(
        first.id,
        role="ai",
        type="interrupt",
        content="需要补充信息",
        payload={"type": "input", "title": "补充信息", "payload": {"field": "value"}},
    )

    with pytest.raises(sqlite3.IntegrityError):
        store.upsert_pending_interrupt(
            second.id,
            interrupt_type="input",
            title="补充信息",
            payload={"field": "value"},
            message_id=message.id,
        )


def test_second_pending_interrupt_preserves_history(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    session = store.create_session()

    first_message = store.append_message(
        session.id,
        role="ai",
        type="interrupt",
        content="第一次中断",
        payload={"type": "input", "title": "第一次中断", "payload": {"step": 1}},
    )
    first_interrupt = store.upsert_pending_interrupt(
        session.id,
        interrupt_type="input",
        title="第一次中断",
        payload={"step": 1},
        message_id=first_message.id,
    )
    store.resolve_interrupt(session.id, status="resolved")

    second_message = store.append_message(
        session.id,
        role="ai",
        type="interrupt",
        content="第二次中断",
        payload={"type": "confirm", "title": "第二次中断", "payload": {"step": 2}},
    )
    second_interrupt = store.upsert_pending_interrupt(
        session.id,
        interrupt_type="confirm",
        title="第二次中断",
        payload={"step": 2},
        message_id=second_message.id,
    )

    assert first_interrupt.id != second_interrupt.id
    assert store.get_pending_interrupt(session.id).id == second_interrupt.id

    rows = store._connection.execute(
        """
        SELECT id, status, message_id
        FROM session_interrupts
        WHERE session_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (session.id,),
    ).fetchall()
    assert len(rows) == 2
    assert rows[0]["status"] == "resolved"
    assert rows[1]["status"] == "pending"


def test_resolve_interrupt_only_touches_session_when_pending_row_changes(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    session = store.create_session()
    before = store.get_session(session.id).updated_at

    store.resolve_interrupt(session.id, status="resolved")

    after = store.get_session(session.id).updated_at
    assert after == before
