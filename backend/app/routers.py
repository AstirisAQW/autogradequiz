import base64
import json
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.answer_sheet_templates.catalog import get_template_spec, list_template_specs
from app.answer_sheet_templates.geometry import KEY_VERSION_CHOICES
from app.bubble_grading.classifier import BubbleResult, classify_sheet
from app.bubble_grading.overlay import render_graded_overlay
from app.config import get_settings
from app.grading_pipeline.exceptions import InvalidAnswerKeyError, ScanImageUnreadableError
from app.grading_pipeline.grade_scan_job import (
    ResolvedKeySpec,
    grade_image_with_versions,
    normalize_question_rules,
    scan_job_needs_review,
    validate_answer_key_and_points,
)
from app.scan_alignment.align_scan import align_scan
from app.workspace_storage import ensure_workspace_layout, save_scan_artifacts

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class ScanKeyResponse(BaseModel):
    template_id: str
    answer_key: list[str]
    flagged_questions: list[int]


class TemplateInfo(BaseModel):
    template_id: str
    question_count: int


class StatelessGradeResponse(BaseModel):
    answers: list[str]
    flags: dict[int, str]
    confidence: list[float]
    score: float
    needs_review: bool
    key_version: str = "A"
    key_version_detected: str = ""
    key_version_flagged: bool = False
    name_text: str
    date_text: str
    section_text: str
    student_id_text: str = ""
    aligned_image_jpeg_base64: str
    graded_image_jpeg_base64: str = ""
    workspace_paths: dict[str, str] | None = None


stateless_router = APIRouter(tags=["grading"])


async def _read_and_decode_image(file: UploadFile) -> tuple[np.ndarray, bytes, str]:
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


def _validate_single_key_payload(
    version: str,
    payload: dict,
    question_count: int,
    default_points: list[float] | None = None,
) -> ResolvedKeySpec:
    choices = payload.get("answer_key", payload.get("answerKey"))
    points = payload.get("points")
    if not isinstance(choices, list) or not all(isinstance(c, str) for c in choices):
        raise InvalidAnswerKeyError("answer_key must be a list of choice strings.")
    if points is not None and (
        not isinstance(points, list)
        or not all(isinstance(p, (int, float)) and not isinstance(p, bool) for p in points)
    ):
        raise InvalidAnswerKeyError("points must be a list of numbers.")

    norm_key, norm_pts = validate_answer_key_and_points(
        question_count, choices, points if points is not None else default_points
    )
    rules_raw = payload.get("question_rules", payload.get("questionRules"))
    norm_rules = normalize_question_rules(question_count, rules_raw)
    return ResolvedKeySpec(
        version=version,
        answer_key=norm_key,
        points=norm_pts,
        question_rules=norm_rules,
    )


def _reject_json_constant(value: str) -> None:
    raise InvalidAnswerKeyError(f"Non-finite constant '{value}' is not allowed in answer_key.")


def _parse_stateless_answer_key(
    raw_json: str, question_count: int
) -> tuple[ResolvedKeySpec, dict[str, ResolvedKeySpec]]:
    try:
        parsed = json.loads(raw_json, parse_constant=_reject_json_constant)
    except json.JSONDecodeError as exc:
        raise InvalidAnswerKeyError("answer_key must be valid JSON.") from exc

    if not isinstance(parsed, dict) or "answer_key" not in parsed:
        raise InvalidAnswerKeyError(
            'answer_key must be a JSON object with {"answer_key": [...], "points": [...]}.'
        )

    primary = _validate_single_key_payload("A", parsed, question_count)
    versions: dict[str, ResolvedKeySpec] = {"A": primary}

    raw_versions = parsed.get("key_versions", parsed.get("keyVersions"))
    if raw_versions is not None:
        if not isinstance(raw_versions, dict):
            raise InvalidAnswerKeyError("key_versions must be an object keyed by A-D.")
        for raw_ver, ver_payload in raw_versions.items():
            ver = str(raw_ver).strip().upper()
            if ver not in KEY_VERSION_CHOICES:
                raise InvalidAnswerKeyError(f"Unknown key version '{raw_ver}'.")
            if not isinstance(ver_payload, dict):
                raise InvalidAnswerKeyError(
                    f"Key version '{ver}' must be an object."
                )
            versions[ver] = _validate_single_key_payload(
                ver, ver_payload, question_count, default_points=primary.points
            )

    return versions["A"], versions


def _encode_downscaled_jpeg_bytes(image: np.ndarray, max_dim: int = 1200) -> bytes:
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


@stateless_router.get("/templates")
def list_templates_endpoint() -> list[TemplateInfo]:
    return [
        TemplateInfo(template_id=spec.template_id, question_count=spec.question_count)
        for spec in list_template_specs()
    ]


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


def _grade_and_save_sync(
    decoded: np.ndarray,
    raw_bytes: bytes,
    raw_ext: str,
    template_spec,
    primary_key: ResolvedKeySpec,
    key_versions: dict[str, ResolvedKeySpec],
    *,
    save_to_workspace: bool,
    include_graded_image: bool,
    quiz_id: str,
    quiz_name: str,
    paper_id: str,
) -> StatelessGradeResponse:
    (
        aligned,
        question_fills,
        score_summary,
        text_fields,
        detected_version,
        version_flagged,
        active_key,
    ) = grade_image_with_versions(
        decoded,
        template_spec,
        primary_key=primary_key,
        key_versions=key_versions,
    )
    aligned_jpeg_bytes = _encode_downscaled_jpeg_bytes(aligned)
    graded_jpeg_bytes: bytes | None = None
    if save_to_workspace or include_graded_image:
        graded_overlay = render_graded_overlay(
            aligned,
            template_spec,
            question_fills,
            active_key.answer_key,
            score_summary,
            key_version=active_key.version,
        )
        graded_jpeg_bytes = _encode_downscaled_jpeg_bytes(graded_overlay)

    workspace_paths: dict[str, str] | None = None
    if save_to_workspace and graded_jpeg_bytes is not None:
        settings = get_settings()
        ws_dir = Path(settings.autograde_workspace_dir)
        ensure_workspace_layout(ws_dir, Path(settings.autograde_data_dir) / "templates")
        workspace_paths = save_scan_artifacts(
            ws_dir,
            quiz_id=quiz_id,
            quiz_name=quiz_name,
            paper_id=paper_id,
            student_id_text=text_fields.get("student_id", ""),
            name_text=text_fields.get("name", ""),
            raw_bytes=raw_bytes,
            raw_ext=raw_ext,
            aligned_jpeg_bytes=aligned_jpeg_bytes,
            graded_jpeg_bytes=graded_jpeg_bytes,
        )

    ordered = sorted(question_fills.items())
    answers = ["+".join(fill.marked_choices) for _, fill in ordered]
    flags = {
        q_num: fill.result.value
        for q_num, fill in ordered
        if fill.result in (BubbleResult.AMBIGUOUS, BubbleResult.MULTIPLE)
    }
    confidence = [round(fill.confidence, 4) for _, fill in ordered]
    multi_key = len(key_versions) > 1
    needs_review = scan_job_needs_review(question_fills) or (multi_key and version_flagged)

    return StatelessGradeResponse(
        answers=answers,
        flags=flags,
        confidence=confidence,
        score=score_summary.score_fraction * 100.0,
        needs_review=needs_review,
        key_version=active_key.version,
        key_version_detected=detected_version,
        key_version_flagged=version_flagged,
        name_text=text_fields.get("name", ""),
        date_text=text_fields.get("date", ""),
        section_text=text_fields.get("section", ""),
        student_id_text=text_fields.get("student_id", ""),
        aligned_image_jpeg_base64=base64.b64encode(aligned_jpeg_bytes).decode("ascii"),
        graded_image_jpeg_base64=(
            base64.b64encode(graded_jpeg_bytes).decode("ascii")
            if include_graded_image and graded_jpeg_bytes is not None
            else ""
        ),
        workspace_paths=workspace_paths,
    )


@stateless_router.post("/tests/scan-key")
async def scan_key_endpoint(
    template_id: str,
    file: UploadFile = File(...),
) -> ScanKeyResponse:
    template_spec = get_template_spec(template_id)
    decoded, _, _ = await _read_and_decode_image(file)
    return await run_in_threadpool(_scan_key_sync, decoded, template_spec)


@stateless_router.post("/grade")
async def stateless_grade_endpoint(
    template_id: str = Form(...),
    answer_key: str = Form(...),
    file: UploadFile = File(...),
    save_to_workspace: bool = Form(False),
    include_graded_image: bool = Form(False),
    quiz_id: str = Form(""),
    quiz_name: str = Form(""),
    paper_id: str = Form(""),
) -> StatelessGradeResponse:
    """Align, classify, OCR, score one sheet, and optionally save scans to workspace/."""
    template_spec = get_template_spec(template_id)
    primary_key, key_versions = _parse_stateless_answer_key(
        answer_key, template_spec.question_count
    )
    decoded, raw_bytes, raw_ext = await _read_and_decode_image(file)
    return await run_in_threadpool(
        _grade_and_save_sync,
        decoded,
        raw_bytes,
        raw_ext,
        template_spec,
        primary_key,
        key_versions,
        save_to_workspace=save_to_workspace,
        include_graded_image=include_graded_image,
        quiz_id=quiz_id,
        quiz_name=quiz_name,
        paper_id=paper_id,
    )
