from __future__ import annotations

from pathlib import Path

from app.config import BACKEND_ROOT
from app.workspace_storage import (
    ensure_workspace_layout,
    get_workspace_status,
    prune_orphaned_scan_artifacts,
    read_workspace_json,
    save_scan_artifacts,
    slugify_segment,
    write_workspace_json,
)


def test_slugify_segment_sanitizes_traversal_and_windows_reserved_names():
    assert slugify_segment("../../../etc/passwd", "fallback") == "etc-passwd"
    assert slugify_segment("CON", "fallback") == "s-CON"
    assert slugify_segment("lpt1", "fallback", lowercase=True) == "s-lpt1"
    assert slugify_segment("   ", "unnamed") == "unnamed"
    assert slugify_segment("Dela Cruz, Juan", "unnamed") == "Dela-Cruz-Juan"


def test_workspace_layout_seeds_template_pdfs_and_saves_scans(tmp_path: Path):
    ws_dir = tmp_path / "workspace"
    templates_src = BACKEND_ROOT / "data" / "templates"
    ensure_workspace_layout(ws_dir, templates_src)

    status = get_workspace_status(ws_dir)
    assert status["template_files"] == ["100q_a4.pdf", "20q_a4.pdf", "50q_a4.pdf"]
    assert status["has_workspace_json"] is False
    assert status["scan_count"] == 0

    paths = save_scan_artifacts(
        ws_dir,
        quiz_id="quiz-abcdef12",
        quiz_name="Biology Quiz 1",
        paper_id="paper-123456",
        student_id_text="0123456789",
        name_text="Dela Cruz, Juan",
        raw_bytes=b"raw-png",
        raw_ext=".png",
        aligned_jpeg_bytes=b"aligned-jpg",
        graded_jpeg_bytes=b"graded-jpg",
    )

    assert paths == {
        "raw": "scans/biology-quiz-1-quizab/uploads/0123456789_Dela-Cruz-Juan_paper1_raw.png",
        "aligned": (
            "scans/biology-quiz-1-quizab/aligned/0123456789_Dela-Cruz-Juan_paper1_aligned.jpg"
        ),
        "graded": "scans/biology-quiz-1-quizab/graded/0123456789_Dela-Cruz-Juan_paper1_graded.jpg",
    }
    assert (ws_dir / paths["raw"]).read_bytes() == b"raw-png"
    assert (ws_dir / paths["aligned"]).read_bytes() == b"aligned-jpg"
    assert (ws_dir / paths["graded"]).read_bytes() == b"graded-jpg"

    status_after = get_workspace_status(ws_dir)
    assert status_after["scan_count"] == 1
    assert status_after["last_modified"] is not None


def test_workspace_json_atomic_write_and_read(tmp_path: Path):
    ws_dir = tmp_path / "workspace"
    assert read_workspace_json(ws_dir) is None

    payload = {
        "exportVersion": 1,
        "quizzes": [],
        "batches": [],
        "papers": [],
        "sections": [],
        "students": [],
    }
    written = write_workspace_json(ws_dir, payload)
    assert written == ws_dir / "workspace.json"
    assert read_workspace_json(ws_dir) == payload
    assert get_workspace_status(ws_dir)["has_workspace_json"] is True


def test_save_scan_artifacts_handles_traversal_inputs_safely(tmp_path: Path):
    ws_dir = tmp_path / "workspace"
    paths = save_scan_artifacts(
        ws_dir,
        quiz_id="../bad",
        quiz_name="../../CON",
        paper_id="..",
        student_id_text="../NUL",
        name_text="..",
        raw_bytes=b"jpg",
        raw_ext=".exe",
        aligned_jpeg_bytes=b"aligned",
        graded_jpeg_bytes=b"graded",
    )
    assert paths["raw"].endswith("_raw.jpg")
    for rel in paths.values():
        assert (ws_dir / rel).resolve().is_relative_to(ws_dir.resolve())


def test_regrade_replaces_old_stem_and_prune_removes_deleted_papers(tmp_path: Path):
    ws_dir = tmp_path / "workspace"
    save_scan_artifacts(
        ws_dir,
        quiz_id="quiz-111111",
        quiz_name="Quiz 1",
        paper_id="paper1-aaaa",
        student_id_text="10001",
        name_text="Old Name",
        raw_bytes=b"old",
        raw_ext=".png",
        aligned_jpeg_bytes=b"old",
        graded_jpeg_bytes=b"old",
    )
    regraded = save_scan_artifacts(
        ws_dir,
        quiz_id="quiz-111111",
        quiz_name="Quiz 1",
        paper_id="paper1-aaaa",
        student_id_text="10001",
        name_text="New Name",
        raw_bytes=b"new",
        raw_ext=".jpg",
        aligned_jpeg_bytes=b"new",
        graded_jpeg_bytes=b"new",
    )
    save_scan_artifacts(
        ws_dir,
        quiz_id="",
        quiz_name="",
        paper_id="sandbox-1",
        student_id_text="",
        name_text="",
        raw_bytes=b"sbx",
        raw_ext=".png",
        aligned_jpeg_bytes=b"sbx",
        graded_jpeg_bytes=b"sbx",
    )
    assert len(list((ws_dir / "scans" / "quiz-1-quiz11" / "uploads").iterdir())) == 1
    assert (ws_dir / regraded["raw"]).is_file()

    # Pruning when papers list becomes empty removes quiz scans while keeping sandbox
    removed = prune_orphaned_scan_artifacts(ws_dir, {"papers": []})
    assert removed == 3
    assert not (ws_dir / "scans" / "quiz-1-quiz11").exists()
    assert (ws_dir / "scans" / "sandbox").is_dir()
