from __future__ import annotations

import base64
from pathlib import Path

import cv2
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from app.answer_sheet_templates.catalog import get_template_spec
from app.answer_sheet_templates.exceptions import UnknownTemplateError
from app.answer_sheet_templates.geometry import KEY_VERSION_CHOICES
from app.grading_pipeline.exceptions import InvalidAnswerKeyError, ScanImageUnreadableError
from app.routers import stateless_router
from app.scan_alignment.align_scan import ScanAlignmentError
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.workspace_router import workspace_router

app = FastAPI(title="AutoGradeQuiz Stateless Grader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(InvalidAnswerKeyError)
@app.exception_handler(UnknownTemplateError)
@app.exception_handler(ScanImageUnreadableError)
@app.exception_handler(ScanAlignmentError)
def handle_unprocessable(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


app.include_router(stateless_router)
app.include_router(workspace_router)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse(url="/test-ui")


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


TEST_UI_HTML_PATH = Path(__file__).with_name("test_ui.html")


@app.get("/test-ui", response_class=HTMLResponse, include_in_schema=False)
def backend_test_ui() -> HTMLResponse:
    return HTMLResponse(content=TEST_UI_HTML_PATH.read_text(encoding="utf-8"))


class SyntheticSheetRequest(BaseModel):
    template_id: str = "20q_a4"
    seed: int = 0
    name_text: str = "Dela Cruz, Juan"
    student_id_text: str = "0123456789"
    section_text: str = "10-Rizal"
    date_text: str = "2026-11-18"
    key_version: str = ""
    include_png: bool = False


@app.post("/test-ui/synthetic-sheet", include_in_schema=False)
def create_synthetic_sheet_endpoint(payload: SyntheticSheetRequest) -> dict[str, object]:
    """Generate a synthetic answer sheet JPEG (and optional PNG) for the /test-ui sandbox."""
    spec = get_template_spec(payload.template_id)
    raw_kv = (payload.key_version or "").strip().upper()
    if raw_kv and raw_kv not in KEY_VERSION_CHOICES:
        raise InvalidAnswerKeyError(f"Unknown key version '{payload.key_version}'.")
    header_values = {
        "name": payload.name_text,
        "student_id": payload.student_id_text,
        "section": payload.section_text,
        "date": payload.date_text,
    }
    sheet = generate_synthetic_sheet(
        spec,
        payload.seed,
        header_values=header_values,
        key_version=raw_kv,
    )
    ok_jpg, jpg_buf = cv2.imencode(".jpg", sheet.image, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok_jpg:
        raise RuntimeError("Failed to encode synthetic sheet JPEG.")

    response: dict[str, object] = {
        "template_id": spec.template_id,
        "seed": payload.seed,
        "key_version": raw_kv or "A",
        "name_text": payload.name_text,
        "student_id_text": payload.student_id_text,
        "section_text": payload.section_text,
        "date_text": payload.date_text,
        "answer_key": sheet.answer_key,
        "marked_choices": ["".join(plan.marked_choices) for plan in sheet.question_plans],
        "jpeg_base64": base64.b64encode(jpg_buf.tobytes()).decode("ascii"),
    }
    if payload.include_png:
        ok_png, png_buf = cv2.imencode(".png", sheet.image)
        if not ok_png:
            raise RuntimeError("Failed to encode synthetic sheet PNG.")
        response["png_base64"] = base64.b64encode(png_buf.tobytes()).decode("ascii")
    return response
