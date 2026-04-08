from __future__ import annotations

import json
import shutil
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import aspose.slides as slides
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).resolve().parents[1]
AGENT_DIR = ROOT_DIR / "agent"
USER_DATA_DIR = ROOT_DIR / "user_data"

for path in (ROOT_DIR, AGENT_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from agent.app import InputSchema, resume_workflow, start_workflow  # noqa: E402
from agent.modify_ppt import modify_ppt  # noqa: E402
from backend.session_models import (  # noqa: E402
    PendingInterruptResponse,
    RenameSessionRequest,
    SessionDetailResponse,
    SessionMessageResponse,
    SessionSummaryResponse,
)
from backend.session_store import (  # noqa: E402
    MessageRecord as StoredMessageRecord,
    SessionDetail as StoredSessionDetail,
    SessionNotFoundError,
    SessionRecord as StoredSessionRecord,
    SessionStore as SqliteSessionStore,
)
from constant import InterruptType  # noqa: E402


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_session_dirs(thread_id: str) -> Path:
    session_dir = USER_DATA_DIR / thread_id
    for sub_dir in (
        session_dir,
        session_dir / "context_files",
        session_dir / "context_parse",
        session_dir / "template",
        session_dir / "first_draft",
        session_dir / "final_ppt",
    ):
        sub_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def read_json_if_exists(path: Path) -> Any:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def sanitize_filename(name: str) -> str:
    safe_name = Path(name).name.strip()
    if not safe_name:
        return "upload.bin"
    return safe_name


def write_upload_file(upload: UploadFile, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as file_obj:
        shutil.copyfileobj(upload.file, file_obj)


def normalize_interrupt_payload(raw_interrupt: Any) -> dict[str, Any]:
    payload = raw_interrupt
    if isinstance(raw_interrupt, (list, tuple)) and raw_interrupt:
        payload = raw_interrupt[0]
    if hasattr(payload, "value"):
        payload = payload.value
    if isinstance(payload, dict):
        return payload
    return {"value": payload}


def map_interrupt_to_stage(interrupt_payload: dict[str, Any]) -> str:
    interrupt_type = interrupt_payload.get("type")
    if hasattr(interrupt_type, "value"):
        interrupt_type = interrupt_type.value
    match interrupt_type:
        case InterruptType.EDIT.value:
            return "awaiting_ppt_info"
        case InterruptType.UPLOAD_PPT_CONTENT_FILES.value:
            return "awaiting_content_sources"
        case InterruptType.UPLOAD_PPT_TEMPLATE.value:
            return "awaiting_template"
        case InterruptType.INPUT.value:
            return "awaiting_final_style"
        case _:
            return "interrupted"


def build_interrupt_response(interrupt_payload: dict[str, Any]) -> dict[str, Any]:
    interrupt_type = interrupt_payload.get("type")
    if hasattr(interrupt_type, "value"):
        interrupt_type = interrupt_type.value
    payload = (
        interrupt_payload.get("values")
        if "values" in interrupt_payload
        else interrupt_payload.get("payload")
    )
    if payload is None:
        payload = {
            key: value
            for key, value in interrupt_payload.items()
            if key not in {"title", "type"}
        }
    return {
        "type": interrupt_type,
        "title": interrupt_payload.get("title", ""),
        "payload": payload,
    }


def build_preview_results(thread_id: str, ppt_type: Literal["first_draft", "final_ppt"]) -> list[dict[str, Any]]:
    session_dir = ensure_session_dirs(thread_id)
    json_path = session_dir / f"{ppt_type}_results.json"
    results = read_json_if_exists(json_path) or []
    normalized_results: list[dict[str, Any]] = []

    if results:
        for index, item in enumerate(results, start=1):
            page = int(item.get("page", index))
            svg_file = session_dir / ppt_type / f"page_{page}.svg"
            svg_content = item.get("svg_content")
            if svg_content is None and svg_file.exists():
                svg_content = svg_file.read_text(encoding="utf-8")
            normalized_results.append(
                {
                    "page": page,
                    "svg_content": svg_content,
                    "svg_url": f"/api/ppt/svg/{thread_id}/{ppt_type}/{page}",
                    "file_path": str(svg_file),
                }
            )
        return normalized_results

    svg_dir = session_dir / ppt_type
    if not svg_dir.exists():
        return []
    for svg_file in sorted(svg_dir.glob("page_*.svg")):
        try:
            page = int(svg_file.stem.split("_")[-1])
        except ValueError:
            continue
        normalized_results.append(
            {
                "page": page,
                "svg_content": svg_file.read_text(encoding="utf-8"),
                "svg_url": f"/api/ppt/svg/{thread_id}/{ppt_type}/{page}",
                "file_path": str(svg_file),
            }
        )
    return normalized_results


def resolve_ppt_dir_name(ppt_type: str) -> Literal["first_draft", "final_ppt"]:
    if ppt_type in {"first_draft", "初稿"}:
        return "first_draft"
    if ppt_type in {"final_ppt", "终稿"}:
        return "final_ppt"
    raise HTTPException(status_code=400, detail="unsupported ppt type")




def collect_generated_assets(thread_id: str) -> dict[str, Any]:
    session_dir = ensure_session_dirs(thread_id)
    return {
        "ppt_outline": read_json_if_exists(session_dir / "ppt_outline.json"),
        "ppt_page_contents": read_json_if_exists(session_dir / "ppt_page_contents.json"),
        "ppt_content_files_markdown_contents": read_json_if_exists(
            session_dir / "ppt_content_files_markdown_contents.json"
        ),
        "first_draft_results": build_preview_results(thread_id, "first_draft"),
        "final_ppt_results": build_preview_results(thread_id, "final_ppt"),
    }


@dataclass
class RuntimeSessionRecord:
    thread_id: str
    status: str = "idle"
    stage: str = "idle"
    created_at: str = ""
    updated_at: str = ""
    last_interrupt: dict[str, Any] | None = None
    error: dict[str, Any] | None = None

SESSION_DB_PATH = USER_DATA_DIR / "sessions.sqlite3"
store = SqliteSessionStore(SESSION_DB_PATH)
_store_db_path = store._db_path
_stores_by_thread: dict[int, SqliteSessionStore] = {threading.get_ident(): store}
_session_interrupt_state: dict[str, dict[str, Any] | None] = {}
_session_error_state: dict[str, dict[str, Any] | None] = {}


class ApiError(BaseModel):
    message: str


class InterruptView(BaseModel):
    type: str
    title: str
    payload: Any


class SessionMeta(BaseModel):
    created_at: str
    updated_at: str
    generated_first_draft_pages: int
    generated_final_ppt_pages: int


class ApiResponse(BaseModel):
    thread_id: str
    status: str
    stage: str
    interrupt: InterruptView | None = None
    data: Any = None
    error: ApiError | None = None
    session_meta: SessionMeta


class StartRequest(BaseModel):
    thread_id: str
    ppt_requirement: str = Field(min_length=1)


class PptInfoPayload(BaseModel):
    target_audience: str
    user_role: str
    num_pages: int = Field(ge=1, le=30)
    theme: str
    layout_style: Literal["top_bottom", "grid"]


class ResumePptInfoRequest(BaseModel):
    thread_id: str
    ppt_info: PptInfoPayload


class ResumeContentSourcesRequest(BaseModel):
    thread_id: str
    have_ppt_content_files: bool
    ppt_content_source_urls: list[str] = Field(default_factory=list)


class ResumeTemplateRequest(BaseModel):
    thread_id: str
    have_ppt_template: bool


class ResumeFinalStyleRequest(BaseModel):
    thread_id: str
    user_ppt_style: str = Field(min_length=1)


class ModifyPageRequest(BaseModel):
    thread_id: str
    ppt_type: Literal["初稿", "终稿"]
    pages: list[int] = Field(min_length=1)
    user_instruction: str = Field(min_length=1)


def get_store_session(session_id: str) -> StoredSessionRecord:
    active_store = get_active_store()
    try:
        return active_store.get_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc


def get_active_store() -> SqliteSessionStore:
    global store, _store_db_path
    current_thread = threading.get_ident()
    if store._db_path != _store_db_path:
        _store_db_path = store._db_path
        _stores_by_thread.clear()
        thread_store = SqliteSessionStore(_store_db_path)
        _stores_by_thread[current_thread] = thread_store
        store = thread_store
        return thread_store
    thread_store = _stores_by_thread.get(current_thread)
    if thread_store is None:
        thread_store = SqliteSessionStore(_store_db_path)
        _stores_by_thread[current_thread] = thread_store
    store = thread_store
    return thread_store


def ensure_session_exists(session_id: str) -> StoredSessionRecord:
    session = get_store_session(session_id)
    ensure_session_dirs(session.id)
    return session


def update_session_metadata(
    session_id: str,
    *,
    title: str | None = None,
    status: str | None = None,
    stage: str | None = None,
) -> StoredSessionRecord:
    active_store = get_active_store()
    try:
        return active_store.update_session(
            session_id,
            title=title,
            status=status,
            stage=stage,
        )
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc


def get_runtime_session(session_id: str) -> RuntimeSessionRecord:
    session = ensure_session_exists(session_id)
    return RuntimeSessionRecord(
        thread_id=session.id,
        status=session.status,
        stage=session.stage,
        created_at=session.created_at,
        updated_at=session.updated_at,
        last_interrupt=_session_interrupt_state.get(session_id),
        error=_session_error_state.get(session_id),
    )


def save_runtime_session(record: RuntimeSessionRecord) -> RuntimeSessionRecord:
    _session_interrupt_state[record.thread_id] = record.last_interrupt
    _session_error_state[record.thread_id] = record.error
    updated = update_session_metadata(
        record.thread_id,
        status=record.status,
        stage=record.stage,
    )
    record.created_at = updated.created_at
    record.updated_at = updated.updated_at
    return record


def map_session_summary(record: StoredSessionRecord) -> SessionSummaryResponse:
    return SessionSummaryResponse(
        id=record.id,
        title=record.title,
        status=record.status,
        stage=record.stage,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def map_session_message(record: StoredMessageRecord) -> SessionMessageResponse:
    return SessionMessageResponse(
        id=record.id,
        session_id=record.session_id,
        role=record.role,
        type=record.type,
        content=record.content,
        payload=record.payload,
        created_at=record.created_at,
    )


def map_session_detail(record: StoredSessionDetail) -> SessionDetailResponse:
    return SessionDetailResponse(
        session=map_session_summary(record.session),
        messages=[map_session_message(message) for message in record.messages],
        pending_interrupt=PendingInterruptResponse.model_validate(record.pending_interrupt)
        if record.pending_interrupt
        else None,
        preview=collect_generated_assets(record.session.id),
    )


def build_api_response(record: RuntimeSessionRecord, data: Any = None) -> ApiResponse:
    assets = collect_generated_assets(record.thread_id)
    payload = data if data is not None else assets
    return ApiResponse(
        thread_id=record.thread_id,
        status=record.status,
        stage=record.stage,
        interrupt=InterruptView.model_validate(record.last_interrupt)
        if record.last_interrupt
        else None,
        data=payload,
        error=ApiError.model_validate(record.error) if record.error else None,
        session_meta=SessionMeta(
            created_at=record.created_at,
            updated_at=record.updated_at,
            generated_first_draft_pages=len(assets["first_draft_results"]),
            generated_final_ppt_pages=len(assets["final_ppt_results"]),
        ),
    )


def adapt_agent_response(thread_id: str, raw_response: dict[str, Any]) -> ApiResponse:
    record = get_runtime_session(thread_id)
    interrupt_payload = raw_response.get("__interrupt__")
    if interrupt_payload:
        normalized_interrupt = normalize_interrupt_payload(interrupt_payload)
        record.status = "interrupted"
        record.stage = map_interrupt_to_stage(normalized_interrupt)
        record.last_interrupt = build_interrupt_response(normalized_interrupt)
        record.error = None
        save_runtime_session(record)
        return build_api_response(record)

    record.status = "completed"
    record.stage = "completed"
    record.last_interrupt = None
    record.error = None
    save_runtime_session(record)
    return build_api_response(record)


async def run_generation(thread_id: str, action: str, payload: Any) -> ApiResponse:
    record = get_runtime_session(thread_id)
    record.status = "running"
    record.stage = action
    record.error = None
    save_runtime_session(record)
    try:
        if action == "starting":
            raw_response =await start_workflow(InputSchema(ppt_requirement=payload), thread_id)
        else:
            raw_response = await resume_workflow(thread_id, payload)
        return adapt_agent_response(thread_id, raw_response)
    except Exception as exc:  # noqa: BLE001
        record.status = "failed"
        record.stage = "failed"
        record.error = {"message": str(exc)}
        save_runtime_session(record)
        return build_api_response(record)


app = FastAPI(title="PPT Agent API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/sessions", response_model=SessionSummaryResponse)
def create_session() -> SessionSummaryResponse:
    record = get_active_store().create_session()
    ensure_session_dirs(record.id)
    print(f"Created new session with session_id: {record.id}")
    return map_session_summary(record)


@app.get("/api/sessions", response_model=list[SessionSummaryResponse])
def list_sessions() -> list[SessionSummaryResponse]:
    return [map_session_summary(record) for record in get_active_store().list_sessions()]


@app.get("/api/sessions/{session_id}", response_model=SessionDetailResponse)
def get_session(session_id: str) -> SessionDetailResponse:
    ensure_session_exists(session_id)
    return map_session_detail(get_active_store().get_session_detail(session_id))


@app.patch("/api/sessions/{session_id}", response_model=SessionSummaryResponse)
def rename_session(session_id: str, request: RenameSessionRequest) -> SessionSummaryResponse:
    title = request.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="title must not be blank")
    renamed = update_session_metadata(session_id, title=title)
    return map_session_summary(renamed)


@app.post("/api/ppt/start", response_model=ApiResponse)
async def start_ppt_generation(request: StartRequest) -> ApiResponse:
    return await run_generation(request.thread_id, "starting", request.ppt_requirement)


@app.post("/api/ppt/resume/ppt-info", response_model=ApiResponse)
async def resume_ppt_info(request: ResumePptInfoRequest) -> ApiResponse:
    return await run_generation(
        request.thread_id,
        "awaiting_content_sources",
        request.ppt_info.model_dump(),
    )


@app.post("/api/ppt/content-files")
def upload_content_files(
    thread_id: str = Form(...), files: list[UploadFile] = File(default_factory=list)
) -> dict[str, Any]:
    ensure_session_exists(thread_id)
    saved_files: list[dict[str, Any]] = []
    allowed_extensions = {".pdf", ".docx", ".markdown", ".md"}
    context_dir = ensure_session_dirs(thread_id) / "context_files"
    for upload in files:
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in allowed_extensions:
            raise HTTPException(status_code=400, detail=f"unsupported content file: {upload.filename}")
        safe_name = sanitize_filename(upload.filename or "upload.bin")
        destination = context_dir / safe_name
        write_upload_file(upload, destination)
        saved_files.append({"name": safe_name, "path": str(destination)})
    return {"thread_id": thread_id, "files": saved_files}


@app.post("/api/ppt/resume/content-sources", response_model=ApiResponse)
async def resume_content_sources(request: ResumeContentSourcesRequest) -> ApiResponse:
    payload = {
        "have_ppt_content_files": request.have_ppt_content_files,
        "ppt_content_source_urls": request.ppt_content_source_urls,
    }
    return await run_generation(request.thread_id, "awaiting_template", payload)


@app.post("/api/ppt/template")
def upload_template_file(
    thread_id: str = Form(...), file: UploadFile = File(...)
) -> dict[str, Any]:
    ensure_session_exists(thread_id)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".ppt", ".pptx"}:
        raise HTTPException(status_code=400, detail="template only supports .ppt or .pptx")
    template_dir = ensure_session_dirs(thread_id) / "template"
    destination = template_dir / f"template{suffix}"
    for old_file in template_dir.glob("template.*"):
        old_file.unlink()
    write_upload_file(file, destination)
    return {"thread_id": thread_id, "file": {"name": destination.name, "path": str(destination)}}


@app.post("/api/ppt/resume/template", response_model=ApiResponse)
async def resume_template(request: ResumeTemplateRequest) -> ApiResponse:
    return await run_generation(request.thread_id, "generating_outline", request.have_ppt_template)


@app.post("/api/ppt/resume/final-style", response_model=ApiResponse)
async def resume_final_style(request: ResumeFinalStyleRequest) -> ApiResponse:
    return await run_generation(request.thread_id, "generating_final_ppt", request.user_ppt_style)


@app.get("/api/ppt/status", response_model=ApiResponse)
def get_ppt_status(thread_id: str = Query(...)) -> ApiResponse:
    return build_api_response(get_runtime_session(thread_id))


@app.get("/api/ppt/svg/{thread_id}/{ppt_type}/{page}")
def get_svg_page(
    thread_id: str,
    ppt_type: Literal["first_draft", "final_ppt"],
    page: int,
) -> Response:
    ensure_session_exists(thread_id)
    svg_path = ensure_session_dirs(thread_id) / ppt_type / f"page_{page}.svg"
    if not svg_path.exists():
        raise HTTPException(status_code=404, detail="svg not found")
    return Response(content=svg_path.read_text(encoding="utf-8"), media_type="image/svg+xml")




@app.post("/api/ppt/modify", response_model=ApiResponse)
def modify_page(request: ModifyPageRequest) -> ApiResponse:
    record = get_runtime_session(request.thread_id)
    previous_stage = record.stage
    previous_status = record.status
    record.status = "running"
    record.stage = "modifying_page"
    record.error = None
    save_runtime_session(record)
    try:
        new_svg_list: list[dict[str, Any]] = []
        for page in request.pages:
            result = modify_ppt.invoke(
                {
                    "thread_id": request.thread_id,
                    "ppt_type": request.ppt_type,
                    "ppt_page": page,
                    "user_instruction": f"请只修改第{page}页。{request.user_instruction}",
                }
            )
            new_svg_list.append(result)

        record.status = previous_status if previous_status in {"interrupted", "completed"} else "completed"
        record.stage = previous_stage if previous_stage in {"awaiting_final_style", "completed"} else "completed"
        record.last_interrupt = None
        record.error = None
        save_runtime_session(record)
        return build_api_response(
            record,
            data={
                "response_content": f"已完成 {len(new_svg_list)} 页{request.ppt_type}修改。",
                "new_svg_list": new_svg_list,
                **collect_generated_assets(request.thread_id),
            },
        )
    except Exception as exc:  # noqa: BLE001
        record.status = "failed"
        record.stage = "failed"
        record.error = {"message": str(exc)}
        save_runtime_session(record)
        return build_api_response(record)
