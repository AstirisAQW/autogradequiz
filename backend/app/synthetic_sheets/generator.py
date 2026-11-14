"""Builds one fully reproducible synthetic sheet -- a rendered page plus known-answer
ground truth -- from a single seed.

Renders a real sheet with sheet_rendering.renderer and a TemplateSpec (so every bubble is
exactly where the real renderer would put it), draws marks of a known kind at known
bubbles, then runs the page through simulated scan/photo artifacts. Everything that
decides what gets drawn or how the page gets distorted is pulled from a single
numpy.random.Generator seeded once per sheet, so a given seed always reproduces the same
image byte-for-byte.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.geometry import PageSize, bubble_radius_px
from app.answer_sheet_templates.layout_spec import TemplateSpec
from app.sheet_rendering.renderer import render_sheet
from app.synthetic_sheets.mark_drawing import draw_marks_for_plan
from app.synthetic_sheets.question_plan import QuestionPlan, generate_question_plans
from app.synthetic_sheets.scan_artifacts import ScanArtifacts, apply_scan_artifacts
from app.synthetic_sheets.stray_marks import (
    STRAY_MARK_MAX_COUNT,
    STRAY_MARK_MIN_COUNT,
    draw_stray_marks,
)


@dataclass(frozen=True)
class SyntheticSheet:
    seed: int
    template_id: str
    question_plans: tuple[QuestionPlan, ...]
    stray_mark_count: int
    image: np.ndarray
    scan_artifacts: ScanArtifacts | None = None

    @property
    def answer_key(self) -> list[str]:
        return [plan.correct_choice for plan in self.question_plans]


def generate_synthetic_sheet(
    template_spec: TemplateSpec,
    seed: int,
    page: PageSize = PAGE,
    answer_key: list[str] | None = None,
    accuracy: float | None = None,
    messy: float | None = None,
) -> SyntheticSheet:
    """Render one fully reproducible synthetic sheet for the given seed.

    Every random choice -- which bubbles get marked, how each mark is drawn, how many
    stray marks appear and where, and every scan/photo distortion parameter -- is drawn
    from a single Generator seeded here, so the same (template_spec, seed) pair always
    produces the same image.

    answer_key, when given, is graded against instead of each question inventing its own
    correct choice -- pass the same key to several seeds to simulate a batch of different
    student sheets all taking the same test.
    """
    rng = np.random.default_rng(seed)

    canvas = render_sheet(template_spec, page=page)
    radius_px = bubble_radius_px(template_spec, page)

    question_plans = generate_question_plans(
        template_spec, rng, answer_key=answer_key, accuracy=accuracy, messy=messy
    )
    for plan in question_plans:
        draw_marks_for_plan(canvas, template_spec, plan, radius_px, page, rng)

    stray_mark_count = int(rng.integers(STRAY_MARK_MIN_COUNT, STRAY_MARK_MAX_COUNT))
    draw_stray_marks(canvas, page, stray_mark_count, rng)

    image, scan_artifacts = apply_scan_artifacts(canvas, rng)

    return SyntheticSheet(
        seed=seed,
        template_id=template_spec.template_id,
        question_plans=question_plans,
        stray_mark_count=stray_mark_count,
        image=image,
        scan_artifacts=scan_artifacts,
    )