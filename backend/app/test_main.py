from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import anyio
import cv2
import pytest

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import TWENTY_QUESTIONS
from app.bubble_grading.classifier import classify_sheet
from app.bubble_grading.scoring import QuestionOutcome, score_sheet
from app.db.connection import init_db
from app.main import app
from app.sheet_rendering.renderer import (
    blank_canvas,
    bubble_position_px,
    bubble_radius_px,
    render_sheet,
)
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.synthetic_sheets.mark_drawing import draw_perfect_mark
from app.synthetic_sheets.question_plan import QuestionMarkKind

try:
    from fastapi.testclient import TestClient
except RuntimeError:

    @dataclass
    class _Response:
        status_code: int
        content: bytes

        @property
        def text(self) -> str:
            return self.content.decode("utf-8")

        def json(self) -> Any:
            return json.loads(self.text)

    class TestClient:  # type: ignore[no-redef]
        def __init__(self, asgi_app: Any) -> None:
            self._app = asgi_app

        def _request(
            self,
            method: str,
            path: str,
            *,
            json_body: Any = None,
            files: dict[str, tuple[str, bytes, str]] | None = None,
        ) -> _Response:
            headers: list[tuple[bytes, bytes]] = [(b"host", b"testserver")]
            body = b""
            if json_body is not None:
                body = json.dumps(json_body).encode("utf-8")
                headers.append((b"content-type", b"application/json"))
            elif files is not None:
                boundary = "----TestClientBoundary7MA4YWxkTrZu0gW"
                parts: list[bytes] = []
                for field_name, (filename, file_bytes, content_type) in files.items():
                    parts.append(
                        f"--{boundary}\r\n"
                        f'Content-Disposition: form-data; name="{field_name}"; '
                        f'filename="{filename}"\r\n'
                        f"Content-Type: {content_type}\r\n\r\n".encode("utf-8")
                        + file_bytes
                        + b"\r\n"
                    )
                parts.append(f"--{boundary}--\r\n".encode("utf-8"))
                body = b"".join(parts)
                headers.append(
                    (b"content-type", f"multipart/form-data; boundary={boundary}".encode("utf-8"))
                )
            headers.append((b"content-length", str(len(body)).encode("utf-8")))

            path_part, _, query_part = path.partition("?")
            scope = {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": method,
                "scheme": "http",
                "path": path_part,
                "raw_path": path_part.encode("utf-8"),
                "query_string": query_part.encode("utf-8"),
                "headers": headers,
                "client": ("127.0.0.1", 50000),
                "server": ("testserver", 80),
            }
            status_code = 500
            chunks: list[bytes] = []
            sent = False

            async def receive() -> dict[str, Any]:
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return {"type": "http.disconnect"}

            async def send(message: dict[str, Any]) -> None:
                nonlocal status_code
                if message["type"] == "http.response.start":
                    status_code = message["status"]
                elif message["type"] == "http.response.body":
                    chunks.append(message.get("body", b""))

            anyio.run(self._app, scope, receive, send)
            return _Response(status_code=status_code, content=b"".join(chunks))

        def get(self, path: str) -> _Response:
            return self._request("GET", path)

        def post(
            self,
            path: str,
            *,
            json: Any = None,
            files: dict[str, tuple[str, bytes, str]] | None = None,
        ) -> _Response:
            return self._request("POST", path, json_body=json, files=files)

        def patch(self, path: str, *, json: Any = None) -> _Response:
            return self._request("PATCH", path, json_body=json)


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("AUTOGRADE_DB_PATH", str(db_path))
    monkeypatch.setenv("AUTOGRADE_DATA_DIR", str(tmp_path))
    init_db()


def _encode_png(image) -> bytes:
    ok, buf = cv2.imencode(".png", image)
    assert ok
    return buf.tobytes()


def test_full_grading_and_review_workflow_over_http():
    client = TestClient(app)
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)

    test_resp = client.post(
        "/tests",
        json={
            "name": "Midterm",
            "template_id": TWENTY_QUESTIONS.template_id,
            "answer_key": sheet.answer_key,
        },
    )
    assert test_resp.status_code == 201
    test_id = test_resp.json()["id"]

    batch_resp = client.post(f"/tests/{test_id}/batches")
    assert batch_resp.status_code == 201
    batch_id = batch_resp.json()["id"]

    blank_png = _encode_png(render_sheet(TWENTY_QUESTIONS, page=PAGE))
    upload_resp = client.post(
        f"/batches/{batch_id}/scans",
        files={"file": ("blank.png", blank_png, "image/png")},
    )
    assert upload_resp.status_code == 201
    scan_job_id = upload_resp.json()["id"]

    grade_resp = client.post(f"/scans/{scan_job_id}/grade")
    assert grade_resp.status_code == 200
    graded = grade_resp.json()
    assert graded["scan_job_id"] == scan_job_id
    assert graded["needs_review"] is True

    assert client.post(f"/scans/{scan_job_id}/grade").status_code == 409

    results_resp = client.get(f"/batches/{batch_id}/results")
    assert results_resp.status_code == 200
    assert [r["id"] for r in results_resp.json()] == [graded["id"]]

    review_resp = client.get("/review-queue")
    assert review_resp.status_code == 200
    assert [r["id"] for r in review_resp.json()] == [graded["id"]]

    import csv
    import io

    csv_resp = client.get(f"/batches/{batch_id}/export.csv")
    assert csv_resp.status_code == 200
    rows = list(csv.reader(io.StringIO(csv_resp.text)))
    assert rows[0] == [
        "name",
        "date",
        "section",
        "score",
        "needs_review",
        *(f"q{i}" for i in range(1, 21)),
    ]
    assert rows[1] == [
        graded["name_text"],
        graded["date_text"],
        graded["section_text"],
        str(graded["score"]),
        str(graded["needs_review"]),
        *([""] * 20),
    ]


def test_domain_and_upload_errors_map_to_404_and_422():
    client = TestClient(app)

    assert (
        client.post(
            "/tests",
            json={"name": "Bad", "template_id": "20q_a4", "answer_key": ["A"]},
        ).status_code
        == 422
    )
    assert client.post("/tests/999/batches").status_code == 404
    assert client.get("/batches/999/results").status_code == 404
    assert client.post("/scans/999/grade").status_code == 404

    test_id = client.post(
        "/tests",
        json={"name": "Quiz", "template_id": "20q_a4", "answer_key": ["A"] * 20},
    ).json()["id"]
    batch_id = client.post(f"/tests/{test_id}/batches").json()["id"]

    assert (
        client.post(
            f"/batches/{batch_id}/scans",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/batches/{batch_id}/scans",
            files={"file": ("empty.png", b"", "image/png")},
        ).status_code
        == 422
    )

    unalignable_job_id = client.post(
        f"/batches/{batch_id}/scans",
        files={"file": ("white.png", _encode_png(blank_canvas(PAGE)), "image/png")},
    ).json()["id"]
    assert client.post(f"/scans/{unalignable_job_id}/grade").status_code == 422


def test_batch_results_and_corrections_for_never_graded_vs_failed_regrade():
    from pathlib import Path

    client = TestClient(app)
    test_id = client.post(
        "/tests",
        json={"name": "Quiz", "template_id": "20q_a4", "answer_key": ["A"] * 20},
    ).json()["id"]
    batch_id = client.post(f"/tests/{test_id}/batches").json()["id"]

    never_graded = client.post(
        f"/batches/{batch_id}/scans",
        files={"file": ("white.png", _encode_png(blank_canvas(PAGE)), "image/png")},
    ).json()
    assert client.post(f"/scans/{never_graded['id']}/grade").status_code == 422
    assert (
        client.patch(
            f"/scans/{never_graded['id']}/corrections",
            json={"corrections": {"1": "A"}},
        ).status_code
        == 422
    )

    good_scan = client.post(
        f"/batches/{batch_id}/scans",
        files={
            "file": (
                "sheet.png",
                _encode_png(render_sheet(TWENTY_QUESTIONS, page=PAGE)),
                "image/png",
            )
        },
    ).json()
    assert client.post(f"/scans/{good_scan['id']}/grade").status_code == 200

    Path(good_scan["raw_image_path"]).unlink()
    assert client.post(f"/scans/{good_scan['id']}/grade?force=true").status_code == 422

    patch_resp = client.patch(
        f"/scans/{good_scan['id']}/corrections",
        json={"corrections": {"1": "A"}},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["score"] == 5.0

    by_job = {
        r["scan_job_id"]: r for r in client.get(f"/batches/{batch_id}/results").json()
    }
    assert by_job[never_graded["id"]]["status"] == "failed"
    assert by_job[never_graded["id"]]["error_message"] != ""

    assert by_job[good_scan["id"]]["status"] == "failed"
    assert by_job[good_scan["id"]]["score"] == 5.0
    assert by_job[good_scan["id"]]["error_message"] != ""


def test_patch_identity_and_preserve_hand_edited_identity_on_regrade():
    client = TestClient(app)
    test_id = client.post(
        "/tests",
        json={"name": "Quiz", "template_id": "20q_a4", "answer_key": ["A"] * 20},
    ).json()["id"]
    batch_id = client.post(f"/tests/{test_id}/batches").json()["id"]

    scan = client.post(
        f"/batches/{batch_id}/scans",
        files={
            "file": (
                "sheet.png",
                _encode_png(render_sheet(TWENTY_QUESTIONS, page=PAGE)),
                "image/png",
            )
        },
    ).json()
    assert client.post(f"/scans/{scan['id']}/grade").status_code == 200

    identity_resp = client.patch(
        f"/scans/{scan['id']}/identity",
        json={"name_text": "Alice Kim", "date_text": "2026-11-09", "section_text": "4A"},
    )
    assert identity_resp.status_code == 200
    assert identity_resp.json()["name_text"] == "Alice Kim"
    assert identity_resp.json()["date_text"] == "2026-11-09"
    assert identity_resp.json()["section_text"] == "4A"

    regrade_resp = client.post(f"/scans/{scan['id']}/grade?force=true")
    assert regrade_resp.status_code == 200
    regraded = regrade_resp.json()
    assert regraded["name_text"] == "Alice Kim"
    assert regraded["date_text"] == "2026-11-09"
    assert regraded["section_text"] == "4A"


def test_marked_sheet_score_and_correction_end_to_end():
    client = TestClient(app)
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1128)

    test_id = client.post(
        "/tests",
        json={
            "name": "End-to-End Quiz",
            "template_id": TWENTY_QUESTIONS.template_id,
            "answer_key": sheet.answer_key,
        },
    ).json()["id"]
    batch_id = client.post(f"/tests/{test_id}/batches").json()["id"]

    scan_id = client.post(
        f"/batches/{batch_id}/scans",
        files={"file": ("marked.png", _encode_png(sheet.image), "image/png")},
    ).json()["id"]
    assert client.post(f"/scans/{scan_id}/grade").status_code == 200

    results = client.get(f"/batches/{batch_id}/results").json()
    assert len(results) == 1
    result = results[0]

    filled_kinds = {QuestionMarkKind.PERFECT, QuestionMarkKind.OFF_CENTER}
    expected_correct = sum(
        1
        for plan in sheet.question_plans
        if plan.mark_kind in filled_kinds
        and plan.marked_choices == (plan.correct_choice,)
    )
    expected_score = (expected_correct / len(sheet.question_plans)) * 100.0
    assert result["score"] == expected_score
    assert result["needs_review"] is True

    answers = json.loads(result["answers_json"])
    for plan in sheet.question_plans:
        if plan.mark_kind == QuestionMarkKind.PERFECT:
            assert answers[plan.question_number - 1] == plan.marked_choices[0]

    flags = json.loads(result["flags_json"])
    flagged_questions = flags["ambiguous"] + flags["multiple"]
    assert len(flagged_questions) == 1
    flagged_q = flagged_questions[0]

    patch_resp = client.patch(
        f"/scans/{scan_id}/corrections",
        json={"corrections": {str(flagged_q): sheet.answer_key[flagged_q - 1]}},
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["score"] == ((expected_correct + 1) / len(sheet.question_plans)) * 100.0
    assert updated["needs_review"] is False


def test_ungraded_scan_appears_pending_and_csv_escapes_formulas():
    import csv
    import io

    client = TestClient(app)
    test_id = client.post(
        "/tests",
        json={"name": "Quiz", "template_id": "20q_a4", "answer_key": ["A"] * 20},
    ).json()["id"]
    batch_id = client.post(f"/tests/{test_id}/batches").json()["id"]

    ungraded = client.post(
        f"/batches/{batch_id}/scans",
        files={
            "file": (
                "sheet.png",
                _encode_png(render_sheet(TWENTY_QUESTIONS, page=PAGE)),
                "image/png",
            )
        },
    ).json()

    results = client.get(f"/batches/{batch_id}/results").json()
    assert len(results) == 1
    assert results[0]["scan_job_id"] == ungraded["id"]
    assert results[0]["status"] == "pending"
    assert results[0]["score"] == 0.0
    assert results[0]["answers_json"] == "[]"

    assert client.post(f"/scans/{ungraded['id']}/grade").status_code == 200
    assert (
        client.patch(
            f"/scans/{ungraded['id']}/identity",
            json={"name_text": "=1+1"},
        ).status_code
        == 200
    )

    rows = list(csv.reader(io.StringIO(client.get(f"/batches/{batch_id}/export.csv").text)))
    assert rows[1][0] == "'=1+1"


def test_trace_ambiguous_flows_through_scoring_review_corrections_and_csv():
    import csv
    import io

    client = TestClient(app)
    answer_key = ["A", "B"] + ["C"] * 18
    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    # Q1: faint trace on the correct letter "A"; Q2: solid mark on the correct letter "B".
    cv2.circle(
        canvas,
        bubble_position_px(TWENTY_QUESTIONS, 1, 0, PAGE),
        radius_px,
        (180, 180, 180),
        -1,
    )
    draw_perfect_mark(canvas, bubble_position_px(TWENTY_QUESTIONS, 2, 1, PAGE), radius_px)

    summary = score_sheet(classify_sheet(canvas, TWENTY_QUESTIONS, PAGE), answer_key)
    assert summary.question_outcomes[1] == QuestionOutcome.AMBIGUOUS
    assert summary.correct_count == 1
    assert summary.wrong_count == 0
    assert summary.ambiguous_count == 1

    test_id = client.post(
        "/tests",
        json={"name": "Trace Quiz", "template_id": "20q_a4", "answer_key": answer_key},
    ).json()["id"]
    batch_id = client.post(f"/tests/{test_id}/batches").json()["id"]
    scan_id = client.post(
        f"/batches/{batch_id}/scans",
        files={"file": ("trace.png", _encode_png(canvas), "image/png")},
    ).json()["id"]

    graded = client.post(f"/scans/{scan_id}/grade").json()
    assert graded["score"] == 5.0
    assert graded["needs_review"] is True
    assert json.loads(graded["answers_json"])[:3] == ["A", "B", ""]
    assert json.loads(graded["flags_json"]) == {"ambiguous": [1], "multiple": []}

    rows_before = list(csv.reader(io.StringIO(client.get(f"/batches/{batch_id}/export.csv").text)))
    assert rows_before[1][3:8] == ["5.0", "True", "A", "B", ""]

    updated = client.patch(
        f"/scans/{scan_id}/corrections",
        json={"corrections": {"1": "A"}},
    ).json()
    assert updated["score"] == 10.0
    assert updated["needs_review"] is False

    rows_after = list(csv.reader(io.StringIO(client.get(f"/batches/{batch_id}/export.csv").text)))
    assert rows_after[1][3:8] == ["10.0", "False", "A", "B", ""]





