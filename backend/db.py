from __future__ import annotations

import sqlite3
from pathlib import Path


def connect_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            stage TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            archived INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT,
            payload_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            -- Required so session_interrupts(session_id, message_id) can target a same-session row.
            UNIQUE(session_id, id)
        );

        CREATE TABLE IF NOT EXISTS session_interrupts (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            interrupt_type TEXT NOT NULL,
            title TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL,
            message_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(session_id, message_id) REFERENCES messages(session_id, id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
            ON sessions(updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
            ON messages(session_id, created_at ASC);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_interrupts_pending_session
            ON session_interrupts(session_id)
            WHERE status = 'pending';

        CREATE INDEX IF NOT EXISTS idx_session_interrupts_session_created_at
            ON session_interrupts(session_id, created_at ASC);
        """
    )
    connection.commit()
