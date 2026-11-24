from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, NamedTuple

import numpy as np
import pytesseract

from app.answer_sheet_templates.builder import A4_PAGE, DEFAULT_TEXT_FIELDS
from app.answer_sheet_templates.geometry import (
    ANSWER_CHOICES,
    KEY_VERSION_CHOICES,
    PageSize,
    mm_to_px,
)
from app.answer_sheet_templates.layout_spec import TemplateSpec
from app.bubble_grading.classifier import (
    BubbleResult,
    QuestionFill,
    calibrate_sheet_ink,
    classify_key_version,
    classify_sheet,
    to_grayscale,
)
from app.bubble_grading.scoring import QuestionRule, ScoreSummary, score_sheet
from app.config import get_settings
from app.grading_pipeline.exceptions import InvalidAnswerKeyError
from app.scan_alignment.aligner import align_scan


@dataclass(frozen=True)
class ResolvedKeySpec:
    version: str
    answer_key: list[str]
    points: list[float]
    question_rules: list[QuestionRule]


def normalize_answer_key_entry(entry: str) -> str:
    parts = [p.strip().upper() for p in entry.split("+") if p.strip()]
    if not parts or any(part not in ANSWER_CHOICES for part in parts):
        raise InvalidAnswerKeyError(f"Answer choices must be in {ANSWER_CHOICES}.")
    unique_sorted = sorted(set(parts), key=ANSWER_CHOICES.index)
    return "+".join(unique_sorted)


def validate_answer_key_and_points(
    question_count: int,
    answer_key: Any,
    points: Any = None,
) -> tuple[list[str], list[float]]:
    if (
        not isinstance(answer_key, list)
        or len(answer_key) != question_count
        or not all(isinstance(c, str) for c in answer_key)
    ):
        raise InvalidAnswerKeyError(
            f"Expected {question_count} answer key entries."
        )
    normalized_key = [normalize_answer_key_entry(entry) for entry in answer_key]
    if points is None:
        normalized_points = [1.0] * question_count
    else:
        if not isinstance(points, list) or len(points) != question_count:
            got = len(points) if isinstance(points, list) else "invalid"
            raise InvalidAnswerKeyError(
                f"Expected {question_count} point values, got {got}."
            )
        normalized_points = [_validate_float(p, "Question point value") for p in points]
        if any(p < 0 for p in normalized_points):
            raise InvalidAnswerKeyError("Question point values must be non-negative.")
    return normalized_key, normalized_points


def _validate_float(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidAnswerKeyError(f"{label} must be a number.")
    num = float(value)
    if not math.isfinite(num):
        raise InvalidAnswerKeyError(f"{label} must be finite.")
    return num


def parse_single_question_rule(entry: Any) -> QuestionRule:
    if not isinstance(entry, dict):
        raise InvalidAnswerKeyError("Each question_rule entry must be an object.")
    alt_raw = entry.get("alternate_answers", entry.get("alternateAnswers"))
    if alt_raw is None:
        alt_raw = []
    if not isinstance(alt_raw, list):
        raise InvalidAnswerKeyError("alternate_answers must be a list.")
    alts: list[tuple[str, float]] = []
    for alt in alt_raw:
        if not isinstance(alt, dict) or not isinstance(alt.get("choice"), str):
            raise InvalidAnswerKeyError(
                "Each alternate answer must include choice and points."
            )
        norm_choice = normalize_answer_key_entry(alt["choice"])
        alt_pts = _validate_float(alt.get("points"), "alternate answer points")
        if alt_pts < 0:
            raise InvalidAnswerKeyError(
                "Alternate answer points must be non-negative."
            )
        alts.append((norm_choice, alt_pts))
    inc_raw = entry.get("incorrect_points", entry.get("incorrectPoints"))
    incorrect_pts = (
        _validate_float(inc_raw, "incorrect_points") if inc_raw is not None else 0.0
    )
    return QuestionRule(alternate_answers=tuple(alts), incorrect_points=incorrect_pts)


def normalize_question_rules(
    question_count: int, raw_rules: Any
) -> list[QuestionRule]:
    if raw_rules is None:
        return [QuestionRule()] * question_count
    if not isinstance(raw_rules, list) or len(raw_rules) != question_count:
        raise InvalidAnswerKeyError(
            f"Expected {question_count} question_rules entries."
        )
    return [parse_single_question_rule(entry) for entry in raw_rules]


def _validate_single_key_payload(
    version: str,
    payload: dict[str, Any],
    question_count: int,
    default_points: list[float] | None = None,
) -> ResolvedKeySpec:
    choices = payload.get("answerKey", payload.get("answer_key"))
    points = payload.get("points")
    norm_key, norm_pts = validate_answer_key_and_points(
        question_count, choices, points if points is not None else default_points
    )
    rules_raw = payload.get("questionRules", payload.get("question_rules"))
    return ResolvedKeySpec(
        version=version,
        answer_key=norm_key,
        points=norm_pts,
        question_rules=normalize_question_rules(question_count, rules_raw),
    )


def build_resolved_key_specs(
    parsed: dict[str, Any], question_count: int
) -> tuple[ResolvedKeySpec, dict[str, ResolvedKeySpec]]:
    primary = _validate_single_key_payload("A", parsed, question_count)
    versions: dict[str, ResolvedKeySpec] = {"A": primary}

    raw_versions = parsed.get("keyVersions", parsed.get("key_versions"))
    if raw_versions is not None:
        if not isinstance(raw_versions, dict):
            raise InvalidAnswerKeyError("keyVersions must be an object keyed by A-D.")
        for raw_ver, ver_payload in raw_versions.items():
            ver = str(raw_ver).strip().upper()
            if ver not in KEY_VERSION_CHOICES:
                raise InvalidAnswerKeyError(f"Unknown key version '{raw_ver}'.")
            if not isinstance(ver_payload, dict):
                raise InvalidAnswerKeyError(f"Key version '{ver}' must be an object.")
            versions[ver] = _validate_single_key_payload(
                ver, ver_payload, question_count, default_points=primary.points
            )

    return versions["A"], versions


def scan_job_needs_review(question_fills: dict[int, QuestionFill]) -> bool:
    return any(
        fill.result in (BubbleResult.AMBIGUOUS, BubbleResult.MULTIPLE)
        for fill in question_fills.values()
    ) or all(fill.result == BubbleResult.BLANK for fill in question_fills.values())


TEXT_BOX_OCR_INSET_PX = 8
TEXT_BOX_INK_INSET_PX = 16
TEXT_BOX_INK_DARK_OFFSET = 50
TEXT_BOX_MIN_INK_SHARE = 0.01


def _box_has_ink(image: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> bool:
    interior = image[
        y0 + TEXT_BOX_INK_INSET_PX : y1 - TEXT_BOX_INK_INSET_PX,
        x0 + TEXT_BOX_INK_INSET_PX : x1 - TEXT_BOX_INK_INSET_PX,
    ]
    if interior.size == 0:
        return False
    gray = to_grayscale(interior)
    dark_share = float(np.mean(gray < float(np.median(gray)) - TEXT_BOX_INK_DARK_OFFSET))
    return dark_share >= TEXT_BOX_MIN_INK_SHARE


_OCR_POOL = ThreadPoolExecutor(max_workers=4)


def _ocr_single_crop(crop: np.ndarray) -> str:
    try:
        text = pytesseract.image_to_string(crop, config="--psm 7").strip()
        return text if sum(1 for ch in text if ch.isalnum()) >= 2 else ""
    except Exception:
        return ""


def read_text_fields(image: np.ndarray, page: PageSize = A4_PAGE) -> dict[str, str]:
    settings = get_settings()
    if settings.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
    values: dict[str, str] = {}
    pending: list[tuple[str, np.ndarray]] = []
    for field in DEFAULT_TEXT_FIELDS:
        x0, y0 = mm_to_px(field.x_mm, field.y_mm, page)
        x1, y1 = mm_to_px(field.x_mm + field.width_mm, field.y_mm + field.height_mm, page)
        if not _box_has_ink(image, x0, y0, x1, y1):
            values[field.id] = ""
            continue
        crop = image[
            y0 + TEXT_BOX_OCR_INSET_PX : y1 - TEXT_BOX_OCR_INSET_PX,
            x0 + TEXT_BOX_OCR_INSET_PX : x1 - TEXT_BOX_OCR_INSET_PX,
        ]
        pending.append((field.id, crop))
    if len(pending) == 1:
        field_id, crop = pending[0]
        values[field_id] = _ocr_single_crop(crop)
    elif len(pending) > 1:
        results = list(_OCR_POOL.map(lambda item: _ocr_single_crop(item[1]), pending))
        for (field_id, _), text in zip(pending, results, strict=True):
            values[field_id] = text
    return values


class GradedSheetExecution(NamedTuple):

    aligned_image: np.ndarray
    question_fills: dict[int, QuestionFill]
    score_summary: ScoreSummary
    text_fields: dict[str, str]
    detected_key_version: str
    key_version_flagged: bool
    active_key: ResolvedKeySpec


def grade_image_with_versions(
    image: np.ndarray,
    template_spec: TemplateSpec,
    *,
    primary_key: ResolvedKeySpec,
    key_versions: dict[str, ResolvedKeySpec] | None = None,
) -> GradedSheetExecution:
    aligned_image = align_scan(image, template_spec)
    ink_map = calibrate_sheet_ink(to_grayscale(aligned_image), A4_PAGE)
    kv_fill = classify_key_version(aligned_image, A4_PAGE, ink_map=ink_map)
    detected_version = (
        kv_fill.marked_choices[0]
        if kv_fill.result == BubbleResult.FILLED
        and kv_fill.marked_choices[0] in KEY_VERSION_CHOICES
        else ""
    )
    version_map = {"A": primary_key, **(key_versions or {})}
    version_flagged = kv_fill.result in (
        BubbleResult.AMBIGUOUS,
        BubbleResult.MULTIPLE,
    ) or (
        len(version_map) > 1
        and (not detected_version or detected_version not in version_map)
    )

    active_key = version_map.get(detected_version, primary_key)

    question_fills = classify_sheet(aligned_image, template_spec, ink_map=ink_map)
    score_summary = score_sheet(
        question_fills,
        active_key.answer_key,
        points=active_key.points,
        question_rules=active_key.question_rules,
    )
    text_fields = read_text_fields(aligned_image)
    return GradedSheetExecution(
        aligned_image=aligned_image,
        question_fills=question_fills,
        score_summary=score_summary,
        text_fields=text_fields,
        detected_key_version=detected_version,
        key_version_flagged=version_flagged,
        active_key=active_key,
    )
