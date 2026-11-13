import csv
import io
import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from pydantic import BaseModel

from app.config import get_settings
from app.db import repositories
from app.db.records import (
    BatchRecord,
    NewBatch,
    NewScanJob,
    NewTest,
    ScanJobRecord,
    ScanResultRecord,
    TestRecord,
)
from app.grading_pipeline.corrections import apply_scan_corrections
from app.grading_pipeline.grade_scan_job import grade_scan_job

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class CreateTestRequest(BaseModel):
    name: str
    template_id: str
    answer_key: list[str]


class CorrectionsRequest(BaseModel):
    corrections: dict[int, str]


class IdentityRequest(BaseModel):
    name_text: str | None = None
    date_text: str | None = None
    section_text: str | None = None


tests_router = APIRouter(prefix="/tests", tags=["tests"])
batches_router = APIRouter(prefix="/batches", tags=["batches"])
scans_router = APIRouter(prefix="/scans", tags=["scans"])
review_router = APIRouter(prefix="/review-queue", tags=["review"])


@tests_router.post("", status_code=201)
def create_test_endpoint(payload: CreateTestRequest) -> TestRecord:
    return repositories.create_test(
        NewTest(
            name=payload.name,
            template_id=payload.template_id,
            answer_key=payload.answer_key,
        )
    )


@tests_router.post("/{test_id}/batches", status_code=201)
def create_batch_endpoint(test_id: int) -> BatchRecord:
    return repositories.create_batch(NewBatch(test_id=test_id))


@batches_router.post("/{batch_id}/scans", status_code=201)
async def upload_scan_endpoint(batch_id: int, file: UploadFile = File(...)) -> ScanJobRecord:
    repositories.get_batch(batch_id)
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=422, detail=f"Unsupported content type: {file.content_type}"
        )

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=422, detail="Invalid scan file size.")

    suffix = ".png" if file.content_type == "image/png" else ".jpg"
    raw_dir = Path(get_settings().autograde_data_dir) / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_path = raw_dir / f"batch_{batch_id}_{uuid4().hex}{suffix}"
    raw_path.write_bytes(content)

    return repositories.create_scan_job(
        NewScanJob(batch_id=batch_id, raw_image_path=str(raw_path))
    )


@batches_router.get("/{batch_id}/results")
def list_batch_results_endpoint(batch_id: int) -> list[ScanResultRecord]:
    return repositories.list_scan_results_for_batch(batch_id)


def _escape_csv_cell(value: str) -> str:
    return f"'{value}" if value.startswith(("=", "+", "-", "@")) else value


@batches_router.get("/{batch_id}/export.csv")
def export_batch_csv_endpoint(batch_id: int) -> Response:
    batch = repositories.get_batch(batch_id)
    test = repositories.get_test(batch.test_id)
    results = repositories.list_scan_results_for_batch(batch_id)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "name",
            "date",
            "section",
            "score",
            "needs_review",
            *(f"q{i}" for i in range(1, test.question_count + 1)),
        ]
    )
    for result in results:
        raw_answers = json.loads(result.answers_json)
        corrections = repositories.get_scan_corrections(result.scan_job_id)
        answers = [
            corrections.get(i, raw_answers[i - 1] if i - 1 < len(raw_answers) else "")
            for i in range(1, test.question_count + 1)
        ]
        writer.writerow(
            [
                _escape_csv_cell(result.name_text),
                _escape_csv_cell(result.date_text),
                _escape_csv_cell(result.section_text),
                result.score,
                result.needs_review,
                *(_escape_csv_cell(a) for a in answers),
            ]
        )
    return Response(content=buf.getvalue(), media_type="text/csv")


@scans_router.post("/{scan_job_id}/grade")
def grade_scan_endpoint(scan_job_id: int, force: bool = False) -> ScanResultRecord:
    return grade_scan_job(scan_job_id, force=force)


@scans_router.patch("/{scan_job_id}/corrections")
def apply_corrections_endpoint(
    scan_job_id: int, payload: CorrectionsRequest
) -> ScanResultRecord:
    return apply_scan_corrections(scan_job_id, payload.corrections)


@scans_router.patch("/{scan_job_id}/identity")
def update_identity_endpoint(
    scan_job_id: int, payload: IdentityRequest
) -> ScanResultRecord:
    return repositories.update_scan_identity(
        scan_job_id,
        name_text=payload.name_text,
        date_text=payload.date_text,
        section_text=payload.section_text,
    )


@review_router.get("")
def list_review_queue_endpoint() -> list[ScanResultRecord]:
    return repositories.list_scan_results_needing_review()
