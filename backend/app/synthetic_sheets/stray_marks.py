"""Draws stray marks scattered on the page that aren't tied to any bubble."""

from __future__ import annotations

import cv2
import numpy as np

from app.answer_sheet_templates.geometry import PageSize, mm_length_to_px

STRAY_MARK_MIN_COUNT = 0
STRAY_MARK_MAX_COUNT = 4
"""rng.integers() treats its upper bound as exclusive, so the sampled count is drawn
from [STRAY_MARK_MIN_COUNT, STRAY_MARK_MAX_COUNT)."""

STRAY_MARK_PAGE_MARGIN_MM = 15.0


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
