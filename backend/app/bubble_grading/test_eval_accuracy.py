from __future__ import annotations

from tools.eval_accuracy import evaluate_accuracy


def test_eval_accuracy_no_unflagged_errors_on_solid_or_mid_gray() -> None:
    report = evaluate_accuracy(seeds=5)
    assert report["alignment_failure_count"] == 0
    for mark_type in ("solid", "mid_gray"):
        row = report["per_mark_type"].get(mark_type)
        assert row is not None, f"Expected {mark_type} marks in 5-seed sample"
        assert row["wrong_and_unflagged"] == 0, (
            f"{mark_type} had {row['wrong_and_unflagged']} wrong-and-unflagged marks"
        )
