from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import (
    FIFTY_QUESTIONS,
    HUNDRED_QUESTIONS,
    TWENTY_QUESTIONS,
)
from app.answer_sheet_templates.geometry import FIDUCIAL_SIZE_MM, PageSize
from app.bubble_grading.classifier import BubbleResult, QuestionFill, classify_sheet
from app.config import get_settings
from app.scan_alignment.align_scan import ScanAlignmentError, align_scan
from app.sheet_rendering.renderer import mm_length_to_px, mm_to_px
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.synthetic_sheets.question_plan import QuestionMarkKind, QuestionPlan

TEMPLATES = (TWENTY_QUESTIONS, FIFTY_QUESTIONS, HUNDRED_QUESTIONS)
MARK_KIND_ORDER = (
    QuestionMarkKind.PERFECT,
    QuestionMarkKind.BLANK,
    QuestionMarkKind.DOUBLE,
    QuestionMarkKind.LIGHT,
    QuestionMarkKind.INCOMPLETE,
    QuestionMarkKind.OFF_CENTER,
    QuestionMarkKind.NON_CIRCULAR,
)


def expected_description(plan: QuestionPlan) -> str:
    choices = ",".join(plan.marked_choices)
    if plan.mark_kind == QuestionMarkKind.PERFECT:
        return f"filled({choices})"
    if plan.mark_kind == QuestionMarkKind.BLANK:
        return "blank()"
    if plan.mark_kind == QuestionMarkKind.DOUBLE:
        return f"multiple({choices})"
    if plan.mark_kind in (
        QuestionMarkKind.INCOMPLETE,
        QuestionMarkKind.OFF_CENTER,
        QuestionMarkKind.NON_CIRCULAR,
    ):
        return f"filled|ambiguous({choices})"
    return f"any({choices})"


def matches_plan(plan: QuestionPlan, fill: QuestionFill) -> bool:
    if fill.result == BubbleResult.FILLED and fill.marked_choices != plan.marked_choices:
        return False
    if plan.mark_kind == QuestionMarkKind.PERFECT:
        return fill.result == BubbleResult.FILLED and fill.marked_choices == plan.marked_choices
    if plan.mark_kind == QuestionMarkKind.BLANK:
        return fill.result == BubbleResult.BLANK
    if plan.mark_kind == QuestionMarkKind.DOUBLE:
        return fill.result == BubbleResult.MULTIPLE
    if plan.mark_kind in (
        QuestionMarkKind.INCOMPLETE,
        QuestionMarkKind.OFF_CENTER,
        QuestionMarkKind.NON_CIRCULAR,
    ):
        return fill.result in (BubbleResult.FILLED, BubbleResult.AMBIGUOUS)
    return True


def count_fiducial_candidates(image: np.ndarray, page: PageSize = PAGE) -> list[int]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    img_h, img_w = gray.shape[:2]
    page_w_px, _ = mm_to_px(page.width_mm, page.height_mm, page)
    fid_px = mm_length_to_px(FIDUCIAL_SIZE_MM, page) * (min(img_w, img_h) / page_w_px)
    border_margin = fid_px * 0.6

    win_h, win_w = img_h // 4, img_w // 4
    windows = (
        (0, 0, win_w, win_h),
        (img_w - win_w, 0, img_w, win_h),
        (img_w - win_w, img_h - win_h, img_w, img_h),
        (0, img_h - win_h, win_w, img_h),
    )

    counts: list[int] = []
    for x0, y0, x1, y1 in windows:
        sub = gray[y0:y1, x0:x1]
        if int(sub.max()) - int(sub.min()) < 40:
            counts.append(0)
            continue
        _, binary = cv2.threshold(sub, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        window_count = 0
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 150:
                continue
            (_, _), (w, h), _ = cv2.minAreaRect(contour)
            if w == 0 or h == 0:
                continue
            long_side, short_side = max(w, h), min(w, h)
            if not (fid_px * 0.75 <= long_side <= fid_px * 1.3) or area / (w * h) < 0.4:
                continue
            bx, by, bw, bh = cv2.boundingRect(contour)
            gx, gy = x0 + bx, y0 + by
            touches_border = (
                gx <= border_margin
                or (gx + bw) >= img_w - border_margin
                or gy <= border_margin
                or (gy + bh) >= img_h - border_margin
            )
            if not touches_border and short_side / long_side < 0.75:
                continue
            window_count += 1
        counts.append(window_count)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=10, help="Number of seeds per template.")
    args = parser.parse_args()

    failures_dir = Path(get_settings().autograde_data_dir) / "read_check_failures"

    for template in TEMPLATES:
        total_questions = 0
        mismatches = 0
        failed_sheets = 0
        by_kind: dict[QuestionMarkKind, Counter[str]] = {
            kind: Counter() for kind in MARK_KIND_ORDER
        }

        for seed in range(args.seeds):
            sheet = generate_synthetic_sheet(template, seed=seed)
            try:
                aligned = align_scan(sheet.image, template)
            except ScanAlignmentError as exc:
                failed_sheets += 1
                failures_dir.mkdir(parents=True, exist_ok=True)
                out_path = failures_dir / f"{template.template_id}_seed_{seed}.png"
                cv2.imwrite(str(out_path), sheet.image)
                cand_counts = count_fiducial_candidates(sheet.image)
                print(
                    f"FAILED template={template.template_id} seed={seed} "
                    f"saved={out_path} fiducial_candidates={sum(cand_counts)}{cand_counts} "
                    f"artifacts={sheet.scan_artifacts} error={exc}"
                )
                continue

            fills = classify_sheet(aligned, template)
            for plan in sheet.question_plans:
                total_questions += 1
                fill = fills[plan.question_number]
                by_kind[plan.mark_kind][fill.result.value] += 1
                if not matches_plan(plan, fill):
                    mismatches += 1
                    actual = f"{fill.result.value}({','.join(fill.marked_choices)})"
                    print(
                        f"MISMATCH template={template.template_id} seed={seed} "
                        f"q={plan.question_number} kind={plan.mark_kind.value} "
                        f"expected={expected_description(plan)} actual={actual}"
                    )

        kind_parts = []
        for kind in MARK_KIND_ORDER:
            counts = by_kind[kind]
            total = sum(counts.values())
            breakdown = ",".join(f"{res}:{cnt}" for res, cnt in sorted(counts.items()))
            kind_parts.append(f"{kind.value}={total}({breakdown})")
        print(f"MARK_KINDS template={template.template_id} " + " ".join(kind_parts))
        print(
            f"SUMMARY template={template.template_id} sheets={args.seeds} "
            f"failed_sheets={failed_sheets} questions={total_questions} mismatches={mismatches}"
        )


if __name__ == "__main__":
    main()
