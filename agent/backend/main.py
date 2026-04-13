import os
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

import aiosqlite
from aiosqlitepool import SQLiteConnectionPool
from fastapi import Body, FastAPI, File, Form, HTTPException, Path, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.sse import ServerSentEvent
from pydantic import BaseModel, Field

from agent.bridge import resume_ppt_agent, start_ppt_agent
from agent.config import get_config
from agent.ppt_agent import PPTAgent
from agent.types import LayoutType
from agent.utils import generate_thread_id, is_development, save_file


async def connection_factory():
    config = get_config()
    return await aiosqlite.connect(config["checkpoint_path"])


@asynccontextmanager
async def lifespan(app: FastAPI):

    if is_development():
        app.state.agent = await PPTAgent.create(pool=None)
    else:
        pool = SQLiteConnectionPool(connection_factory)
        app.state.agent = await PPTAgent.create(pool)

    yield

    if not is_development():
        await pool.close()


app = FastAPI(
    title="PPT Agent API", version="0.1.0", root_path="/api", lifespan=lifespan
)


@app.get("/create_session_id")
def create_session_id() -> dict[str, str]:
    return {"thread_id": generate_thread_id()}


@app.get("/layout_styles")
def get_layout_styles():
    # options = [layout.value for layout in LayoutType]

    return {"layout_styles": LayoutType.__args__}


@app.post("/upload/content_files")
def upload_content_files(
    thread_id: str = Form(...), files: list[UploadFile] = File(default_factory=list)
) -> dict[str, Any]:
    saved_files: list[dict[str, Any]] = []
    allowed_extensions = {".pdf", ".docx", ".markdown", ".md"}
    # 最大20MB
    MAX_FILE_SIZE = 1024 * 1024 * 20
    # 确认文件没问题
    for file in files:
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"unsupported content file: {file.filename},only support {allowed_extensions}",
            )

        if file.size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"file size exceeds limit: {file.filename}, max size is {MAX_FILE_SIZE / 1024 / 1024} MB",
            )
    # 保存文件
    ppt_content_dir = Path(
        os.getenv("USER_DATA_ROOT_DIR", "./user_data"), thread_id, "context_files"
    )
    ppt_content_dir.mkdir(parents=True, exist_ok=True)
    if any(ppt_content_dir.iterdir()):
        raise HTTPException(
            status_code=400,
            detail=f"content files already upload for current session:{thread_id},please create a new session",
        )
    for i, file in enumerate(files, start=1):
        suffix = Path(file.filename or "").suffix.lower()
        new_file_path = Path(ppt_content_dir) / f"{i}{suffix}"
        save_file(new_file_path, file.file)

    return {"thread_id": thread_id, "file_dir": ppt_content_dir, "status": "success"}


@app.post("/upload/ppt_template")
def upload_ppt_template(
    file: UploadFile,
    thread_id: str = Form(...),
) -> dict[str, Any]:  # 这个接口目前没什么用，先放着
    allowed_extensions = {".pptx", ".ppt"}
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported ppt template file: {file.filename},only support {allowed_extensions}",
        )
    ppt_template_dir = Path(
        os.getenv("USER_DATA_ROOT_DIR", "./user_data"), thread_id, "template"
    )
    ppt_template_dir.mkdir(parents=True, exist_ok=True)
    template_file_path = ppt_template_dir / f"template{suffix}"
    save_file(template_file_path, file.file)
    return {
        "thread_id": thread_id,
        "template_file_path": template_file_path,
        "status": "success",
    }


ChatType = Literal["start", "hitl_resume", "abort_resume"]


class ChatRequest(BaseModel):
    thread_id: str = Field(..., description="会话ID")
    type: ChatType = Field(
        description="start 表示工作流开始，hitl_resume表示中断后继续，abort_resume表示用户手动中止之后继续执行"
    )
    user_input: dict[str, Any] | None | str = Field(
        None,
        description="type=start时，为str,type=hitl_resume时,为dict，type=abort_resume时，为None。",
    )


@app.post("/chat")
async def chat(
    request: Annotated[ChatRequest, Body(embed=False)],
) -> AsyncIterable[ServerSentEvent]:
    agent = app.state.agent
    thread_id = request.thread_id
    chat_type = request.type
    user_input = request.user_input

    if chat_type == "start":
        async for chunk in start_ppt_agent(
            agent,
            ppt_requirement=user_input,
            thread_id=thread_id,
        ):
            yield chunk

    elif chat_type == "hitl_resume":
        async for chunk in resume_ppt_agent(
            agent,
            user_input=user_input,
            thread_id=thread_id,
        ):
            yield chunk
    elif chat_type == "abort_resume":
        async for chunk in resume_ppt_agent(
            agent,
            user_input=None,
            thread_id=thread_id,
        ):
            yield chunk


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        reload_includes="./backend/*.py",
    )
