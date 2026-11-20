"""Row-relative normalized-ink bubble classification.

Each aligned sheet is calibrated once from its own paper and fiducial levels:
- ``white``: median intensity of blank paper regions away from bubbles, text, and markers.
- ``black``: median intensity of the four corner fiducial squares.
Pixels are converted to a normalized ink fraction ``clip((white - px) / (white - black), 0, 1)``.

Each bubble is measured strictly on its inner disc (``radius - outline_thickness - 1``) so
the printed circle outline never contributes ink. From that inner disc we compute mean ink,
90th-percentile peak ink, and the largest connected dark blob area as a fraction of the disc.

Decisions are made per question row across choices A-E rather than per bubble in isolation:
- BLANK if the strongest bubble's peak ink is below ``blank_peak_floor``.
- MULTIPLE if at least two bubbles exceed ``multiple_peak_floor`` and their ink gap is small.
- FILLED if the top candidate's mean ink and blob coverage clear the solid-mark cutoffs.
- AMBIGUOUS otherwise, keeping the top candidate in ``marked_choices`` for teacher review.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import cv2
import numpy as np

from app.answer_sheet_templates.builder import PAGE, build_corner_fiducials
from app.answer_sheet_templates.geometry import (
    ANSWER_CHOICES,
    BUBBLE_OUTLINE_THICKNESS_PX,
    FIDUCIAL_SIZE_MM,
    KEY_VERSION_CHOICES,
    PageSize,
    bubble_position_px,
    bubble_radius_px,
    key_version_bubble_position_px,
    key_version_bubble_radius_px,
    mm_length_to_px,
)
from app.answer_sheet_templates.layout_spec import TemplateSpec


class BubbleResult(Enum):
    """The four classes a graded answer can fall into."""

    FILLED = "filled"
    BLANK = "blank"
    AMBIGUOUS = "ambiguous"
    MULTIPLE = "multiple"


@dataclass(frozen=True)
class ClassifierThresholds:
    """Cutoffs for normalized-ink measurement and row-relative classification."""

    blank_peak_floor: float = 0.08
    blank_soft_peak_floor: float = 0.22
    blank_min_mean_gap: float = 0.045
    blank_stray_max_peak: float = 0.40
    blank_stray_max_mean: float = 0.12
    blank_stray_max_blob: float = 0.14
    multiple_peak_floor: float = 0.25
    multiple_max_gap: float = 0.35
    multiple_min_second_mean: float = 0.18
    filled_min_mean_ink: float = 0.295
    filled_min_blob_ratio: float = 0.68
    blob_ink_threshold: float = 0.18


DEFAULT_THRESHOLDS = ClassifierThresholds()


@dataclass(frozen=True)
class BubbleFill:
    """Normalized-ink measurements for a single bubble's inner disc.

    fill_ratio stores mean ink; trace_ratio stores 90th-percentile peak ink;
    blob_ratio stores the largest connected dark component as a fraction of the disc.
    """

    fill_ratio: float
    result: BubbleResult
    trace_ratio: float = 0.0
    blob_ratio: float = 0.0


@dataclass(frozen=True)
class QuestionFill:
    """The aggregated row-relative result for one question (choices A-E)."""

    result: BubbleResult
    marked_choices: tuple[str, ...]
    bubble_fills: tuple[tuple[str, BubbleFill], ...]
    confidence: float = 0.0


def to_grayscale(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def circular_mask(shape: tuple[int, int], center_px: tuple[int, int], radius_px: int) -> np.ndarray:
    """Boolean mask, True for points inside the circle of radius_px centered at center_px."""
    height, width = shape
    y_indices, x_indices = np.ogrid[:height, :width]
    center_x, center_y = center_px
    distance_sq = (x_indices - center_x) ** 2 + (y_indices - center_y) ** 2
    return distance_sq <= radius_px**2


def calibrate_sheet_ink(gray_image: np.ndarray, page: PageSize = PAGE) -> np.ndarray:
    """Calibrate per-sheet white/black levels and return float32 ink in [0, 1]."""
    height, width = gray_image.shape[:2]

    # Bottom band (y in 81%..93%, x in 12%..88%) is plain paper across all templates.
    y0, y1 = int(round(height * 0.81)), int(round(height * 0.93))
    x0, x1 = int(round(width * 0.12)), int(round(width * 0.88))
    paper_patch = gray_image[y0:y1, x0:x1]
    white = float(np.median(paper_patch)) if paper_patch.size else 255.0

    # Sample the inner 50% of each corner fiducial square to avoid border jitter.
    fid_px = mm_length_to_px(FIDUCIAL_SIZE_MM, page)
    pad = max(int(round(fid_px * 0.25)), 1)
    fid_samples: list[np.ndarray] = []
    for pt in build_corner_fiducials(page).values():
        fx = int(round(pt.x * width))
        fy = int(round(pt.y * height))
        patch = gray_image[
            max(fy + pad, 0) : min(fy + fid_px - pad, height),
            max(fx + pad, 0) : min(fx + fid_px - pad, width),
        ]
        if patch.size:
            fid_samples.append(patch.ravel())

    black = float(np.median(np.concatenate(fid_samples))) if fid_samples else 0.0
    if white - black < 20.0:
        white, black = 255.0, 0.0

    ink = (white - gray_image.astype(np.float32)) / (white - black)
    return np.clip(ink, 0.0, 1.0)


def _largest_blob_fraction(dark_mask: np.ndarray, disc_pixel_count: int) -> float:
    if disc_pixel_count == 0 or not np.any(dark_mask):
        return 0.0
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(
        dark_mask.astype(np.uint8), connectivity=8
    )
    if num_labels <= 1:
        return 0.0
    max_area = int(stats[1:, cv2.CC_STAT_AREA].max())
    return max_area / disc_pixel_count


def measure_bubble_ink(
    ink_map: np.ndarray,
    center_px: tuple[int, int],
    radius_px: int,
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
) -> BubbleFill:
    """Measure mean ink, 90th-percentile peak ink, and largest dark blob on the inner disc."""
    inner_radius = max(radius_px - BUBBLE_OUTLINE_THICKNESS_PX - 1, 1)
    height, width = ink_map.shape[:2]
    cx, cy = center_px
    x0, y0 = max(cx - inner_radius, 0), max(cy - inner_radius, 0)
    x1, y1 = min(cx + inner_radius + 1, width), min(cy + inner_radius + 1, height)

    patch = ink_map[y0:y1, x0:x1]
    if patch.size == 0:
        return BubbleFill(
            fill_ratio=0.0, result=BubbleResult.BLANK, trace_ratio=0.0, blob_ratio=0.0
        )

    disc_mask = circular_mask(patch.shape, (cx - x0, cy - y0), inner_radius)
    disc_count = int(disc_mask.sum())
    if disc_count == 0:
        return BubbleFill(
            fill_ratio=0.0, result=BubbleResult.BLANK, trace_ratio=0.0, blob_ratio=0.0
        )

    vals = patch[disc_mask]
    mean_ink = float(vals.mean())
    peak_ink = float(np.percentile(vals, 90))
    blob_ratio = _largest_blob_fraction(
        (patch >= thresholds.blob_ink_threshold) & disc_mask, disc_count
    )

    return BubbleFill(
        fill_ratio=mean_ink,
        result=BubbleResult.AMBIGUOUS,
        trace_ratio=peak_ink,
        blob_ratio=blob_ratio,
    )


def classify_bubble(
    gray_image: np.ndarray,
    center_px: tuple[int, int],
    radius_px: int,
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
) -> BubbleFill:
    """Single-bubble helper that calibrates on the image and measures the inner disc."""
    ink_map = calibrate_sheet_ink(to_grayscale(gray_image), PAGE)
    fill = measure_bubble_ink(ink_map, center_px, radius_px, thresholds)
    if fill.trace_ratio < thresholds.blank_peak_floor:
        result = BubbleResult.BLANK
    elif (
        fill.fill_ratio >= thresholds.filled_min_mean_ink
        and fill.blob_ratio >= thresholds.filled_min_blob_ratio
    ):
        result = BubbleResult.FILLED
    else:
        result = BubbleResult.AMBIGUOUS
    return BubbleFill(
        fill_ratio=fill.fill_ratio,
        result=result,
        trace_ratio=fill.trace_ratio,
        blob_ratio=fill.blob_ratio,
    )


def aggregate_question_fill(
    bubble_fills: tuple[tuple[str, BubbleFill], ...],
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
) -> QuestionFill:
    """Decide one question's result across choices A-E from their normalized ink."""
    ranked = sorted(
        bubble_fills,
        key=lambda item: (item[1].trace_ratio, item[1].fill_ratio),
        reverse=True,
    )
    best_choice, best = ranked[0]
    second_choice, second = ranked[1]

    mean_gap = best.fill_ratio - second.fill_ratio
    is_stray_speck = (
        best.trace_ratio >= thresholds.blob_ink_threshold
        and best.trace_ratio < thresholds.blank_stray_max_peak
        and best.fill_ratio < thresholds.blank_stray_max_mean
        and best.blob_ratio < thresholds.blank_stray_max_blob
    )
    if (
        best.trace_ratio < thresholds.blank_peak_floor
        or (
            best.trace_ratio < thresholds.blank_soft_peak_floor
            and mean_gap < thresholds.blank_min_mean_gap
        )
        or is_stray_speck
    ):
        updated = tuple(
            (c, BubbleFill(bf.fill_ratio, BubbleResult.BLANK, bf.trace_ratio, bf.blob_ratio))
            for c, bf in bubble_fills
        )
        return QuestionFill(
            result=BubbleResult.BLANK,
            marked_choices=(),
            bubble_fills=updated,
            confidence=max(0.0, thresholds.blank_peak_floor - best.trace_ratio),
        )

    above_multi = [
        (c, bf)
        for c, bf in ranked
        if bf.trace_ratio >= thresholds.multiple_peak_floor
        and bf.fill_ratio >= thresholds.multiple_min_second_mean
    ]
    gap = best.trace_ratio - second.trace_ratio
    if len(above_multi) >= 2 and gap <= thresholds.multiple_max_gap:
        multi_set = {mc for mc, _ in above_multi}
        multi_choices = tuple(c for c, _ in bubble_fills if c in multi_set)
        updated = tuple(
            (
                c,
                BubbleFill(
                    bf.fill_ratio,
                    BubbleResult.AMBIGUOUS if c in multi_choices else BubbleResult.BLANK,
                    bf.trace_ratio,
                    bf.blob_ratio,
                ),
            )
            for c, bf in bubble_fills
        )
        return QuestionFill(
            result=BubbleResult.MULTIPLE,
            marked_choices=multi_choices,
            bubble_fills=updated,
            confidence=max(0.0, best.trace_ratio - second.trace_ratio),
        )

    is_filled = (
        best.fill_ratio >= thresholds.filled_min_mean_ink
        and best.blob_ratio >= thresholds.filled_min_blob_ratio
    )
    result = BubbleResult.FILLED if is_filled else BubbleResult.AMBIGUOUS
    gap = max(0.0, best.trace_ratio - second.trace_ratio)
    confidence = gap + best.fill_ratio

    updated = tuple(
        (
            c,
            BubbleFill(
                bf.fill_ratio,
                result if c == best_choice else BubbleResult.BLANK,
                bf.trace_ratio,
                bf.blob_ratio,
            ),
        )
        for c, bf in bubble_fills
    )
    return QuestionFill(
        result=result,
        marked_choices=(best_choice,),
        bubble_fills=updated,
        confidence=confidence,
    )


def classify_question(
    ink_map: np.ndarray,
    template_spec: TemplateSpec,
    question_number: int,
    radius_px: int,
    page: PageSize = PAGE,
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
) -> QuestionFill:
    bubble_fills = tuple(
        (
            choice,
            measure_bubble_ink(
                ink_map,
                bubble_position_px(template_spec, question_number, choice_index, page),
                radius_px,
                thresholds,
            ),
        )
        for choice_index, choice in enumerate(ANSWER_CHOICES)
    )
    return aggregate_question_fill(bubble_fills, thresholds)


def classify_sheet(
    image: np.ndarray,
    template_spec: TemplateSpec,
    page: PageSize = PAGE,
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
    *,
    ink_map: np.ndarray | None = None,
) -> dict[int, QuestionFill]:
    """Classify every question on an already-aligned sheet image."""
    resolved_ink = (
        ink_map if ink_map is not None else calibrate_sheet_ink(to_grayscale(image), page)
    )
    radius_px = bubble_radius_px(template_spec, page)
    return {
        question_number: classify_question(
            resolved_ink, template_spec, question_number, radius_px, page, thresholds
        )
        for question_number in range(1, template_spec.question_count + 1)
    }


def classify_key_version(
    image: np.ndarray,
    page: PageSize = PAGE,
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
    *,
    ink_map: np.ndarray | None = None,
) -> QuestionFill:
    """Classify the printed Key Version strip (A-D) on an aligned sheet."""
    resolved_ink = (
        ink_map if ink_map is not None else calibrate_sheet_ink(to_grayscale(image), page)
    )
    radius_px = key_version_bubble_radius_px(page)
    bubble_fills = tuple(
        (
            choice,
            measure_bubble_ink(
                resolved_ink,
                key_version_bubble_position_px(idx, page),
                radius_px,
                thresholds,
            ),
        )
        for idx, choice in enumerate(KEY_VERSION_CHOICES)
    )
    return aggregate_question_fill(bubble_fills, thresholds)
