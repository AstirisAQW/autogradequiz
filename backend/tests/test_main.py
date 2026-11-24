from __future__ import annotations

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
from app.sheet_rendering.renderer import blank_canvas, render_sheet
from app.stateless_router import MAX_UPLOAD_BYTES
from tests.synthetic_sheets.mark_drawing import draw_perfect_mark

try:
    from fastapi.testclient import TestClient
except Exception:

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

    class TestClient:
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

        def patch(self, path: str, *, json: Any = None) -> _Response:
            return self._request("PATCH", path, json_body=json)

        def delete(self, path: str) -> _Response:
            return self._request("DELETE", path)


def _encode_png(image) -> bytes:
    ok, buf = cv2.imencode(".png", image)
    assert ok
    return buf.tobytes()


def test_health_and_favicon():
    client = TestClient(app)

    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/favicon.ico").status_code == 204


def test_scan_key_endpoint_and_upload_validation():
    client = TestClient(app)

    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    for q in range(1, 21):
        draw_perfect_mark(
            canvas, bubble_position_px(TWENTY_QUESTIONS, q, 0, PAGE), radius_px
        )
    valid_img = _encode_png(canvas)

    key_resp = client.post(
        "/scan-key?template_id=20q_a4",
        files={"file": ("key.png", valid_img, "image/png")},
    )
    assert key_resp.status_code == 200
    assert key_resp.json()["answer_key"] == ["A"] * 20
    assert key_resp.json()["flagged_questions"] == []

    assert (
        client.post(
            "/scan-key?template_id=20q_a4",
            files={"file": ("notes.txt", b"not an image", "text/plain")},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/scan-key?template_id=20q_a4",
            files={"file": ("corrupt.png", b"bad-bytes", "image/png")},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/scan-key?template_id=20q_a4",
            files={"file": ("blank.png", _encode_png(blank_canvas(PAGE)), "image/png")},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/scan-key?template_id=20q_a4",
            files={"file": ("tiny.png", _encode_png(canvas[:2, :2].copy()), "image/png")},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/scan-key?template_id=unknown_template",
            files={"file": ("sheet.png", valid_img, "image/png")},
        ).status_code
        == 422
    )
    oversized = b"\x89PNG\r\n\x1a\n" + b"0" * MAX_UPLOAD_BYTES
    assert (
        client.post(
            "/scan-key?template_id=20q_a4",
            files={"file": ("huge.png", oversized, "image/png")},
        ).status_code
        == 422
    )


def test_workspace_folder_endpoints_and_grade_save(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    ws_dir = tmp_path / "workspace"
    monkeypatch.setenv("AUTOGRADE_WORKSPACE_DIR", str(ws_dir))
    client = TestClient(app)

    assert client.get("/workspace/folders").json() == []
    assert not ws_dir.exists()

    assert client.post("/workspace/folders", json={"name": "CON"}).status_code == 422
    created = client.post("/workspace/folders", json={"name": "Midterm Grade 10"})
    assert created.status_code == 201
    assert created.json()["name"] == "Midterm Grade 10"
    assert created.json()["needsReviewCount"] == 0
    assert client.post("/workspace/folders", json={"name": "midterm grade 10"}).status_code == 409

    pdf_resp = client.get("/workspace/templates/20q_a4")
    assert pdf_resp.status_code == 200
    assert pdf_resp.content[:4] == b"%PDF"
    assert client.get("/workspace/templates/unknown").status_code == 422
    assert [p.name for p in ws_dir.iterdir()] == ["Midterm Grade 10"]

    cls_resp = client.post(
        "/workspace/folders/Midterm Grade 10/classes",
        json={"name": "10-Rizal", "term": "Q1"},
    )
    assert cls_resp.status_code == 201
    cls_id = cls_resp.json()["id"]

    stu = client.post(
        "/workspace/folders/Midterm Grade 10/students",
        json={
            "studentCode": "10021",
            "firstName": "Ada",
            "lastName": "Lovelace",
            "classIds": [cls_id],
        },
    )
    assert stu.status_code == 201
    stu_id = stu.json()["id"]

    quiz_resp = client.post(
        "/workspace/folders/Midterm Grade 10/quizzes",
        json={
            "name": "Unit 3 Biology",
            "templateId": "20q_a4",
            "answerKey": ["A"] * 20,
            "classIds": [cls_id],
        },
    )
    assert quiz_resp.status_code == 201
    quiz_id = quiz_resp.json()["id"]

    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    for q in range(1, 21):
        draw_perfect_mark(canvas, bubble_position_px(TWENTY_QUESTIONS, q, 0, PAGE), radius_px)

    grade_resp = client.post(
        f"/workspace/folders/Midterm Grade 10/quizzes/{quiz_id}/grade",
        files={"file": ("sheet.png", _encode_png(canvas), "image/png")},
    )
    assert grade_resp.status_code == 201
    paper = grade_resp.json()
    paper_id = paper["id"]
    assert paper["quizId"] == quiz_id
    assert paper["score"] == pytest.approx(100.0)

    quiz_dirs = list((ws_dir / "Midterm Grade 10" / "quizzes").iterdir())
    assert len(quiz_dirs) == 1
    assert quiz_dirs[0].name.startswith("unit-3-biology-")
    assert (quiz_dirs[0] / "quiz.json").is_file()
    assert (quiz_dirs[0] / "papers" / f"{paper_id.replace('-', '')[:6]}.json").is_file()
    for kind, prefix in (("raw", b"\x89PNG"), ("aligned", b"\xff\xd8")):
        img_resp = client.get(
            f"/workspace/folders/Midterm Grade 10/quizzes/{quiz_id}/papers/{paper_id}/image/{kind}"
        )
        assert img_resp.status_code == 200
        assert img_resp.content[: len(prefix)] == prefix
    assert (
        client.get(
            f"/workspace/folders/Midterm Grade 10/quizzes/{quiz_id}/papers/{paper_id}/image/unknown"
        ).status_code
        == 422
    )
    assert not (quiz_dirs[0] / "graded").exists()

    rev_resp = client.patch(
        f"/workspace/folders/Midterm Grade 10/quizzes/{quiz_id}/papers/{paper_id}",
        json={"identity": {"studentId": stu_id}},
    )
    assert rev_resp.status_code == 200
    assert "Lovelace-Ada" in rev_resp.json()["imagePaths"]["aligned"]
    assert (
        client.get(
            f"/workspace/folders/Midterm Grade 10/quizzes/{quiz_id}/papers/{paper_id}/image/aligned"
        ).status_code
        == 200
    )

    csv_resp = client.get(
        f"/workspace/folders/Midterm Grade 10/quizzes/{quiz_id}/export.csv"
    )
    assert csv_resp.status_code == 200
    assert "Lovelace, Ada" in csv_resp.text

    copy_resp = client.post(
        "/workspace/folders",
        json={"name": "Finals Grade 10", "copyRosterFrom": "Midterm Grade 10"},
    )
    assert copy_resp.status_code == 201
    assert copy_resp.json()["studentCount"] == 1
    assert copy_resp.json()["quizCount"] == 0

    assert (
        client.patch(
            "/workspace/folders/Finals Grade 10", json={"name": "Finals Grade 11"}
        ).status_code
        == 200
    )
    assert client.delete("/workspace/folders/Finals Grade 11").status_code == 204
    assert client.delete(
        f"/workspace/folders/Midterm Grade 10/quizzes/{quiz_id}/papers/{paper_id}"
    ).status_code == 204
    assert client.delete("/workspace/folders/Midterm Grade 10").status_code == 204
    assert client.get("/workspace/folders").json() == []


def test_workspace_grade_key_version_and_partial_credit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    ws_dir = tmp_path / "workspace"
    monkeypatch.setenv("AUTOGRADE_WORKSPACE_DIR", str(ws_dir))
    client = TestClient(app)

    client.post("/workspace/folders", json={"name": "MultiKey"})
    rules_b = [
        {"alternateAnswers": [{"choice": "E", "points": 0.5}], "incorrectPoints": -0.25}
        if q == 1
        else {}
        for q in range(1, 21)
    ]
    quiz_resp = client.post(
        "/workspace/folders/MultiKey/quizzes",
        json={
            "name": "Versioned Quiz",
            "templateId": "20q_a4",
            "answerKey": ["A"] * 20,
            "points": [1.0] * 20,
            "keyVersions": {
                "B": {
                    "answerKey": ["C"] * 20,
                    "points": [1.0] * 20,
                    "questionRules": rules_b,
                }
            },
        },
    )
    assert quiz_resp.status_code == 201
    quiz_id = quiz_resp.json()["id"]

    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    r_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    draw_perfect_mark(
        canvas,
        key_version_bubble_position_px(1, PAGE),
        key_version_bubble_radius_px(PAGE),
    )
    draw_perfect_mark(canvas, bubble_position_px(TWENTY_QUESTIONS, 1, 4, PAGE), r_px)
    for q in range(2, 21):
        draw_perfect_mark(canvas, bubble_position_px(TWENTY_QUESTIONS, q, 2, PAGE), r_px)

    resp = client.post(
        f"/workspace/folders/MultiKey/quizzes/{quiz_id}/grade",
        files={"file": ("kv_b.png", _encode_png(canvas), "image/png")},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["keyVersion"] == "B"
    assert body["detectedKeyVersion"] == "B"
    assert not body.get("keyVersionFlagged")
    assert body["score"] == pytest.approx(97.5)

    canvas_c = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    draw_perfect_mark(
        canvas_c,
        key_version_bubble_position_px(2, PAGE),
        key_version_bubble_radius_px(PAGE),
    )
    for q in range(1, 21):
        draw_perfect_mark(canvas_c, bubble_position_px(TWENTY_QUESTIONS, q, 0, PAGE), r_px)
    resp_c = client.post(
        f"/workspace/folders/MultiKey/quizzes/{quiz_id}/grade",
        files={"file": ("kv_c.png", _encode_png(canvas_c), "image/png")},
    )
    assert resp_c.status_code == 201
    body_c = resp_c.json()
    assert body_c["detectedKeyVersion"] == "C"
    assert body_c["keyVersion"] == "A"
    assert body_c["keyVersionFlagged"] is True
    assert body_c["needsReview"] is True

    canvas_blank_kv = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    for q in range(1, 21):
        draw_perfect_mark(canvas_blank_kv, bubble_position_px(TWENTY_QUESTIONS, q, 0, PAGE), r_px)
    resp_blank_kv = client.post(
        f"/workspace/folders/MultiKey/quizzes/{quiz_id}/grade",
        files={"file": ("kv_blank.png", _encode_png(canvas_blank_kv), "image/png")},
    )
    assert resp_blank_kv.status_code == 201
    body_blank_kv = resp_blank_kv.json()
    assert not body_blank_kv.get("detectedKeyVersion")
    assert body_blank_kv["keyVersion"] == "A"
    assert body_blank_kv["keyVersionFlagged"] is True
    assert body_blank_kv["needsReview"] is True
