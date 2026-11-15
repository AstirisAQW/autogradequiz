from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator
from uuid import uuid4

import cv2
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from app.answer_sheet_templates.catalog import get_template_spec
from app.answer_sheet_templates.exceptions import UnknownTemplateError
from app.config import get_settings
from app.db import repositories
from app.db.connection import init_db
from app.db.exceptions import (
    BatchNotFoundError,
    InvalidCorrectionError,
    InvalidTestError,
    ScanJobNotFoundError,
    ScanResultNotFoundError,
    TestNotFoundError,
)
from app.db.records import NewScanJob
from app.grading_pipeline.exceptions import (
    ScanImageUnreadableError,
    ScanJobAlreadyGradedError,
)
from app.grading_pipeline.grade_scan_job import grade_scan_job
from app.routers import batches_router, review_router, scans_router, tests_router
from app.scan_alignment.align_scan import ScanAlignmentError
from app.synthetic_sheets.generator import generate_synthetic_sheet


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(title="AutoGradeQuiz Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "tauri://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(TestNotFoundError)
@app.exception_handler(BatchNotFoundError)
@app.exception_handler(ScanJobNotFoundError)
@app.exception_handler(ScanResultNotFoundError)
def handle_not_found(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ScanJobAlreadyGradedError)
def handle_conflict(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(InvalidTestError)
@app.exception_handler(InvalidCorrectionError)
@app.exception_handler(UnknownTemplateError)
@app.exception_handler(ScanImageUnreadableError)
@app.exception_handler(ScanAlignmentError)
def handle_unprocessable(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


app.include_router(tests_router)
app.include_router(batches_router)
app.include_router(scans_router)
app.include_router(review_router)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse(url="/test-ui")


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


class SyntheticScanRequest(BaseModel):
    seed: int = 0
    grade: bool = True


@app.get("/test-ui", include_in_schema=False)
def test_ui() -> HTMLResponse:
    return HTMLResponse(Path(__file__).with_name("test_ui.html").read_text(encoding="utf-8"))


@app.get("/test-ui/synthetic-sheet", include_in_schema=False)
def download_synthetic_sheet(template_id: str = "20q_a4", seed: int = 0) -> Response:
    spec = get_template_spec(template_id)
    sheet = generate_synthetic_sheet(spec, seed)
    ok, buf = cv2.imencode(".png", sheet.image)
    if not ok:
        raise RuntimeError("Failed to encode synthetic sheet PNG.")
    filename = f"{template_id}_seed_{seed:04d}.png"
    return Response(
        content=buf.tobytes(),
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/test-ui/batches/{batch_id}/synthetic-scans", include_in_schema=False)
def create_synthetic_scan(batch_id: int, payload: SyntheticScanRequest) -> dict[str, object]:
    batch = repositories.get_batch(batch_id)
    test = repositories.get_test(batch.test_id)
    spec = get_template_spec(test.template_id)
    sheet = generate_synthetic_sheet(spec, payload.seed, answer_key=test.answer_key)

    ok, buf = cv2.imencode(".png", sheet.image)
    if not ok:
        raise RuntimeError("Failed to encode synthetic sheet PNG.")

    raw_dir = Path(get_settings().autograde_data_dir) / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_path = raw_dir / f"batch_{batch_id}_{uuid4().hex}.png"
    raw_path.write_bytes(buf.tobytes())

    job = repositories.create_scan_job(NewScanJob(batch_id=batch_id, raw_image_path=str(raw_path)))
    result = grade_scan_job(job.id) if payload.grade else None
    return {
        "scan_job_id": job.id,
        "seed": payload.seed,
        "marked_choices": ["".join(plan.marked_choices) for plan in sheet.question_plans],
        "result": result,
    }
