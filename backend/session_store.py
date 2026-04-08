from __future__ import annotations

from contextlib import contextmanager
from enum import Enum
import json
import sqlite3
import uuid
from dataclasses import asdict, is_dataclass
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from backend.db import connect_db, initialize_schema


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_compatible(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {key: _json_compatible(item) for key, item in asdict(value).items()}
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_compatible(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_compatible(item) for item in value]
    if hasattr(value, "model_dump"):
        return _json_compatible(value.model_dump())  # type: ignore[no-any-return]
    return value


def _json_dumps(value: Any) -> str:
    return json.dumps(_json_compatible(value), ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str | None) -> Any:
    if value is None:
        return None
    return json.loads(value)


@dataclass(frozen=True)
class SessionRecord:
    id: str
    title: str
    status: str
    stage: str
    created_at: str
    updated_at: str
    archived: bool


@dataclass(frozen=True)
class MessageRecord:
    id: str
    session_id: str
    role: str
    type: str
    content: str | None
    payload: Any
    created_at: str


@dataclass(frozen=True)
class InterruptRecord:
    id: str
    session_id: str
    interrupt_type: str
    title: str
    payload: Any
    status: str
    message_id: str
    created_at: str
    resolved_at: str | None


@dataclass(frozen=True)
class SessionDetail:
    session: SessionRecord
    messages: list[MessageRecord]
    pending_interrupt: InterruptRecord | None


class SessionNotFoundError(KeyError):
    pass


class SessionStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._connection = connect_db(db_path)
        initialize_schema(self._connection)

    def close(self) -> None:
        self._connection.close()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        savepoint_name = f"session_store_{uuid.uuid4().hex}"
        self._connection.execute(f"SAVEPOINT {savepoint_name}")
        try:
            yield
        except Exception:
            self._connection.execute(f"ROLLBACK TO {savepoint_name}")
            self._connection.execute(f"RELEASE {savepoint_name}")
            raise
        else:
            self._connection.execute(f"RELEASE {savepoint_name}")
            self._connection.commit()

    def create_session(self) -> SessionRecord:
        session_id = str(uuid.uuid4())
        created_at = now_iso()
        self._connection.execute(
            """
            INSERT INTO sessions (id, title, status, stage, created_at, updated_at, archived)
            VALUES (?, ?, ?, ?, ?, ?, 0)
            """,
            (session_id, "新会话", "idle", "idle", created_at, created_at),
        )
        self._connection.commit()
        return self.get_session(session_id)

    def list_sessions(self) -> list[SessionRecord]:
        rows = self._connection.execute(
            """
            SELECT id, title, status, stage, created_at, updated_at, archived
            FROM sessions
            ORDER BY updated_at DESC, created_at DESC
            """
        ).fetchall()
        return [self._row_to_session(row) for row in rows]

    def get_session(self, session_id: str) -> SessionRecord:
        row = self._connection.execute(
            """
            SELECT id, title, status, stage, created_at, updated_at, archived
            FROM sessions
            WHERE id = ?
            """,
            (session_id,),
        ).fetchone()
        if row is None:
            raise SessionNotFoundError(session_id)
        return self._row_to_session(row)

    def update_session(
        self,
        session_id: str,
        *,
        title: str | None = None,
        status: str | None = None,
        stage: str | None = None,
    ) -> SessionRecord:
        self._update_session_row(
            session_id,
            title=title,
            status=status,
            stage=stage,
        )
        self._connection.commit()
        return self.get_session(session_id)

    def append_message(
        self,
        session_id: str,
        role: str,
        type: str,
        content: str | None = None,
        payload: Any = None,
    ) -> MessageRecord:
        record = self._append_message_row(
            session_id=session_id,
            role=role,
            type=type,
            content=content,
            payload=payload,
        )
        self._connection.commit()
        return record

    def upsert_pending_interrupt(
        self,
        session_id: str,
        interrupt_type: str,
        title: str,
        payload: Any,
        message_id: str,
        status: str = "pending",
    ) -> InterruptRecord:
        with self.transaction():
            self._resolve_pending_interrupt_rows(session_id, status="resolved")
            interrupt = self._insert_pending_interrupt_row(
                session_id=session_id,
                interrupt_type=interrupt_type,
                title=title,
                payload=payload,
                message_id=message_id,
                status=status,
            )
            self._touch_session(session_id)
        return self.get_pending_interrupt(session_id) or interrupt

    def get_pending_interrupt(self, session_id: str) -> InterruptRecord | None:
        row = self._connection.execute(
            """
            SELECT id, session_id, interrupt_type, title, payload_json, status, message_id,
                   created_at, resolved_at
            FROM session_interrupts
            WHERE session_id = ? AND status = 'pending'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        return self._row_to_interrupt(row)

    def get_latest_message(self, session_id: str) -> MessageRecord | None:
        row = self._connection.execute(
            """
            SELECT id, session_id, role, type, content, payload_json, created_at
            FROM messages
            WHERE session_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        return self._row_to_message(row)

    def resolve_interrupt(self, session_id: str, status: str = "resolved") -> None:
        updated = self._resolve_pending_interrupt_rows(session_id, status=status)
        if updated:
            self._touch_session(session_id)
        self._connection.commit()

    def record_workflow_interrupt(
        self,
        session_id: str,
        *,
        interrupt_type: str,
        title: str,
        payload: Any,
        stage: str,
        message_payload: Any,
    ) -> SessionDetail:
        with self.transaction():
            interrupt_message = self._append_message_row(
                session_id=session_id,
                role="assistant",
                type="interrupt",
                content=title,
                payload=message_payload,
            )
            self._resolve_pending_interrupt_rows(session_id, status="resolved")
            self._insert_pending_interrupt_row(
                session_id=session_id,
                interrupt_type=interrupt_type,
                title=title,
                payload=payload,
                message_id=interrupt_message.id,
                status="pending",
            )
            self._update_session_row(session_id, status="interrupted", stage=stage)
        return self.get_session_detail(session_id)

    def record_workflow_completion(
        self,
        session_id: str,
        *,
        content: str,
        payload: Any = None,
    ) -> SessionDetail:
        with self.transaction():
            self._resolve_pending_interrupt_rows(session_id, status="resolved")
            self._update_session_row(session_id, status="completed", stage="completed")
            self._append_message_row(
                session_id=session_id,
                role="assistant",
                type="status",
                content=content,
                payload=payload,
            )
        return self.get_session_detail(session_id)

    def record_workflow_error(self, session_id: str, *, message: str) -> SessionDetail:
        with self.transaction():
            self._update_session_row(session_id, status="failed", stage="failed")
            self._append_message_row(
                session_id=session_id,
                role="assistant",
                type="error",
                content=message,
                payload={"message": message},
            )
        return self.get_session_detail(session_id)

    def get_session_detail(self, session_id: str) -> SessionDetail:
        session = self.get_session(session_id)
        messages = self._connection.execute(
            """
            SELECT id, session_id, role, type, content, payload_json, created_at
            FROM messages
            WHERE session_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (session_id,),
        ).fetchall()
        pending_interrupt = self.get_pending_interrupt(session_id)
        return SessionDetail(
            session=session,
            messages=[self._row_to_message(row) for row in messages],
            pending_interrupt=pending_interrupt,
        )

    def _touch_session(self, session_id: str) -> None:
        self._connection.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (now_iso(), session_id),
        )

    def _update_session_row(
        self,
        session_id: str,
        *,
        title: str | None = None,
        status: str | None = None,
        stage: str | None = None,
    ) -> None:
        updated_at = now_iso()
        cursor = self._connection.execute(
            """
            UPDATE sessions
            SET title = COALESCE(?, title),
                status = COALESCE(?, status),
                stage = COALESCE(?, stage),
                updated_at = ?
            WHERE id = ?
            """,
            (title, status, stage, updated_at, session_id),
        )
        if cursor.rowcount == 0:
            raise SessionNotFoundError(session_id)

    def _append_message_row(
        self,
        *,
        session_id: str,
        role: str,
        type: str,
        content: str | None = None,
        payload: Any = None,
    ) -> MessageRecord:
        message_id = str(uuid.uuid4())
        created_at = now_iso()
        payload_json = None if payload is None else _json_dumps(payload)
        self._connection.execute(
            """
            INSERT INTO messages (id, session_id, role, type, content, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (message_id, session_id, role, type, content, payload_json, created_at),
        )
        self._touch_session(session_id)
        return MessageRecord(
            id=message_id,
            session_id=session_id,
            role=role,
            type=type,
            content=content,
            payload=payload,
            created_at=created_at,
        )

    def _resolve_pending_interrupt_rows(self, session_id: str, status: str) -> int:
        cursor = self._connection.execute(
            """
            UPDATE session_interrupts
            SET status = ?, resolved_at = ?
            WHERE session_id = ? AND status = 'pending'
            """,
            (status, now_iso(), session_id),
        )
        return cursor.rowcount

    def _insert_pending_interrupt_row(
        self,
        *,
        session_id: str,
        interrupt_type: str,
        title: str,
        payload: Any,
        message_id: str,
        status: str,
    ) -> InterruptRecord:
        interrupt_id = str(uuid.uuid4())
        created_at = now_iso()
        self._connection.execute(
            """
            INSERT INTO session_interrupts (
                id, session_id, interrupt_type, title, payload_json, status, message_id,
                created_at, resolved_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (
                interrupt_id,
                session_id,
                interrupt_type,
                title,
                _json_dumps(payload),
                status,
                message_id,
                created_at,
            ),
        )
        return InterruptRecord(
            id=interrupt_id,
            session_id=session_id,
            interrupt_type=interrupt_type,
            title=title,
            payload=payload,
            status=status,
            message_id=message_id,
            created_at=created_at,
            resolved_at=None,
        )

    @staticmethod
    def _row_to_session(row: sqlite3.Row) -> SessionRecord:
        return SessionRecord(
            id=row["id"],
            title=row["title"],
            status=row["status"],
            stage=row["stage"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            archived=bool(row["archived"]),
        )

    @staticmethod
    def _row_to_message(row: sqlite3.Row) -> MessageRecord:
        return MessageRecord(
            id=row["id"],
            session_id=row["session_id"],
            role=row["role"],
            type=row["type"],
            content=row["content"],
            payload=_json_loads(row["payload_json"]),
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_interrupt(row: sqlite3.Row) -> InterruptRecord:
        return InterruptRecord(
            id=row["id"],
            session_id=row["session_id"],
            interrupt_type=row["interrupt_type"],
            title=row["title"],
            payload=_json_loads(row["payload_json"]),
            status=row["status"],
            message_id=row["message_id"],
            created_at=row["created_at"],
            resolved_at=row["resolved_at"],
        )
