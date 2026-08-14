"""Synthetic sample sheets for testing the grading pipeline.

Renders a real sheet with sheet_renderer.py and TemplateSpec (so every bubble is exactly
where the real renderer would put it), draws marks of a known kind at known bubbles, then
runs the page through simulated scan/photo artifacts. Everything that decides what gets
drawn or how the page gets distorted is pulled from a single numpy.random.Generator seeded
once per sheet, so a given seed always reproduces the same image byte-for-byte.

Ground truth (the seed and which bubbles were marked with which kind of mark) is meant to
be committed to the repo. The generated image is not -- it's fully reproducible from the
seed plus the template, so there's nothing to gain from storing it and every reason not to
(binary diffs, repo bloat).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import cv2
import numpy as np

from app.grading.sheet_renderer import (
    ANSWER_CHOICES,
    BLACK,
    bubble_position_px,
    bubble_radius_px,
    mm_length_to_px,
    render_sheet,
)
from app.grading.template_builder import PAGE
from app.grading.template_schema import PageSize
from app.grading.template_spec import TemplateSpec

STRAY_MARK_MIN_COUNT = 0
STRAY_MARK_MAX_COUNT = 4  # exclusive upper bound
STRAY_MARK_PAGE_MARGIN_MM = 15.0


class QuestionMarkKind(Enum):
    """The per-question defect types from the sample-sheet spec.

    STRAY marks are handled separately at the page level since they aren't tied to any
    one bubble.
    """

    PERFECT = "perfect"
    INCOMPLETE = "incomplete"
    LIGHT = "light"
    OFF_CENTER = "off_center"
    NON_CIRCULAR = "non_circular"
    BLANK = "blank"
    DOUBLE = "double"


# Roughly realistic mix for one sheet: mostly clean fills, a long tail of messier ones.
QUESTION_MARK_WEIGHTS: tuple[tuple[QuestionMarkKind, float], ...] = (
    (QuestionMarkKind.PERFECT, 0.50),
    (QuestionMarkKind.INCOMPLETE, 0.12),
    (QuestionMarkKind.LIGHT, 0.10),
    (QuestionMarkKind.OFF_CENTER, 0.10),
    (QuestionMarkKind.NON_CIRCULAR, 0.08),
    (QuestionMarkKind.BLANK, 0.06),
    (QuestionMarkKind.DOUBLE, 0.04),
)


@dataclass(frozen=True)
class QuestionPlan:
    """Ground truth for one question: what a hand-grader would write down."""

    question_number: int
    correct_choice: str
    marked_choices: tuple[str, ...]
    mark_kind: QuestionMarkKind


@dataclass(frozen=True)
class SyntheticSheet:
    seed: int
    template_id: str
    question_plans: tuple[QuestionPlan, ...]
    stray_mark_count: int
    image: np.ndarray

    @property
    def answer_key(self) -> list[str]:
        return [plan.correct_choice for plan in self.question_plans]


# ---------------------------------------------------------------------------
# Question plan generation
# ---------------------------------------------------------------------------


def generate_question_plans(
    template_spec: TemplateSpec, rng: np.random.Generator
) -> tuple[QuestionPlan, ...]:
    kinds = [kind for kind, _ in QUESTION_MARK_WEIGHTS]
    weights = [weight for _, weight in QUESTION_MARK_WEIGHTS]

    plans = []
    for question_number in range(1, template_spec.question_count + 1):
        correct_choice = str(rng.choice(ANSWER_CHOICES))
        mark_kind = rng.choice(kinds, p=weights)

        if mark_kind == QuestionMarkKind.BLANK:
            marked_choices: tuple[str, ...] = ()
        elif mark_kind == QuestionMarkKind.DOUBLE:
            chosen = rng.choice(ANSWER_CHOICES, size=2, replace=False)
            marked_choices = tuple(str(choice) for choice in chosen)
        else:
            marked_choices = (str(rng.choice(ANSWER_CHOICES)),)

        plans.append(
            QuestionPlan(
                question_number=question_number,
                correct_choice=correct_choice,
                marked_choices=marked_choices,
                mark_kind=mark_kind,
            )
        )
    return tuple(plans)


# ---------------------------------------------------------------------------
# Per-bubble mark drawing
# ---------------------------------------------------------------------------


def draw_perfect_mark(canvas: np.ndarray, center_px: tuple[int, int], radius_px: int) -> None:
    """Solid filled circle matching the bubble exactly."""
    cv2.circle(canvas, center_px, radius_px, BLACK, -1)


def draw_incomplete_mark(
    canvas: np.ndarray, center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> None:
    """A filled circle at 60-80% of the bubble radius, or a filled partial arc."""
    if rng.random() < 0.5:
        shrunk_radius = int(round(radius_px * rng.uniform(0.6, 0.8)))
        cv2.circle(canvas, center_px, max(shrunk_radius, 1), BLACK, -1)
    else:
        start_angle = float(rng.uniform(0, 360))
        arc_span = float(rng.uniform(120, 180))
        cv2.ellipse(
            canvas,
            center_px,
            (radius_px, radius_px),
            0,
            start_angle,
            start_angle + arc_span,
            BLACK,
            -1,
        )


def draw_light_mark(
    canvas: np.ndarray, center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> None:
    """A fully-shaped fill, but in gray instead of black."""
    gray_value = int(rng.integers(130, 190))
    color = (gray_value, gray_value, gray_value)
    cv2.circle(canvas, center_px, radius_px, color, -1)


def draw_off_center_mark(
    canvas: np.ndarray, center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> None:
    """A solid fill shifted a few pixels away from the true bubble center."""
    shift_magnitude = int(rng.integers(2, 6))
    angle = float(rng.uniform(0, 2 * np.pi))
    dx = int(round(shift_magnitude * np.cos(angle)))
    dy = int(round(shift_magnitude * np.sin(angle)))
    shifted_center = (center_px[0] + dx, center_px[1] + dy)
    cv2.circle(canvas, shifted_center, radius_px, BLACK, -1)


def _scribble_points(
    center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> np.ndarray:
    point_count = int(rng.integers(4, 7))
    offsets = rng.uniform(-radius_px * 0.8, radius_px * 0.8, size=(point_count, 2))
    points = offsets + np.array(center_px)
    return points.astype(np.int32)


def draw_non_circular_mark(
    canvas: np.ndarray, center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> None:
    """An X, a checkmark, or a scribble instead of a filled circle."""
    thickness = max(2, radius_px // 3)
    style = rng.integers(0, 3)
    cx, cy = center_px
    reach = int(round(radius_px * 0.75))

    if style == 0:  # X
        cv2.line(canvas, (cx - reach, cy - reach), (cx + reach, cy + reach), BLACK, thickness)
        cv2.line(canvas, (cx - reach, cy + reach), (cx + reach, cy - reach), BLACK, thickness)
    elif style == 1:  # checkmark
        p1 = (cx - reach, cy)
        p2 = (cx - reach // 3, cy + reach)
        p3 = (cx + reach, cy - reach)
        cv2.polylines(canvas, [np.array([p1, p2, p3], dtype=np.int32)], False, BLACK, thickness)
    else:  # scribble
        points = _scribble_points(center_px, radius_px, rng)
        cv2.polylines(canvas, [points], False, BLACK, thickness)


def draw_marks_for_plan(
    canvas: np.ndarray,
    template_spec: TemplateSpec,
    plan: QuestionPlan,
    radius_px: int,
    page: PageSize,
    rng: np.random.Generator,
) -> None:
    if plan.mark_kind == QuestionMarkKind.BLANK:
        return

    if plan.mark_kind == QuestionMarkKind.DOUBLE:
        for choice in plan.marked_choices:
            center = bubble_position_px(
                template_spec, plan.question_number, ANSWER_CHOICES.index(choice), page
            )
            draw_perfect_mark(canvas, center, radius_px)
        return

    choice = plan.marked_choices[0]
    center = bubble_position_px(
        template_spec, plan.question_number, ANSWER_CHOICES.index(choice), page
    )

    if plan.mark_kind == QuestionMarkKind.PERFECT:
        draw_perfect_mark(canvas, center, radius_px)
    elif plan.mark_kind == QuestionMarkKind.INCOMPLETE:
        draw_incomplete_mark(canvas, center, radius_px, rng)
    elif plan.mark_kind == QuestionMarkKind.LIGHT:
        draw_light_mark(canvas, center, radius_px, rng)
    elif plan.mark_kind == QuestionMarkKind.OFF_CENTER:
        draw_off_center_mark(canvas, center, radius_px, rng)
    elif plan.mark_kind == QuestionMarkKind.NON_CIRCULAR:
        draw_non_circular_mark(canvas, center, radius_px, rng)


# ---------------------------------------------------------------------------
# Stray marks (not tied to any bubble)
# ---------------------------------------------------------------------------


def draw_stray_marks(
    canvas: np.ndarray, page: PageSize, count: int, rng: np.random.Generator
) -> None:
    """Small dots or smudges scattered on the page, clear of the fiducial margins."""
    height, width = canvas.shape[:2]
    margin_px = mm_length_to_px(STRAY_MARK_PAGE_MARGIN_MM, page)

    for _ in range(count):
        x = int(rng.integers(margin_px, max(width - margin_px, margin_px + 1)))
        y = int(rng.integers(margin_px, max(height - margin_px, margin_px + 1)))
        radius = int(rng.integers(2, 6))
        gray_value = int(rng.integers(60, 180))
        color = (gray_value, gray_value, gray_value)
        cv2.circle(canvas, (x, y), radius, color, -1)


# ---------------------------------------------------------------------------
# Scan / photo artifacts
# ---------------------------------------------------------------------------


def apply_rotation_and_perspective(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    height, width = image.shape[:2]
    white = (255, 255, 255)

    angle_deg = float(rng.uniform(2.0, 5.0)) * (1 if rng.random() < 0.5 else -1)
    rotation_matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle_deg, 1.0)
    rotated = cv2.warpAffine(
        image, rotation_matrix, (width, height), borderMode=cv2.BORDER_CONSTANT, borderValue=white
    )

    skew_fraction = 0.015
    jitter = rng.uniform(-skew_fraction, skew_fraction, size=(4, 2))
    src_points = np.float32([[0, 0], [width, 0], [0, height], [width, height]])
    dst_points = np.float32(
        [
            [width * jitter[0, 0], height * jitter[0, 1]],
            [width * (1 + jitter[1, 0]), height * jitter[1, 1]],
            [width * jitter[2, 0], height * (1 + jitter[2, 1])],
            [width * (1 + jitter[3, 0]), height * (1 + jitter[3, 1])],
        ]
    )
    perspective_matrix = cv2.getPerspectiveTransform(src_points, dst_points)
    return cv2.warpPerspective(
        rotated,
        perspective_matrix,
        (width, height),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=white,
    )


def apply_gaussian_blur(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    sigma = float(rng.uniform(0.4, 1.2))
    return cv2.GaussianBlur(image, (5, 5), sigma)


def apply_brightness_contrast(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    brightness = float(rng.uniform(-25, 25))
    contrast = float(rng.uniform(0.85, 1.15))
    adjusted = image.astype(np.float32) * contrast + brightness
    return np.clip(adjusted, 0, 255).astype(np.uint8)


def apply_gaussian_noise(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    sigma = float(rng.uniform(2.0, 8.0))
    noise = rng.normal(0, sigma, size=image.shape)
    noisy = image.astype(np.float32) + noise
    return np.clip(noisy, 0, 255).astype(np.uint8)


def apply_jpeg_compression(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    quality = int(rng.uniform(55, 90))
    success, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not success:
        return image
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def apply_scan_artifacts(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Simulate the damage a real scan or phone photo does to a clean render.

    Order matters: physical distortions (rotation/skew, optical blur, exposure, sensor
    noise) happen before the image is ever encoded, so JPEG compression -- which is what
    actually happens last, at save time -- runs last here too.
    """
    image = apply_rotation_and_perspective(image, rng)
    image = apply_gaussian_blur(image, rng)
    image = apply_brightness_contrast(image, rng)
    image = apply_gaussian_noise(image, rng)
    image = apply_jpeg_compression(image, rng)
    return image


# ---------------------------------------------------------------------------
# Top-level generation
# ---------------------------------------------------------------------------


def generate_synthetic_sheet(
    template_spec: TemplateSpec, seed: int, page: PageSize = PAGE
) -> SyntheticSheet:
    """Render one fully reproducible synthetic sheet for the given seed.

    Every random choice -- which bubbles get marked, how each mark is drawn, how many
    stray marks appear and where, and every scan/photo distortion parameter -- is drawn
    from a single Generator seeded here, so the same (template_spec, seed) pair always
    produces the same image.
    """
    rng = np.random.default_rng(seed)

    canvas = render_sheet(template_spec, page=page)
    radius_px = bubble_radius_px(template_spec, page)

    question_plans = generate_question_plans(template_spec, rng)
    for plan in question_plans:
        draw_marks_for_plan(canvas, template_spec, plan, radius_px, page, rng)

    stray_mark_count = int(rng.integers(STRAY_MARK_MIN_COUNT, STRAY_MARK_MAX_COUNT))
    draw_stray_marks(canvas, page, stray_mark_count, rng)

    image = apply_scan_artifacts(canvas, rng)

    return SyntheticSheet(
        seed=seed,
        template_id=template_spec.template_id,
        question_plans=question_plans,
        stray_mark_count=stray_mark_count,
        image=image,
    )


# ---------------------------------------------------------------------------
# Ground truth serialization -- the seed and the answers get committed, not the image
# ---------------------------------------------------------------------------


def question_plan_to_dict(plan: QuestionPlan) -> dict:
    return {
        "question_number": plan.question_number,
        "correct_choice": plan.correct_choice,
        "marked_choices": list(plan.marked_choices),
        "mark_kind": plan.mark_kind.value,
    }


def synthetic_sheet_ground_truth_to_dict(sheet: SyntheticSheet) -> dict:
    return {
        "seed": sheet.seed,
        "template_id": sheet.template_id,
        "stray_mark_count": sheet.stray_mark_count,
        "questions": [question_plan_to_dict(plan) for plan in sheet.question_plans],
    }


def save_ground_truth(sheet: SyntheticSheet, path: Path) -> None:
    """Write the seed and answers for one sheet to disk as JSON. Never writes the image."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(synthetic_sheet_ground_truth_to_dict(sheet), indent=2), encoding="utf-8"
    )