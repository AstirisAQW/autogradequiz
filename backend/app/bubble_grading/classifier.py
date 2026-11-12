"""Fill-ratio bubble classification.

The old design measured the mean pixel intensity inside a rectangle around each bubble
and compared it to one global BLANK_THRESHOLD for the whole sheet. That collapses under
uneven lighting (a shadow across half the page shifts every mean by a different amount)
and it can't tell a fully-shaded bubble from a checkmark that only darkens a slice of it,
because both can produce the same average darkness.

This module instead measures a fill_ratio: the fraction of pixels inside a circular mask
over the bubble that count as "dark", using a threshold computed locally for that one
bubble (its own small neighborhood) rather than one threshold for the whole sheet. A
solid fill lights up nearly the whole mask. A partial fill, faint pencil mark, or
scribble lights up some meaningful slice of it. An empty bubble lights up almost none of
it. The mask itself is widened beyond the printed circle so ink that bleeds past the
printed line still gets counted.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import Enum

import cv2
import numpy as np

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.geometry import ANSWER_CHOICES, PageSize
from app.answer_sheet_templates.layout_spec import TemplateSpec
from app.sheet_rendering.renderer import (
    BUBBLE_OUTLINE_THICKNESS_PX,
    bubble_position_px,
    bubble_radius_px,
)


class BubbleResult(Enum):
    """The four classes a graded answer can fall into."""

    FILLED = "filled"
    BLANK = "blank"
    AMBIGUOUS = "ambiguous"
    MULTIPLE = "multiple"


class QuestionOutcome(Enum):
    """A graded answer compared against the answer key."""

    CORRECT = "correct"
    WRONG = "wrong"
    BLANK = "blank"
    AMBIGUOUS = "ambiguous"
    MULTIPLE = "multiple"


@dataclass(frozen=True)
class ClassifierThresholds:
    """Fill-ratio cut points, each expressed as a fraction of the masked bubble area.

    mask_widen_fraction: how much wider than the printed circle the classification mask
        is, so ink that bleeds outside the printed line still gets counted.
    blank_max_ratio: at or below this fraction of dark pixels, a bubble counts as
        untouched.
    filled_min_ratio: at or above this fraction, a bubble counts as solidly filled.
        Between blank_max_ratio and filled_min_ratio is AMBIGUOUS: incomplete fills,
        light marks, and marks that only partly cover the bubble all land here.
    local_patch_radius_multiplier: how far past the widened mask to crop when computing
        that bubble's own dark/light threshold. Wide enough to see surrounding paper for
        contrast, narrow enough to stay clear of neighboring bubbles and text.
    background_sample_radius_multiplier: pixels farther than this (relative to the
        widened radius) from the bubble center are assumed to be plain paper, and are
        sampled to work out what "white" looks like for this one bubble. Must stay
        smaller than local_patch_radius_multiplier so the sample area fits in the patch.
    dark_offset: how many intensity levels darker than that local white level a pixel
        must be to count as ink. Has to clear the printed bubble outline itself (a light
        gray, meaningfully darker than blank paper but much lighter than real ink) with
        room to spare, or every bubble -- marked or not -- would register a baseline
        fill_ratio just from its own outline.
    trace_dark_offset: gentler darkness offset below local white used only on the inner
        disc (inside the printed outline) to detect faint pencil traces.
    trace_min_ratio: minimum inner-disc fraction at trace_dark_offset for an otherwise
        blank bubble to count as a trace and promote a BLANK question to AMBIGUOUS.
    """

    mask_widen_fraction: float = 0.18
    blank_max_ratio: float = 0.08
    filled_min_ratio: float = 0.60
    local_patch_radius_multiplier: float = 2.0
    background_sample_radius_multiplier: float = 1.6
    dark_offset: float = 90.0
    trace_dark_offset: float = 50.0
    trace_min_ratio: float = 0.35


DEFAULT_THRESHOLDS = ClassifierThresholds()


@dataclass(frozen=True)
class BubbleFill:
    """The measurement for a single bubble.

    result: one of FILLED, BLANK, or AMBIGUOUS. Never MULTIPLE at this level --
        that class only exists once fills are compared across a whole question row,
        in QuestionFill.
    """

    fill_ratio: float
    result: BubbleResult
    trace_ratio: float = 0.0


@dataclass(frozen=True)
class QuestionFill:
    """The aggregated result for one question row (one bubble per answer choice)."""

    result: BubbleResult
    marked_choices: tuple[str, ...]
    bubble_fills: tuple[tuple[str, BubbleFill], ...]


@dataclass(frozen=True)
class ScoreSummary:
    correct_count: int
    wrong_count: int
    blank_count: int
    ambiguous_count: int
    multiple_count: int
    question_outcomes: dict[int, QuestionOutcome]

    @property
    def graded_question_count(self) -> int:
        return len(self.question_outcomes)

    @property
    def score_fraction(self) -> float:
        if self.graded_question_count == 0:
            return 0.0
        return self.correct_count / self.graded_question_count


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


def widened_radius_px(radius_px: int, thresholds: ClassifierThresholds) -> int:
    return int(round(radius_px * (1.0 + thresholds.mask_widen_fraction)))


def _local_patch(
    gray_image: np.ndarray,
    center_px: tuple[int, int],
    widened_radius_px_value: int,
    thresholds: ClassifierThresholds,
) -> tuple[np.ndarray, tuple[int, int]]:
    """Crop a neighborhood around one bubble and return it with a re-centered origin."""
    height, width = gray_image.shape[:2]
    margin = int(round(widened_radius_px_value * thresholds.local_patch_radius_multiplier))
    center_x, center_y = center_px

    x0 = max(center_x - margin, 0)
    y0 = max(center_y - margin, 0)
    x1 = min(center_x + margin, width)
    y1 = min(center_y + margin, height)

    patch = gray_image[y0:y1, x0:x1]
    patch_center = (center_x - x0, center_y - y0)
    return patch, patch_center


def _background_level(
    patch: np.ndarray, patch_center: tuple[int, int], sample_radius_px: int
) -> float:
    """Median intensity of the patch pixels far enough from the bubble to be plain paper."""
    height, width = patch.shape[:2]
    y_indices, x_indices = np.ogrid[:height, :width]
    center_x, center_y = patch_center
    distance_sq = (x_indices - center_x) ** 2 + (y_indices - center_y) ** 2
    background_pixels = patch[distance_sq >= sample_radius_px**2]
    if background_pixels.size == 0:
        return float(patch.max())
    return float(np.median(background_pixels))


def _local_dark_threshold(
    patch: np.ndarray,
    patch_center: tuple[int, int],
    widened_radius_px_value: int,
    thresholds: ClassifierThresholds,
) -> float:
    """This bubble's own dark/light cutoff, anchored to this bubble's own paper color.

    Using a per-bubble threshold instead of one BLANK_THRESHOLD for the whole sheet means
    a shadow across one corner of the page doesn't push every bubble in that corner
    toward the wrong class -- each bubble is judged against the paper right around it.

    The cutoff sits a fixed distance below that local white level rather than at a split
    found by histogram search: a printed bubble outline blurred by scanning is a soft,
    partial-intensity edge, not a solid dark shape, and histogram-based thresholds can
    mistake that blur for its own cluster and count it as ink. Fixed-offset-from-white
    doesn't have that failure mode, as long as the offset comfortably clears the
    outline's own (much smaller) darkness relative to blank paper.
    """
    sample_radius = int(
        round(widened_radius_px_value * thresholds.background_sample_radius_multiplier)
    )
    background_level = _background_level(patch, patch_center, sample_radius)
    return background_level - thresholds.dark_offset


def _bucket_fill_ratio(fill_ratio: float, thresholds: ClassifierThresholds) -> BubbleResult:
    if fill_ratio <= thresholds.blank_max_ratio:
        return BubbleResult.BLANK
    if fill_ratio >= thresholds.filled_min_ratio:
        return BubbleResult.FILLED
    return BubbleResult.AMBIGUOUS


def classify_bubble(
    gray_image: np.ndarray,
    center_px: tuple[int, int],
    radius_px: int,
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
) -> BubbleFill:
    """fill_ratio = (dark pixels inside the bubble mask) / (total pixels inside the mask)."""
    widened_radius = widened_radius_px(radius_px, thresholds)
    patch, patch_center = _local_patch(gray_image, center_px, widened_radius, thresholds)

    mask = circular_mask(patch.shape, patch_center, widened_radius)
    mask_pixel_count = int(mask.sum())
    if mask_pixel_count == 0:
        return BubbleFill(fill_ratio=0.0, result=BubbleResult.BLANK, trace_ratio=0.0)

    sample_radius = int(
        round(widened_radius * thresholds.background_sample_radius_multiplier)
    )
    background_level = _background_level(patch, patch_center, sample_radius)
    dark_threshold = background_level - thresholds.dark_offset
    dark_mask = patch <= dark_threshold
    dark_pixel_count = int(np.count_nonzero(dark_mask & mask))

    fill_ratio = dark_pixel_count / mask_pixel_count

    inner_radius = max(radius_px - BUBBLE_OUTLINE_THICKNESS_PX - 1, 0)
    inner_mask = circular_mask(patch.shape, patch_center, inner_radius)
    inner_pixel_count = int(inner_mask.sum())
    if inner_radius == 0 or inner_pixel_count == 0:
        trace_ratio = 0.0
    else:
        trace_threshold = background_level - thresholds.trace_dark_offset
        trace_dark_count = int(np.count_nonzero((patch <= trace_threshold) & inner_mask))
        trace_ratio = trace_dark_count / inner_pixel_count

    return BubbleFill(
        fill_ratio=fill_ratio,
        result=_bucket_fill_ratio(fill_ratio, thresholds),
        trace_ratio=trace_ratio,
    )


def aggregate_question_fill(
    bubble_fills: tuple[tuple[str, BubbleFill], ...],
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
) -> QuestionFill:
    """Combine one question's per-choice bubble fills into a single graded result.

    Zero marked bubbles is BLANK unless at least one bubble has a faint trace, which
    promotes the question to AMBIGUOUS with the trace choices. One marked bubble passes
    through its own class (FILLED for a solid mark, AMBIGUOUS for a partial/light/off-shape
    one). Two or more marked bubbles is MULTIPLE, regardless of how solidly each one is
    filled.
    """
    marked = [(choice, fill) for choice, fill in bubble_fills if fill.result != BubbleResult.BLANK]

    if not marked:
        traces = [
            choice
            for choice, fill in bubble_fills
            if fill.fill_ratio <= thresholds.blank_max_ratio
            and fill.trace_ratio >= thresholds.trace_min_ratio
        ]
        if traces:
            return QuestionFill(
                result=BubbleResult.AMBIGUOUS,
                marked_choices=tuple(traces),
                bubble_fills=bubble_fills,
            )
        result = BubbleResult.BLANK
    elif len(marked) == 1:
        result = marked[0][1].result
    else:
        result = BubbleResult.MULTIPLE

    return QuestionFill(
        result=result,
        marked_choices=tuple(choice for choice, _ in marked),
        bubble_fills=bubble_fills,
    )


def classify_question(
    gray_image: np.ndarray,
    template_spec: TemplateSpec,
    question_number: int,
    radius_px: int,
    page: PageSize = PAGE,
    thresholds: ClassifierThresholds = DEFAULT_THRESHOLDS,
) -> QuestionFill:
    bubble_fills = tuple(
        (
            choice,
            classify_bubble(
                gray_image,
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
) -> dict[int, QuestionFill]:
    """Classify every question on an already-aligned sheet image.

    Bubble positions come from bubble_position_px, the same geometry renderer.py uses to
    draw them, so a bubble drawn at a spot and a bubble graded at that spot are always
    the same spot.
    """
    gray_image = to_grayscale(image)
    radius_px = bubble_radius_px(template_spec, page)
    return {
        question_number: classify_question(
            gray_image, template_spec, question_number, radius_px, page, thresholds
        )
        for question_number in range(1, template_spec.question_count + 1)
    }


def score_sheet(question_fills: dict[int, QuestionFill], answer_key: list[str]) -> ScoreSummary:
    """Grade classified answers against an answer key.

    Blank and wrong are tracked separately (rather than folded into one "not correct"
    bucket) so a teacher can tell a student who skipped questions from one who answered
    and missed them.
    """
    outcomes: dict[int, QuestionOutcome] = {}

    for question_number, fill in sorted(question_fills.items()):
        if fill.result == BubbleResult.BLANK:
            outcomes[question_number] = QuestionOutcome.BLANK
        elif fill.result == BubbleResult.MULTIPLE:
            outcomes[question_number] = QuestionOutcome.MULTIPLE
        elif fill.result == BubbleResult.AMBIGUOUS:
            outcomes[question_number] = QuestionOutcome.AMBIGUOUS
        else:
            correct_choice = answer_key[question_number - 1]
            marked_choice = fill.marked_choices[0]
            if marked_choice == correct_choice:
                outcomes[question_number] = QuestionOutcome.CORRECT
            else:
                outcomes[question_number] = QuestionOutcome.WRONG

    counts = Counter(outcomes.values())
    return ScoreSummary(
        correct_count=counts[QuestionOutcome.CORRECT],
        wrong_count=counts[QuestionOutcome.WRONG],
        blank_count=counts[QuestionOutcome.BLANK],
        ambiguous_count=counts[QuestionOutcome.AMBIGUOUS],
        multiple_count=counts[QuestionOutcome.MULTIPLE],
        question_outcomes=outcomes,
    )
