"""Endpoints for inspecting and syncing `<repo>/workspace/` on disk."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.answer_sheet_templates.catalog import get_template_spec
from app.config import get_settings
from app.workspace_storage import (
    ensure_workspace_layout,
    get_workspace_status,
    prune_orphaned_scan_artifacts,
    read_workspace_json,
    write_workspace_json,
)

MAX_WORKSPACE_JSON_BYTES = 20 * 1024 * 1024
REQUIRED_LIST_FIELDS = ("quizzes", "batches", "papers", "sections", "students")

workspace_router = APIRouter(prefix="/workspace", tags=["workspace"])


def _workspace_dirs() -> tuple[Path, Path]:
    settings = get_settings()
    return Path(settings.autograde_workspace_dir), Path(settings.autograde_data_dir) / "templates"


def _validate_workspace_payload(raw_body: bytes) -> dict[str, Any]:
    if len(raw_body) > MAX_WORKSPACE_JSON_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Workspace JSON exceeds 20 MB limit.",
        )
    try:
        parsed = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid JSON payload.") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="Workspace payload must be a JSON object.")

    version = parsed.get("exportVersion")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise HTTPException(status_code=422, detail="Invalid or missing exportVersion.")

    for field_name in REQUIRED_LIST_FIELDS:
        if not isinstance(parsed.get(field_name), list):
            raise HTTPException(
                status_code=422,
                detail=f"Workspace field '{field_name}' must be an array.",
            )

    return parsed


@workspace_router.get("/status")
def workspace_status_endpoint() -> dict[str, Any]:
    ws_dir, templates_src = _workspace_dirs()
    ensure_workspace_layout(ws_dir, templates_src)
    return get_workspace_status(ws_dir)


@workspace_router.get("/data")
def workspace_get_data_endpoint() -> dict[str, Any]:
    ws_dir, templates_src = _workspace_dirs()
    ensure_workspace_layout(ws_dir, templates_src)
    data = read_workspace_json(ws_dir)
    if data is None:
        raise HTTPException(status_code=404, detail="No workspace.json found on disk.")
    return data


@workspace_router.put("/data")
async def workspace_put_data_endpoint(request: Request) -> dict[str, Any]:
    raw_body = await request.body()
    payload = _validate_workspace_payload(raw_body)
    ws_dir, templates_src = _workspace_dirs()
    ensure_workspace_layout(ws_dir, templates_src)
    written_path = write_workspace_json(ws_dir, payload)
    prune_orphaned_scan_artifacts(ws_dir, payload)
    return {
        "ok": True,
        "path": str(written_path),
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }


@workspace_router.get("/templates/{template_id}")
def workspace_download_template_endpoint(template_id: str) -> FileResponse:
    get_template_spec(template_id)
    ws_dir, templates_src = _workspace_dirs()
    ensure_workspace_layout(ws_dir, templates_src)
    pdf_path = ws_dir / "templates" / f"{template_id}.pdf"
    if not pdf_path.is_file():
        raise HTTPException(
            status_code=404, detail=f"Printable PDF for template '{template_id}' not found."
        )
    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=f"AutoGradeQuiz_{template_id}.pdf",
    )
