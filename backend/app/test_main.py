from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import anyio
import cv2
import pytest

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import TWENTY_QUESTIONS
from app.db.connection import init_db
from app.main import app
from app.sheet_rendering.renderer import blank_canvas, render_sheet
from app.synthetic_sheets.generator import generate_synthetic_sheet

try:
    from fastapi.testclient import TestClient
except RuntimeError:

    @dataclass
    class _Response:
        status_code: int
        content: bytes

        def json(self) -> Any:
            return json.loads(self.content.decode("utf-8"))

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

            scope = {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": method,
                "scheme": "http",
                "path": path,
                "raw_path": path.encode("utf-8"),
                "query_string": b"",
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

    results_resp = client.get(f"/batches/{batch_id}/results")
    assert results_resp.status_code == 200
    assert [r["id"] for r in results_resp.json()] == [graded["id"]]

    review_resp = client.get("/review-queue")
    assert review_resp.status_code == 200
    assert [r["id"] for r in review_resp.json()] == [graded["id"]]


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
