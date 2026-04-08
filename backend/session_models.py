from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SessionSummaryResponse(BaseModel):
    id: str
    title: str
    status: str
    stage: str
    created_at: str
    updated_at: str


class SessionMessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    type: str
    content: str | None
    payload: Any = None
    created_at: str


class PendingInterruptResponse(BaseModel):
    id: str
    session_id: str
    interrupt_type: str
    title: str
    payload: Any
    status: str
    message_id: str
    created_at: str
    resolved_at: str | None


class SessionDetailResponse(BaseModel):
    session: SessionSummaryResponse
    messages: list[SessionMessageResponse]
    pending_interrupt: PendingInterruptResponse | None
    preview: dict[str, Any]


class RenameSessionRequest(BaseModel):
    title: str = Field(min_length=1)
