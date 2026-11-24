from typing import Any

import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.answer_sheet_templates.catalog import get_template_spec
from app.bubble_grading.classifier import BubbleResult, classify_sheet
from app.grading_pipeline.exceptions import ScanImageUnreadableError
from app.grading_pipeline.pipeline import (
    ResolvedKeySpec,
    grade_image_with_versions,
    scan_job_needs_review,
)
from app.scan_alignment.aligner import align_scan

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class ScanKeyResponse(BaseModel):
    template_id: str
    answer_key: list[str]
    flagged_questions: list[int]


stateless_router = APIRouter(tags=["grading"])


async def read_and_decode_image(file: UploadFile) -> tuple[np.ndarray, bytes, str]:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=422, detail=f"Unsupported content type: {file.content_type}"
        )

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=422, detail="Invalid scan file size.")

    decoded = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise ScanImageUnreadableError("Could not decode uploaded scan image.")
    raw_ext = ".png" if file.content_type == "image/png" else ".jpg"
    return decoded, content, raw_ext


def encode_downscaled_jpeg_bytes(image: np.ndarray, max_dim: int = 1200) -> bytes:
    height, width = image.shape[:2]
    largest = max(height, width)
    preview = image
    if largest > max_dim:
        scale = max_dim / largest
        preview = cv2.resize(
            image,
            (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
            interpolation=cv2.INTER_AREA,
        )
    ok, buf = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        raise RuntimeError("Failed to encode aligned preview JPEG.")
    return buf.tobytes()


def _scan_key_sync(decoded: np.ndarray, template_spec) -> ScanKeyResponse:
    aligned = align_scan(decoded, template_spec)
    fills = classify_sheet(aligned, template_spec)
    answer_key: list[str] = []
    flagged_questions: list[int] = []
    for q_num in range(1, template_spec.question_count + 1):
        fill = fills[q_num]
        answer_key.append("+".join(fill.marked_choices))
        if fill.result != BubbleResult.FILLED:
            flagged_questions.append(q_num)

    return ScanKeyResponse(
        template_id=template_spec.template_id,
        answer_key=answer_key,
        flagged_questions=flagged_questions,
    )


def grade_decoded_sheet(
    decoded: np.ndarray,
    template_spec,
    primary_key: ResolvedKeySpec,
    key_versions: dict[str, ResolvedKeySpec],
) -> tuple[dict[str, Any], bytes]:
    execution = grade_image_with_versions(
        decoded,
        template_spec,
        primary_key=primary_key,
        key_versions=key_versions,
    )
    aligned_jpeg_bytes = encode_downscaled_jpeg_bytes(execution.aligned_image)

    ordered = sorted(execution.question_fills.items())
    answers = ["+".join(fill.marked_choices) for _, fill in ordered]
    flags = {
        q_num: fill.result.value
        for q_num, fill in ordered
        if fill.result in (BubbleResult.AMBIGUOUS, BubbleResult.MULTIPLE)
    }
    confidence = [round(fill.confidence, 4) for _, fill in ordered]
    multi_key = len(key_versions) > 1
    needs_review = scan_job_needs_review(execution.question_fills) or (
        multi_key and execution.key_version_flagged
    )

    payload: dict[str, Any] = {
        "answers": answers,
        "flags": flags,
        "confidence": confidence,
        "score": execution.score_summary.score_fraction * 100.0,
        "needs_review": needs_review,
        "key_version": execution.active_key.version,
        "key_version_detected": execution.detected_key_version,
        "key_version_flagged": execution.key_version_flagged,
        "name_text": execution.text_fields.get("name", ""),
        "date_text": execution.text_fields.get("date", ""),
        "class_text": execution.text_fields.get("class", ""),
        "student_id_text": execution.text_fields.get("student_id", ""),
    }
    return payload, aligned_jpeg_bytes


@stateless_router.post("/scan-key")
async def scan_key_endpoint(
    template_id: str,
    file: UploadFile = File(...),
) -> ScanKeyResponse:
    template_spec = get_template_spec(template_id)
    decoded, _, _ = await read_and_decode_image(file)
    return await run_in_threadpool(_scan_key_sync, decoded, template_spec)
