import shutil
import uuid
from typing import Any, Dict, Literal, Annotated,Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile, Form
from pydantic import BaseModel, Field

from agent.app import InputSchema, TimeLine, get_status, resume_workflow, start_workflow
import os
from pathlib import Path

app = FastAPI()


class ResumePPTInfoRequest(BaseModel):
    thread_id: str
    user_input: Optional[Dict[str, Any]]
    

class ResumeUploadPPTContentFilesRequest(BaseModel):
    thread_id: str
    have_ppt_content_files: bool


class StartRequest(BaseModel):
    theme: str
    thread_id: str


class ChatRequest(BaseModel):
    thread_id: str
    user_message: str
    timeline: TimeLine
    # files 可选
    # files:[str] = Field(default_factory=list)


@app.post("/resume_ppt_info")
def resume_ppt_info(req: ResumePPTInfoRequest):
    try:
        return resume_workflow(req.thread_id, req.user_input)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.post("/resume_upload_ppt_content_files")
def resume_upload_ppt_content_files(req: ResumeUploadPPTContentFilesRequest):
    try:
        return resume_workflow(req.thread_id, req.have_ppt_content_files)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# def upload_ppt_content_files(file):
#     # 这里可以实现文件的上传逻辑，例如保存到服务器或者云存储，并返回文件的URL
#     file_url = f"http://example.com/files/{file.filename}"
#     return file_url


@app.post("/upload_ppt_content_files")
async def upload_ppt_content_files(
    files: Annotated[list[UploadFile], File(...)],
    thread_id: Annotated[str, Form(...)],
    timeline: Annotated[str, Form(...)],
):
    MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
    save_dir = Path(f"user_data/{thread_id}/context_files")
    files_info = []
    save_dir.mkdir(parents=True, exist_ok=True)

    try:
        for file in files:
            if file.size > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=413,
                    detail=f"文件 {file.filename} 超过最大限制 {MAX_FILE_SIZE / (1024 * 1024)} MB",
                )
        for i, file in enumerate(files):
            file_path = save_dir / Path(file.filename).suffix
            with file_path.open("wb") as buffer:
                while chunk := await file.read(1024 * 1024):  # 1 MB
                    buffer.write(chunk)
            file_size = os.path.getsize(file_path)
            files_info.append(
                {
                    "filename": file.filename,
                    "content_type": file.content_type,
                    "size_bytes": file_size,
                    "saved_path": file_path,
                }
            )

        return {
            "status": "success",
            "message": f"文件 {','.join([file_info['filename'] for file_info in files_info])} 上传成功",
            "files_info": files_info,
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}

    finally:
        # 确保在使用完后关闭文件对象
        file.file.close()


@app.post("/chat")
def chat(req: ChatRequest):
    try:
        if req.timeline == TimeLine.NO_START:
            return start_workflow(InputSchema(theme=req.user_message), req.thread_id)
        else:
            pass
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/init_session")
def init_session():
    thread_id = str(uuid.uuid4())
    return {"thread_id": thread_id}


@app.get("/timeline/")
def get_timeline(thread_id: str):
    # 这里可以根据 thread_id 从数据库或者内存中获取当前的状态
    # 例如，返回 "no_start", "awaiting_info", "generating_ppt", "completed" 等状态
    print("thread_id for timeline:", thread_id)
    current_timeline = get_status(thread_id)
    return {"current_timeline": current_timeline}


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["backend", "agent"],
        app_dir="/data3/zwc/ppt-agent",
    )
