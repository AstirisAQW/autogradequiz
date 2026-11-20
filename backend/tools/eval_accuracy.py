"""Objective bubble-reading accuracy harness over synthetic sheets.

Usage (from backend/):
    PYTHONPATH=. python tools/eval_accuracy.py
    PYTHONPATH=. python tools/eval_accuracy.py --seeds 50 --out tools/eval_baseline.json
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from app.answer_sheet_templates.catalog import get_template_spec, list_template_specs
from app.bubble_grading.classifier import BubbleResult, QuestionFill, classify_sheet
from app.scan_alignment.align_scan import ScanAlignmentError, align_scan
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.synthetic_sheets.question_plan import QuestionPlan, generate_answer_key


def _is_correct_read(plan: QuestionPlan, mark_type: str, fill: QuestionFill) -> bool:
    if mark_type == "blank":
        return fill.result == BubbleResult.BLANK and fill.marked_choices == ()
    if mark_type == "double":
        return (
            fill.result == BubbleResult.MULTIPLE
            and set(fill.marked_choices) == set(plan.marked_choices)
        )
    return fill.result == BubbleResult.FILLED and fill.marked_choices == plan.marked_choices


def _bubble_ratios(fill: QuestionFill) -> dict[str, dict[str, float]]:
    return {
        choice: {
            "fill_ratio": round(bf.fill_ratio, 4),
            "trace_ratio": round(bf.trace_ratio, 4),
        }
        for choice, bf in fill.bubble_fills
    }


def evaluate_accuracy(
    seeds: int = 50,
    template_ids: list[str] | None = None,
) -> dict[str, Any]:
    specs = (
        [get_template_spec(tid) for tid in template_ids]
        if template_ids
        else list_template_specs()
    )

    stats: dict[str, dict[str, int]] = defaultdict(
        lambda: {
            "count": 0,
            "correct": 0,
            "candidate_correct": 0,
            "accepted": 0,
            "flagged": 0,
            "wrong_and_unflagged": 0,
            "read_blank": 0,
            "read_wrong_letter": 0,
        }
    )
    total_sheets = 0
    alignment_failures: list[dict[str, Any]] = []
    total_questions = 0
    total_flagged = 0
    light_gray_misses: list[dict[str, Any]] = []

    for spec in specs:
        for seed in range(seeds):
            total_sheets += 1
            key_rng = np.random.default_rng(seed + 100_000)
            answer_key = generate_answer_key(spec.question_count, key_rng)
            sheet = generate_synthetic_sheet(spec, seed, answer_key=answer_key)

            try:
                aligned = align_scan(sheet.image, spec)
            except ScanAlignmentError as exc:
                alignment_failures.append(
                    {"template_id": spec.template_id, "seed": seed, "error": str(exc)}
                )
                continue

            fills = classify_sheet(aligned, spec)

            for plan, mark_type in zip(sheet.question_plans, sheet.mark_types):
                fill = fills[plan.question_number]
                total_questions += 1
                row = stats[mark_type]
                row["count"] += 1

                flagged = fill.result in (BubbleResult.AMBIGUOUS, BubbleResult.MULTIPLE)
                correct = _is_correct_read(plan, mark_type, fill)
                if flagged:
                    row["flagged"] += 1
                    total_flagged += 1
                if correct:
                    row["correct"] += 1

                if mark_type not in ("blank", "double"):
                    truth_choice = plan.marked_choices[0]
                    if truth_choice in fill.marked_choices:
                        row["candidate_correct"] += 1
                    if fill.result == BubbleResult.FILLED and fill.marked_choices == (
                        truth_choice,
                    ):
                        row["accepted"] += 1

                if (not flagged) and (not correct):
                    row["wrong_and_unflagged"] += 1
                    if fill.result == BubbleResult.BLANK:
                        row["read_blank"] += 1
                    elif fill.result == BubbleResult.FILLED:
                        row["read_wrong_letter"] += 1

                    if mark_type == "light_gray":
                        bubbles = _bubble_ratios(fill)
                        truth_choice = plan.marked_choices[0]
                        light_gray_misses.append(
                            {
                                "seed": seed,
                                "template_id": spec.template_id,
                                "question_number": plan.question_number,
                                "truth_choice": truth_choice,
                                "result": fill.result.value,
                                "marked_choices": list(fill.marked_choices),
                                "truth_trace_ratio": bubbles[truth_choice]["trace_ratio"],
                                "truth_fill_ratio": bubbles[truth_choice]["fill_ratio"],
                                "bubbles": bubbles,
                            }
                        )

    light_gray_misses.sort(key=lambda m: (m["truth_trace_ratio"], m["truth_fill_ratio"]))

    per_mark_type: dict[str, dict[str, Any]] = {}
    for mark_type in sorted(stats):
        row = stats[mark_type]
        n = row["count"]
        is_single = mark_type not in ("blank", "double")
        per_mark_type[mark_type] = {
            "count": n,
            "correct": row["correct"],
            "candidate_correct": row["candidate_correct"] if is_single else None,
            "accepted": row["accepted"],
            "flagged": row["flagged"],
            "wrong_and_unflagged": row["wrong_and_unflagged"],
            "read_blank": row["read_blank"],
            "read_wrong_letter": row["read_wrong_letter"],
            "correct_pct": round(100.0 * row["correct"] / n, 2) if n else 0.0,
            "candidate_correct_pct": (
                round(100.0 * row["candidate_correct"] / n, 2) if (n and is_single) else None
            ),
            "accepted_pct": round(100.0 * row["accepted"] / n, 2) if n else 0.0,
            "flagged_pct": round(100.0 * row["flagged"] / n, 2) if n else 0.0,
            "wrong_and_unflagged_pct": (
                round(100.0 * row["wrong_and_unflagged"] / n, 2) if n else 0.0
            ),
        }

    return {
        "seeds": seeds,
        "templates": [s.template_id for s in specs],
        "total_sheets": total_sheets,
        "alignment_failures": alignment_failures,
        "alignment_failure_count": len(alignment_failures),
        "total_questions": total_questions,
        "overall_flagged": total_flagged,
        "overall_flagged_pct": (
            round(100.0 * total_flagged / total_questions, 2) if total_questions else 0.0
        ),
        "per_mark_type": per_mark_type,
        "light_gray_worst_10": light_gray_misses[:10],
    }


def format_report(report: dict[str, Any]) -> str:
    lines = [
        f"Seeds: 0..{report['seeds'] - 1} | Templates: {', '.join(report['templates'])}",
        (
            f"Sheets: {report['total_sheets']} | "
            f"Alignment failures: {report['alignment_failure_count']} | "
            f"Overall flagged: {report['overall_flagged']}/{report['total_questions']} "
            f"({report['overall_flagged_pct']:.2f}%)"
        ),
        "",
        (
            f"{'mark_type':<12} {'count':>6} {'correct%':>9} {'cand_ok%':>9} "
            f"{'accepted%':>10} {'flagged%':>9} {'wrong_unflg%':>13}"
        ),
        "-" * 74,
    ]
    for mark_type, row in report["per_mark_type"].items():
        cand_str = (
            f"{row['candidate_correct_pct']:>8.2f}%"
            if row["candidate_correct_pct"] is not None
            else f"{'-':>9}"
        )
        lines.append(
            f"{mark_type:<12} {row['count']:>6d} "
            f"{row['correct_pct']:>8.2f}% "
            f"{cand_str} "
            f"{row['accepted_pct']:>9.2f}% "
            f"{row['flagged_pct']:>8.2f}% "
            f"{row['wrong_and_unflagged_pct']:>12.2f}%"
        )

    lines.append("")
    lines.append("Wrong-and-unflagged breakdown:")
    any_wrong = False
    for mark_type, row in report["per_mark_type"].items():
        if row["wrong_and_unflagged"] > 0 or mark_type == "light_gray":
            any_wrong = True
            lines.append(
                f"  {mark_type}: total={row['wrong_and_unflagged']} "
                f"(read_blank={row['read_blank']}, "
                f"read_wrong_letter={row['read_wrong_letter']})"
            )
    if not any_wrong:
        lines.append("  none")

    worst = report.get("light_gray_worst_10", [])
    if worst:
        lines.append("")
        lines.append("Worst 10 light_gray wrong-and-unflagged examples:")
        for ex in worst:
            ratios = " ".join(
                f"{c}={vals['fill_ratio']:.3f}/{vals['trace_ratio']:.3f}"
                for c, vals in ex["bubbles"].items()
            )
            lines.append(
                f"  seed={ex['seed']} {ex['template_id']} Q{ex['question_number']} "
                f"truth={ex['truth_choice']} read={ex['result']}({','.join(ex['marked_choices'])}) "
                f"[fill/trace: {ratios}]"
            )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, default=50, help="Evaluate seeds 0..N-1.")
    parser.add_argument(
        "--templates", nargs="*", default=None, help="Template ids (default: all)."
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).with_name("eval_baseline.json"),
        help="Where to write JSON results.",
    )
    args = parser.parse_args()

    report = evaluate_accuracy(seeds=args.seeds, template_ids=args.templates)
    print(format_report(report))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nSaved baseline to {args.out}")


if __name__ == "__main__":
    main()
