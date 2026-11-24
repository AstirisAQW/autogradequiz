from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from functools import lru_cache

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

    FILLED = "filled"
    BLANK = "blank"
    AMBIGUOUS = "ambiguous"
    MULTIPLE = "multiple"


@dataclass(frozen=True)
class ClassifierThresholds:

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

    mean_ink: float
    result: BubbleResult
    peak_ink: float = 0.0
    blob_ratio: float = 0.0


@dataclass(frozen=True)
class QuestionFill:

    result: BubbleResult
    marked_choices: tuple[str, ...]
    bubble_fills: tuple[tuple[str, BubbleFill], ...]
    confidence: float = 0.0


def to_grayscale(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def circular_mask(shape: tuple[int, int], center_px: tuple[int, int], radius_px: int) -> np.ndarray:
    height, width = shape
    y_indices, x_indices = np.ogrid[:height, :width]
    center_x, center_y = center_px
    distance_sq = (x_indices - center_x) ** 2 + (y_indices - center_y) ** 2
    return distance_sq <= radius_px**2


@lru_cache(maxsize=16)
def _canonical_disc_mask(inner_radius: int) -> tuple[np.ndarray, int]:
    diameter = 2 * inner_radius + 1
    mask = circular_mask((diameter, diameter), (inner_radius, inner_radius), inner_radius)
    return mask, int(np.count_nonzero(mask))


def calibrate_sheet_ink(gray_image: np.ndarray, page: PageSize = PAGE) -> np.ndarray:
    height, width = gray_image.shape[:2]

    y0, y1 = int(round(height * 0.81)), int(round(height * 0.93))
    x0, x1 = int(round(width * 0.12)), int(round(width * 0.88))
    paper_patch = gray_image[y0:y1, x0:x1]
    white = float(np.median(paper_patch)) if paper_patch.size else 255.0

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
    if disc_pixel_count == 0:
        return 0.0
    dark_count = int(np.count_nonzero(dark_mask))
    if dark_count == 0:
        return 0.0
    if dark_count == 1:
        return 1.0 / disc_pixel_count
    if dark_count == disc_pixel_count:
        return 1.0
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
    inner_radius = max(radius_px - BUBBLE_OUTLINE_THICKNESS_PX - 1, 1)
    height, width = ink_map.shape[:2]
    cx, cy = center_px
    x0, y0 = max(cx - inner_radius, 0), max(cy - inner_radius, 0)
    x1, y1 = min(cx + inner_radius + 1, width), min(cy + inner_radius + 1, height)

    patch = ink_map[y0:y1, x0:x1]
    if patch.size == 0:
        return BubbleFill(
            mean_ink=0.0, result=BubbleResult.BLANK, peak_ink=0.0, blob_ratio=0.0
        )

    diameter = 2 * inner_radius + 1
    if patch.shape == (diameter, diameter):
        disc_mask, disc_count = _canonical_disc_mask(inner_radius)
    else:
        disc_mask = circular_mask(patch.shape, (cx - x0, cy - y0), inner_radius)
        disc_count = int(np.count_nonzero(disc_mask))
    if disc_count == 0:
        return BubbleFill(
            mean_ink=0.0, result=BubbleResult.BLANK, peak_ink=0.0, blob_ratio=0.0
        )

    vals = patch[disc_mask]
    mean_ink = float(vals.mean())
    peak_ink = float(np.percentile(vals, 90))
    blob_ratio = _largest_blob_fraction(
        (patch >= thresholds.blob_ink_threshold) & disc_mask, disc_count
    )

    return BubbleFill(
        mean_ink=mean_ink,
        result=BubbleResult.AMBIGUOUS,
        peak_ink=peak_ink,
        blob_ratio=blob_ratio,
    )


def aggregate_question_fill(
    bubble_fills: tuple[tuple[str, BubbleFill], ...],
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
) -> QuestionFill:
    ranked = sorted(
        bubble_fills,
        key=lambda item: (item[1].peak_ink, item[1].mean_ink),
        reverse=True,
    )
    best_choice, best = ranked[0]
    second_choice, second = ranked[1]

    mean_gap = best.mean_ink - second.mean_ink
    is_stray_speck = (
        best.peak_ink >= thresholds.blob_ink_threshold
        and best.peak_ink < thresholds.blank_stray_max_peak
        and best.mean_ink < thresholds.blank_stray_max_mean
        and best.blob_ratio < thresholds.blank_stray_max_blob
    )
    if (
        best.peak_ink < thresholds.blank_peak_floor
        or (
            best.peak_ink < thresholds.blank_soft_peak_floor
            and mean_gap < thresholds.blank_min_mean_gap
        )
        or is_stray_speck
    ):
        updated = tuple(
            (c, BubbleFill(bf.mean_ink, BubbleResult.BLANK, bf.peak_ink, bf.blob_ratio))
            for c, bf in bubble_fills
        )
        return QuestionFill(
            result=BubbleResult.BLANK,
            marked_choices=(),
            bubble_fills=updated,
            confidence=max(0.0, thresholds.blank_peak_floor - best.peak_ink),
        )

    above_multi = [
        (c, bf)
        for c, bf in ranked
        if bf.peak_ink >= thresholds.multiple_peak_floor
        and bf.mean_ink >= thresholds.multiple_min_second_mean
    ]
    gap = best.peak_ink - second.peak_ink
    if len(above_multi) >= 2 and gap <= thresholds.multiple_max_gap:
        multi_set = {mc for mc, _ in above_multi}
        multi_choices = tuple(c for c, _ in bubble_fills if c in multi_set)
        updated = tuple(
            (
                c,
                BubbleFill(
                    bf.mean_ink,
                    BubbleResult.AMBIGUOUS if c in multi_choices else BubbleResult.BLANK,
                    bf.peak_ink,
                    bf.blob_ratio,
                ),
            )
            for c, bf in bubble_fills
        )
        return QuestionFill(
            result=BubbleResult.MULTIPLE,
            marked_choices=multi_choices,
            bubble_fills=updated,
            confidence=max(0.0, best.peak_ink - second.peak_ink),
        )

    is_filled = (
        best.mean_ink >= thresholds.filled_min_mean_ink
        and best.blob_ratio >= thresholds.filled_min_blob_ratio
    )
    result = BubbleResult.FILLED if is_filled else BubbleResult.AMBIGUOUS
    gap = max(0.0, best.peak_ink - second.peak_ink)
    confidence = gap + best.mean_ink

    updated = tuple(
        (
            c,
            BubbleFill(
                bf.mean_ink,
                result if c == best_choice else BubbleResult.BLANK,
                bf.peak_ink,
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
