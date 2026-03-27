import json
import os
import time
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

# done或者failed表示该文件解析完成
TERMINAL_STATES = {"done", "failed"}


class MinerUBatchClient:
    """MinerU batch parsing client based on the official v4 extract API."""

    def __init__(
        self,
        api_token: str,
        base_url: str = "https://mineru.net",
        timeout: float = 60.0,
    ) -> None:
        if not api_token:
            raise ValueError(
                "缺少 MinerU API Token，请设置 MINERU_API_TOKEN 环境变量。"
            )
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.client = httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            headers={
                "Authorization": f"Bearer {api_token}",
                "Content-Type": "application/json",
            },
        )

    @classmethod
    def from_env(cls) -> "MinerUBatchClient":
        return cls(
            api_token=os.environ.get("MINERU_API_TOKEN", ""),
            base_url=os.environ.get("MINERU_API_BASE_URL", "https://mineru.net"),
            timeout=float(os.environ.get("MINERU_API_TIMEOUT", "60")),
        )

    def request_upload_urls(
        self,
        file_paths: list[Path],
        *,
        language: str | None = "ch",
    ) -> dict[str, Any]:
        files = []
        for index, file_path in enumerate(file_paths, start=1):
            files.append(
                {
                    "name": file_path.name,
                    # "data_id": f"{index}-{file_path.stem}",
                    "is_ocr": self._should_use_ocr(file_path),
                }
            )

        payload: dict[str, Any] = {"files": files}
        payload["model_version"] = "vlm"
        if language:
            payload["language"] = language

        response = self.client.post("/api/v4/file-urls/batch", json=payload)
        response.raise_for_status()
        result = response.json()
        if result.get("code") != 0:
            raise RuntimeError(
                f"MinerU 申请上传链接失败: {result.get('msg') or result.get('message') or result}"
            )

        data = result.get("data", {})
        upload_urls = data.get("file_urls")or []
        batch_id = data.get("batch_id")
        if not batch_id or len(upload_urls) != len(file_paths):
            raise RuntimeError(
                f"MinerU 返回的上传链接不完整: {json.dumps(result, ensure_ascii=False)}"
            )
        return {"batch_id": batch_id, "upload_urls": upload_urls, "raw": result}

    def upload_files(
        self,
        file_paths: list[Path],
        upload_urls: list[str],
    ) -> None:
        for file_path, upload_url in zip(file_paths, upload_urls, strict=True):
            with file_path.open("rb") as fh:
                response = httpx.put(
                    upload_url, content=fh.read(), timeout=self.timeout
                )
            response.raise_for_status()

    def get_batch_result(self, batch_id: str) -> dict[str, Any]:
        response = self.client.get(f"/api/v4/extract-results/batch/{batch_id}")
        response.raise_for_status()
        result = response.json()
        if result.get("code") != 0:
            raise RuntimeError(
                f"MinerU 查询批量任务失败: {result.get('msg') or result.get('message') or result}"
            )
        return result

    def wait_for_batch_result(
        self,
        batch_id: str,
        *,
        poll_interval: float = 1.0,
        timeout: float = 1800.0,
    ) -> dict[str, Any]:
        started_at = time.monotonic()
        while True:
            result = self.get_batch_result(batch_id)
            extract_results = result.get("data", {}).get("extract_result", [])
            if extract_results and self._all_finished(extract_results):
                return result

            if timeout > 0 and time.monotonic() - started_at > timeout:
                raise TimeoutError(f"等待 MinerU 解析完成超时，batch_id={batch_id}")
            time.sleep(poll_interval)

    def download_result_archives(
        self,
        extract_results: list[dict[str, Any]],
        output_dir: Path,
        *,
        overwrite: bool = True,
    ) -> list[dict[str, Any]]:
        output_dir.mkdir(parents=True, exist_ok=True)
        downloads: list[dict[str, Any]] = []

        for item in extract_results:
            state = str(item.get("state", "")).lower()
            name = item.get("file_name") or item.get("data_id") or "unknown"
            file_output_dir = output_dir / Path(name).stem
            full_zip_url = item.get("full_zip_url")
            if state != "done" or not full_zip_url:
                downloads.append(
                    {
                        "file_name": name,
                        "state": state,
                        "error": item.get("err_msg") or item.get("message"),
                    }
                )
                continue

            file_output_dir.mkdir(parents=True, exist_ok=True)
            zip_name = (
                Path(urlparse(full_zip_url).path).name or f"{Path(name).stem}.zip"
            )
            zip_path = file_output_dir / zip_name
            if overwrite or not zip_path.exists():
                with httpx.stream(
                    "GET", full_zip_url, timeout=self.timeout
                ) as response:
                    response.raise_for_status()
                    with zip_path.open("wb") as fh:
                        for chunk in response.iter_bytes():
                            fh.write(chunk)
            else:
                print(f"文件已存在，跳过下载: {zip_path}")
            extracted_dir = file_output_dir / "extracted"
            if overwrite and extracted_dir.exists():
                for child in sorted(extracted_dir.rglob("*"), reverse=True):
                    if child.is_file():
                        child.unlink()
                    elif child.is_dir():
                        child.rmdir()
            extracted_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path) as archive:
                archive.extractall(extracted_dir)
            #删除 zip 文件
            zip_path.unlink()  
            full_md_path = self._find_first_file(extracted_dir, "full.md")
            downloads.append(
                {
                    "file_name": name,
                    "state": state,
                    "zip_path": str(zip_path),
                    "output_dir": str(extracted_dir),
                    "full_md_path": str(full_md_path) if full_md_path else None,
                }
            )

        return downloads

    def batch_parse_local_files(
        self,
        file_paths: list[str | Path],
        output_dir: str | Path,
        *,
        poll_interval: float = 1.0,
        timeout: float = 1800.0,
        enable_formula: bool | None = None,
        language: str | None = None,
    ) -> dict[str, Any]:
        normalized_paths = [Path(path).expanduser().resolve() for path in file_paths]
        if not normalized_paths:
            raise ValueError("没有可上传的文件。")
        for file_path in normalized_paths:
            if not file_path.is_file():
                raise ValueError(f"文件不存在或不是普通文件: {file_path}")

        upload_result = self.request_upload_urls(
            normalized_paths,
            language=language,
        )
        batch_id = upload_result["batch_id"]
        self.upload_files(normalized_paths, upload_result["upload_urls"])
        final_result = self.wait_for_batch_result(
            batch_id,
            poll_interval=poll_interval,
            timeout=timeout,
        )
        extract_results = final_result.get("data", {}).get("extract_result", [])
        downloads = self.download_result_archives(extract_results, Path(output_dir))
        return {
            "batch_id": batch_id,
            "result": final_result,
            "downloads": downloads,
        }

    @staticmethod
    def _all_finished(extract_results: list[dict[str, Any]]) -> bool:
        states = {str(item.get("state", "")).lower() for item in extract_results}
        return states.issubset(TERMINAL_STATES)

    @staticmethod
    def _should_use_ocr(file_path: Path) -> bool:
        return file_path.suffix.lower() in {
            ".pdf",
            ".png",
            ".jpg",
            ".jpeg",
            ".bmp",
            ".tiff",
            ".webp",
        }

    @staticmethod
    def _find_first_file(root: Path, file_name: str) -> Path | None:
        matches = list(root.rglob(file_name))
        return matches[0] if matches else None
