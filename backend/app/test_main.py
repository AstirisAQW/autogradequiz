from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anyio
import cv2
import pytest

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import TWENTY_QUESTIONS
from app.answer_sheet_templates.geometry import (
    bubble_position_px,
    bubble_radius_px,
    key_version_bubble_position_px,
    key_version_bubble_radius_px,
)
from app.main import app
from app.routers import MAX_UPLOAD_BYTES
from app.sheet_rendering.renderer import blank_canvas, render_sheet
from app.synthetic_sheets.mark_drawing import draw_perfect_mark

try:
    from fastapi.testclient import TestClient
except Exception:  # pragma: no cover

    @dataclass
    class _Response:
        status_code: int
        content: bytes
        headers: dict[str, str]

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
            data: dict[str, str] | None = None,
            files: dict[str, tuple[str, bytes, str]] | None = None,
        ) -> _Response:
            headers: list[tuple[bytes, bytes]] = [(b"host", b"testserver")]
            body = b""
            if json_body is not None:
                body = json.dumps(json_body).encode("utf-8")
                headers.append((b"content-type", b"application/json"))
            elif files is not None or data is not None:
                boundary = "----TestClientBoundary7MA4YWxkTrZu0gW"
                parts: list[bytes] = []
                for field_name, field_val in (data or {}).items():
                    parts.append(
                        f"--{boundary}\r\n"
                        f'Content-Disposition: form-data; name="{field_name}"\r\n\r\n'
                        f"{field_val}\r\n".encode("utf-8")
                    )
                for field_name, (filename, file_bytes, content_type) in (
                    files or {}
                ).items():
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
                    (
                        b"content-type",
                        f"multipart/form-data; boundary={boundary}".encode("utf-8"),
                    )
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
                "client": ("127.0.0.1", 12345),
                "server": ("testserver", 80),
            }
            sent = False
            status_code = 500
            response_headers: dict[str, str] = {}
            chunks: list[bytes] = []

            async def receive() -> dict[str, Any]:
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return {"type": "http.disconnect"}

            async def send(message: dict[str, Any]) -> None:
                nonlocal status_code, response_headers
                if message["type"] == "http.response.start":
                    status_code = message["status"]
                    response_headers = {
                        k.decode("latin-1").lower(): v.decode("latin-1")
                        for k, v in message.get("headers", [])
                    }
                elif message["type"] == "http.response.body":
                    chunks.append(message.get("body", b""))

            anyio.run(self._app, scope, receive, send)
            return _Response(
                status_code=status_code,
                content=b"".join(chunks),
                headers=response_headers,
            )

        def get(self, path: str) -> _Response:
            return self._request("GET", path)

        def post(
            self,
            path: str,
            *,
            json: Any = None,
            data: dict[str, str] | None = None,
            files: dict[str, tuple[str, bytes, str]] | None = None,
        ) -> _Response:
            return self._request(
                "POST", path, json_body=json, data=data, files=files
            )

        def put(self, path: str, *, json: Any = None) -> _Response:
            return self._request("PUT", path, json_body=json)


def _encode_png(image) -> bytes:
    ok, buf = cv2.imencode(".png", image)
    assert ok
    return buf.tobytes()


def test_health_and_test_ui_and_templates():
    client = TestClient(app)

    assert client.get("/health").json() == {"status": "ok"}

    root_resp = client.get("/")
    assert root_resp.status_code == 307
    assert root_resp.headers.get("location") == "/test-ui"

    assert client.get("/favicon.ico").status_code == 204

    ui_resp = client.get("/test-ui")
    assert ui_resp.status_code == 200
    assert "AutoGradeQuiz Backend Sandbox" in ui_resp.text

    templates_resp = client.get("/templates")
    assert templates_resp.status_code == 200
    assert templates_resp.json() == [
        {"template_id": "20q_a4", "question_count": 20},
        {"template_id": "50q_a4", "question_count": 50},
        {"template_id": "100q_a4", "question_count": 100},
    ]


def test_scan_key_and_synthetic_sheet_endpoints():
    client = TestClient(app)

    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    for q in range(1, 21):
        draw_perfect_mark(
            canvas, bubble_position_px(TWENTY_QUESTIONS, q, 0, PAGE), radius_px
        )

    key_resp = client.post(
        "/tests/scan-key?template_id=20q_a4",
        files={"file": ("key.png", _encode_png(canvas), "image/png")},
    )
    assert key_resp.status_code == 200
    assert key_resp.json()["answer_key"] == ["A"] * 20
    assert key_resp.json()["flagged_questions"] == []

    synth = client.post(
        "/test-ui/synthetic-sheet", json={"template_id": "20q_a4", "seed": 2}
    )
    assert synth.status_code == 200
    synth_body = synth.json()
    assert len(synth_body["answer_key"]) == 20
    assert "png_base64" not in synth_body
    synth_jpeg = base64.b64decode(synth_body["jpeg_base64"])
    assert synth_jpeg[:2] == b"\xff\xd8"
    assert len(synth_jpeg) < 2_000_000

    synth_with_png = client.post(
        "/test-ui/synthetic-sheet",
        json={"template_id": "20q_a4", "seed": 2, "include_png": True},
    )
    assert synth_with_png.status_code == 200
    assert base64.b64decode(synth_with_png.json()["png_base64"])[:4] == b"\x89PNG"

    bad_kv = client.post(
        "/test-ui/synthetic-sheet",
        json={"template_id": "20q_a4", "seed": 2, "key_version": "Z"},
    )
    assert bad_kv.status_code == 422


def test_stateless_grade_synthetic_sheet_and_4xx_validation():
    client = TestClient(app)

    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    for q in range(1, 21):
        choice_idx = 0 if q <= 10 else 1
        pos = bubble_position_px(TWENTY_QUESTIONS, q, choice_idx, PAGE)
        draw_perfect_mark(canvas, pos, radius_px)

    key_payload = {
        "answer_key": ["A"] * 10 + ["C"] * 10,
        "points": [2.0] * 10 + [1.0] * 10,
    }
    resp = client.post(
        "/grade",
        data={
            "template_id": "20q_a4",
            "answer_key": json.dumps(key_payload),
            "include_graded_image": "true",
        },
        files={"file": ("sheet.png", _encode_png(canvas), "image/png")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["answers"] == ["A"] * 10 + ["B"] * 10
    assert body["flags"] == {}
    assert len(body["confidence"]) == 20
    assert body["score"] == pytest.approx((20.0 / 30.0) * 100.0)
    assert body["needs_review"] is False
    jpeg_bytes = base64.b64decode(body["aligned_image_jpeg_base64"])
    assert jpeg_bytes[:2] == b"\xff\xd8"
    graded_jpeg_bytes = base64.b64decode(body["graded_image_jpeg_base64"])
    assert graded_jpeg_bytes[:2] == b"\xff\xd8"
    assert body["workspace_paths"] is None

    # Default /grade (without include_graded_image) omits graded_image_jpeg_base64
    resp_default = client.post(
        "/grade",
        data={"template_id": "20q_a4", "answer_key": json.dumps(key_payload)},
        files={"file": ("sheet.png", _encode_png(canvas), "image/png")},
    )
    assert resp_default.status_code == 200
    assert resp_default.json()["graded_image_jpeg_base64"] == ""

    valid_img = _encode_png(canvas)
    valid_key = json.dumps({"answer_key": ["A"] * 20, "points": [1.0] * 20})

    # 1. Non-image file or corrupt image bytes
    assert (
        client.post(
            "/grade",
            data={"template_id": "20q_a4", "answer_key": valid_key},
            files={"file": ("notes.txt", b"not an image", "text/plain")},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/grade",
            data={"template_id": "20q_a4", "answer_key": valid_key},
            files={"file": ("corrupt.png", b"bad-bytes", "image/png")},
        ).status_code
        == 422
    )
    # Missing fiducials -> 422
    assert (
        client.post(
            "/grade",
            data={"template_id": "20q_a4", "answer_key": valid_key},
            files={"file": ("blank.png", _encode_png(blank_canvas(PAGE)), "image/png")},
        ).status_code
        == 422
    )

    # 2. Unknown template_id -> 422
    assert (
        client.post(
            "/grade",
            data={"template_id": "unknown_template", "answer_key": valid_key},
            files={"file": ("sheet.png", valid_img, "image/png")},
        ).status_code
        == 422
    )

    # 3. Malformed keys or wrong length -> 422
    for bad_key in [
        "{not-json",
        json.dumps(["A"] * 20),
        json.dumps({"answers": ["A"] * 20}),
        json.dumps({"answer_key": ["Z"] * 20}),
        json.dumps({"answer_key": ["A"] * 5}),
    ]:
        assert (
            client.post(
                "/grade",
                data={"template_id": "20q_a4", "answer_key": bad_key},
                files={"file": ("sheet.png", valid_img, "image/png")},
            ).status_code
            == 422
        )

    # 4. Image exceeding 10 MB limit -> 422
    oversized = b"\x89PNG\r\n\x1a\n" + b"0" * MAX_UPLOAD_BYTES
    assert (
        client.post(
            "/grade",
            data={"template_id": "20q_a4", "answer_key": valid_key},
            files={"file": ("huge.png", oversized, "image/png")},
        ).status_code
        == 422
    )


def test_workspace_endpoints_and_grade_save(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    ws_dir = tmp_path / "workspace"
    monkeypatch.setenv("AUTOGRADE_WORKSPACE_DIR", str(ws_dir))
    client = TestClient(app)

    status_resp = client.get("/workspace/status")
    assert status_resp.status_code == 200
    status_body = status_resp.json()
    assert status_body["has_workspace_json"] is False
    assert status_body["template_files"] == ["100q_a4.pdf", "20q_a4.pdf", "50q_a4.pdf"]

    assert client.get("/workspace/data").status_code == 404

    payload = {
        "exportVersion": 1,
        "quizzes": [],
        "batches": [],
        "papers": [],
        "sections": [],
        "students": [],
    }
    put_resp = client.put("/workspace/data", json=payload)
    assert put_resp.status_code == 200
    assert put_resp.json()["ok"] is True

    get_resp = client.get("/workspace/data")
    assert get_resp.status_code == 200
    assert get_resp.json() == payload

    assert client.put("/workspace/data", json={"quizzes": []}).status_code == 422

    pdf_resp = client.get("/workspace/templates/20q_a4")
    assert pdf_resp.status_code == 200
    assert pdf_resp.content[:4] == b"%PDF"

    assert client.get("/workspace/templates/unknown").status_code == 422

    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    for q in range(1, 21):
        draw_perfect_mark(canvas, bubble_position_px(TWENTY_QUESTIONS, q, 0, PAGE), radius_px)

    grade_resp = client.post(
        "/grade",
        data={
            "template_id": "20q_a4",
            "answer_key": json.dumps({"answer_key": ["A"] * 20}),
            "save_to_workspace": "true",
            "quiz_id": "quiz-123456",
            "quiz_name": "Midterm Quiz",
            "paper_id": "paper-abcdef",
        },
        files={"file": ("sheet.png", _encode_png(canvas), "image/png")},
    )
    assert grade_resp.status_code == 200
    ws_paths = grade_resp.json()["workspace_paths"]
    assert ws_paths is not None
    assert (ws_dir / ws_paths["raw"]).is_file()
    assert (ws_dir / ws_paths["aligned"]).is_file()
    assert (ws_dir / ws_paths["graded"]).is_file()
    assert client.get("/workspace/status").json()["scan_count"] == 1

    # Syncing workspace.json without that paper prunes orphaned scan artifacts on disk
    assert client.put("/workspace/data", json=payload).status_code == 200
    assert not (ws_dir / ws_paths["raw"]).exists()
    assert client.get("/workspace/status").json()["scan_count"] == 0


def test_grade_endpoint_key_version_and_partial_credit():
    client = TestClient(app)

    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    r_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    # Mark Key Version B and answer all 20 questions with C (except Q1 marked E)
    draw_perfect_mark(
        canvas,
        key_version_bubble_position_px(1, PAGE),
        key_version_bubble_radius_px(PAGE),
    )
    draw_perfect_mark(canvas, bubble_position_px(TWENTY_QUESTIONS, 1, 4, PAGE), r_px)
    for q in range(2, 21):
        draw_perfect_mark(canvas, bubble_position_px(TWENTY_QUESTIONS, q, 2, PAGE), r_px)

    rules_b = [
        {"alternate_answers": [{"choice": "E", "points": 0.5}], "incorrect_points": -0.25}
        if q == 1
        else {"alternate_answers": [], "incorrect_points": 0.0}
        for q in range(1, 21)
    ]
    payload = {
        "answer_key": ["A"] * 20,
        "points": [1.0] * 20,
        "key_versions": {
            "B": {
                "answer_key": ["C"] * 20,
                "points": [1.0] * 20,
                "question_rules": rules_b,
            }
        },
    }
    resp = client.post(
        "/grade",
        data={"template_id": "20q_a4", "answer_key": json.dumps(payload)},
        files={"file": ("kv_b.png", _encode_png(canvas), "image/png")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["key_version"] == "B"
    assert body["key_version_detected"] == "B"
    assert body["key_version_flagged"] is False
    # 19 full credit (19.0) + Q1 alternate E (0.5) = 19.5 / 20.0 = 97.5%
    assert body["score"] == pytest.approx(97.5)

    # Tiny 2x2 PNG -> 422, not 500
    tiny = canvas[:2, :2].copy()
    assert (
        client.post(
            "/grade",
            data={"template_id": "20q_a4", "answer_key": json.dumps({"answer_key": ["A"] * 20})},
            files={"file": ("tiny.png", _encode_png(tiny), "image/png")},
        ).status_code
        == 422
    )

    # NaN / Infinity constants -> 422, not 500
    assert (
        client.post(
            "/grade",
            data={
                "template_id": "20q_a4",
                "answer_key": '{"answer_key": ["A",' + ",".join(['"A"'] * 19) + '],"points": ['
                + ",".join(["NaN"] * 20)
                + "]}",
            },
            files={"file": ("kv_b.png", _encode_png(canvas), "image/png")},
        ).status_code
        == 422
    )

    # Marking undefined Key Version C on an A+B quiz flags the paper for review
    canvas_c = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    draw_perfect_mark(
        canvas_c,
        key_version_bubble_position_px(2, PAGE),
        key_version_bubble_radius_px(PAGE),
    )
    for q in range(1, 21):
        draw_perfect_mark(canvas_c, bubble_position_px(TWENTY_QUESTIONS, q, 0, PAGE), r_px)
    resp_c = client.post(
        "/grade",
        data={"template_id": "20q_a4", "answer_key": json.dumps(payload)},
        files={"file": ("kv_c.png", _encode_png(canvas_c), "image/png")},
    )
    assert resp_c.status_code == 200
    body_c = resp_c.json()
    assert body_c["key_version_detected"] == "C"
    assert body_c["key_version"] == "A"
    assert body_c["key_version_flagged"] is True
    assert body_c["needs_review"] is True
