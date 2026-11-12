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
GENERATOR_MAX_ANGLE_DEG = 5.0
ANGLE_BUCKETS: tuple[tuple[str, float, float], ...] = (
    ("0-1", 0.0, 1.0),
    ("1-2", 1.0, 2.0),
    ("2-3", 2.0, 3.0),
    ("3-4", 3.0, 4.0),
    ("4-4.5", 4.0, 4.5),
    ("4.5-5", 4.5, 5.0),
)
CORNER_NAMES = ("TL", "TR", "BR", "BL")
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


def inspect_corners(
    image: np.ndarray, page: PageSize = PAGE
) -> tuple[list[int], dict[str, str]]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    img_h, img_w = gray.shape[:2]
    page_w_px, _ = mm_to_px(page.width_mm, page.height_mm, page)
    fid_px = mm_length_to_px(FIDUCIAL_SIZE_MM, page) * (min(img_w, img_h) / page_w_px)
    border_margin = fid_px * 0.6

    win_h, win_w = img_h // 4, img_w // 4
    windows = (
        ("TL", 0, 0, win_w, win_h, 0.0, 0.0),
        ("TR", img_w - win_w, 0, img_w, win_h, float(img_w), 0.0),
        ("BR", img_w - win_w, img_h - win_h, img_w, img_h, float(img_w), float(img_h)),
        ("BL", 0, img_h - win_h, win_w, img_h, 0.0, float(img_h)),
    )

    counts: list[int] = []
    report: dict[str, str] = {}
    for name, x0, y0, x1, y1, corner_x, corner_y in windows:
        sub = gray[y0:y1, x0:x1]
        if int(sub.max()) - int(sub.min()) < 40:
            counts.append(0)
            report[name] = "rejected(low_contrast)"
            continue
        _, binary = cv2.threshold(sub, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        window_count = 0
        closest_rejected: tuple[float, list[str]] | None = None

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 10:
                continue
            (cx, cy), (w, h), _ = cv2.minAreaRect(contour)
            if w == 0 or h == 0:
                continue
            long_side, short_side = max(w, h), min(w, h)
            bx, by, bw, bh = cv2.boundingRect(contour)
            gx, gy = x0 + bx, y0 + by
            gcx, gcy = x0 + cx, y0 + cy
            touches_border = (
                gx <= border_margin
                or (gx + bw) >= img_w - border_margin
                or gy <= border_margin
                or (gy + bh) >= img_h - border_margin
            )
            touches_image_edge = (
                gx <= 2 or gy <= 2 or (gx + bw) >= img_w - 2 or (gy + bh) >= img_h - 2
            )

            reasons: list[str] = []
            if area < 150:
                reasons.append(f"area({area:.0f}<150)")
            if not (fid_px * 0.75 <= long_side <= fid_px * 1.3):
                reasons.append(f"shape(long_side={long_side:.1f})")
            if area / (w * h) < 0.4:
                reasons.append(f"area_ratio({area / (w * h):.2f}<0.40)")
            if not touches_border and short_side / long_side < 0.75:
                reasons.append(f"shape(short/long={short_side / long_side:.2f}<0.75)")

            if not reasons:
                window_count += 1
            else:
                if touches_image_edge or touches_border:
                    reasons.append("touches_image_border")
                dist_sq = (gcx - corner_x) ** 2 + (gcy - corner_y) ** 2
                if dist_sq <= (fid_px * 3.5) ** 2 and (
                    closest_rejected is None or dist_sq < closest_rejected[0]
                ):
                    closest_rejected = (dist_sq, reasons)

        counts.append(window_count)
        if window_count > 0:
            report[name] = f"found({window_count})"
        elif closest_rejected is not None:
            report[name] = f"rejected({'+'.join(closest_rejected[1])})"
        else:
            report[name] = "rejected(no_contour_near_corner/touches_image_border)"
    return counts, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=10, help="Number of seeds per template.")
    args = parser.parse_args()

    failures_dir = Path(get_settings().autograde_data_dir) / "read_check_failures"
    bucket_totals: Counter[str] = Counter()
    bucket_failures: Counter[str] = Counter()
    max_observed_angle = 0.0

    for template in TEMPLATES:
        total_questions = 0
        mismatches = 0
        failed_sheets = 0
        by_kind: dict[QuestionMarkKind, Counter[str]] = {
            kind: Counter() for kind in MARK_KIND_ORDER
        }
        ratios_by_kind: dict[QuestionMarkKind, list[float]] = {
            QuestionMarkKind.BLANK: [],
            QuestionMarkKind.LIGHT: [],
            QuestionMarkKind.PERFECT: [],
        }

        for seed in range(args.seeds):
            sheet = generate_synthetic_sheet(template, seed=seed)
            abs_angle = abs(sheet.scan_artifacts.angle_deg) if sheet.scan_artifacts else 0.0
            max_observed_angle = max(max_observed_angle, abs_angle)
            bucket_label = next(
                label
                for label, lo, hi in ANGLE_BUCKETS
                if lo <= abs_angle < hi or (hi == 5.0 and abs_angle <= hi)
            )
            bucket_totals[bucket_label] += 1

            try:
                aligned = align_scan(sheet.image, template)
            except ScanAlignmentError as exc:
                failed_sheets += 1
                bucket_failures[bucket_label] += 1
                failures_dir.mkdir(parents=True, exist_ok=True)
                out_path = failures_dir / f"{template.template_id}_seed_{seed}.png"
                cv2.imwrite(str(out_path), sheet.image)
                cand_counts, corner_report = inspect_corners(sheet.image)
                corners_str = " ".join(f"{k}:{v}" for k, v in corner_report.items())
                print(
                    f"FAILED template={template.template_id} seed={seed} "
                    f"saved={out_path} fiducial_candidates={sum(cand_counts)}{cand_counts} "
                    f"corners=[{corners_str}] artifacts={sheet.scan_artifacts} error={exc}"
                )
                continue

            fills = classify_sheet(aligned, template)
            for plan in sheet.question_plans:
                total_questions += 1
                fill = fills[plan.question_number]
                by_kind[plan.mark_kind][fill.result.value] += 1
                if plan.mark_kind in ratios_by_kind:
                    if plan.mark_kind == QuestionMarkKind.BLANK:
                        ratio = max(bf.fill_ratio for _, bf in fill.bubble_fills)
                    else:
                        ratio = dict(fill.bubble_fills)[plan.marked_choices[0]].fill_ratio
                    ratios_by_kind[plan.mark_kind].append(ratio)
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
        for kind in (QuestionMarkKind.BLANK, QuestionMarkKind.LIGHT, QuestionMarkKind.PERFECT):
            arr = np.array(ratios_by_kind[kind])
            p_min, p10, p50, p90, p_max = np.percentile(arr, [0, 10, 50, 90, 100])
            print(
                f"FILL_RATIOS template={template.template_id} kind={kind.value:<7} "
                f"n={len(arr):<4} min={p_min:.4f} p10={p10:.4f} p50={p50:.4f} "
                f"p90={p90:.4f} max={p_max:.4f}"
            )
        print(f"MARK_KINDS template={template.template_id} " + " ".join(kind_parts))
        print(
            f"SUMMARY template={template.template_id} sheets={args.seeds} "
            f"failed_sheets={failed_sheets} questions={total_questions} mismatches={mismatches}"
        )

    print(
        f"\nANGLE_FAILURES generator_max_angle_deg={GENERATOR_MAX_ANGLE_DEG} "
        f"max_observed_angle_deg={max_observed_angle:.3f}"
    )
    print(f"{'bucket_deg':<12} {'sheets':>8} {'failed':>8} {'fail_rate':>10}")
    for label, _, _ in ANGLE_BUCKETS:
        total = bucket_totals[label]
        failed = bucket_failures[label]
        rate = f"{(failed / total) * 100.0:.1f}%" if total else "0.0%"
        print(f"{label:<12} {total:>8} {failed:>8} {rate:>10}")


if __name__ == "__main__":
    main()
