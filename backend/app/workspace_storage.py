"""Local disk workspace storage in `<repo>/workspace/`."""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

TEMPLATE_PDF_SOURCE_NAMES = {
    "20q_a4": "autograde20Questions.pdf",
    "50q_a4": "autograde50Questions.pdf",
    "100q_a4": "autograde100Questions.pdf",
}

_NON_ALNUM_RUN = re.compile(r"[^A-Za-z0-9]+")
_SCAN_FILENAME_RE = re.compile(
    r"^[^_]+_[^_]+_([^_]+)_(?:raw|aligned|graded)\.(?:png|jpg)$"
)


def slugify_segment(
    value: str,
    fallback: str,
    max_len: int = 48,
    *,
    lowercase: bool = False,
) -> str:
    """Convert arbitrary user/OCR text into a safe single path segment."""
    cleaned = _NON_ALNUM_RUN.sub("-", (value or "").strip()).strip("-")
    if max_len > 0:
        cleaned = cleaned[:max_len].strip("-")
    if not cleaned:
        cleaned = fallback
    if cleaned.upper() in WINDOWS_RESERVED_NAMES:
        cleaned = f"s-{cleaned}"
    return cleaned.lower() if lowercase else cleaned


def _ensure_under_root(root: Path, target: Path) -> Path:
    resolved_root = root.resolve()
    resolved_target = target.resolve()
    if not resolved_target.is_relative_to(resolved_root):
        raise ValueError(f"Path {resolved_target} escapes workspace root {resolved_root}.")
    return resolved_target


def ensure_workspace_layout(workspace_dir: Path, templates_source_dir: Path) -> Path:
    """Create `<workspace>/scans` and `<workspace>/templates`, seeding missing PDFs."""
    workspace_dir.mkdir(parents=True, exist_ok=True)
    scans_dir = _ensure_under_root(workspace_dir, workspace_dir / "scans")
    templates_dir = _ensure_under_root(workspace_dir, workspace_dir / "templates")
    scans_dir.mkdir(parents=True, exist_ok=True)
    templates_dir.mkdir(parents=True, exist_ok=True)

    for template_id, source_name in TEMPLATE_PDF_SOURCE_NAMES.items():
        source_pdf = templates_source_dir / template_id / source_name
        dest_pdf = _ensure_under_root(workspace_dir, templates_dir / f"{template_id}.pdf")
        if source_pdf.is_file() and (
            not dest_pdf.exists()
            or source_pdf.stat().st_size != dest_pdf.stat().st_size
            or source_pdf.stat().st_mtime > dest_pdf.stat().st_mtime
        ):
            shutil.copy2(source_pdf, dest_pdf)

    return workspace_dir


def _atomic_write_bytes(root: Path, target: Path, data: bytes) -> Path:
    safe_target = _ensure_under_root(root, target)
    safe_target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path_str = tempfile.mkstemp(
        prefix=".tmp-",
        dir=str(safe_target.parent),
    )
    tmp_path = Path(tmp_path_str)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp_path, safe_target)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    return safe_target


def save_scan_artifacts(
    workspace_dir: Path,
    *,
    quiz_id: str,
    quiz_name: str,
    paper_id: str,
    student_id_text: str,
    name_text: str,
    raw_bytes: bytes,
    raw_ext: str,
    aligned_jpeg_bytes: bytes,
    graded_jpeg_bytes: bytes,
) -> dict[str, str]:
    """Save raw upload, aligned A4 JPEG, and graded overlay JPEG to workspace/scans/."""
    if not (quiz_id or "").strip() and not (quiz_name or "").strip():
        quiz_folder = "sandbox"
    else:
        quiz_slug = slugify_segment(quiz_name, "quiz", 36, lowercase=True)
        id_slug = slugify_segment(quiz_id.replace("-", "")[:6], "local", 12, lowercase=True)
        quiz_folder = f"{quiz_slug}-{id_slug}"

    quiz_root = _ensure_under_root(workspace_dir, workspace_dir / "scans" / quiz_folder)
    uploads_dir = quiz_root / "uploads"
    aligned_dir = quiz_root / "aligned"
    graded_dir = quiz_root / "graded"
    for directory in (uploads_dir, aligned_dir, graded_dir):
        directory.mkdir(parents=True, exist_ok=True)

    id_part = slugify_segment(student_id_text, "no-id", 24)
    name_part = slugify_segment(name_text, "unnamed", 36)
    paper_part = slugify_segment(paper_id.replace("-", "")[:6], "scan", 12)
    stem = f"{id_part}_{name_part}_{paper_part}"

    # Remove prior scan files for the same paper_part (e.g. regrade with changed OCR text).
    if paper_id.strip():
        for directory, pattern in (
            (uploads_dir, f"*_{paper_part}_raw.*"),
            (aligned_dir, f"*_{paper_part}_aligned.jpg"),
            (graded_dir, f"*_{paper_part}_graded.jpg"),
        ):
            for existing in directory.glob(pattern):
                if existing.is_file():
                    _ensure_under_root(workspace_dir, existing).unlink(missing_ok=True)

    safe_ext = ".png" if raw_ext.lower() == ".png" else ".jpg"
    raw_path = _atomic_write_bytes(workspace_dir, uploads_dir / f"{stem}_raw{safe_ext}", raw_bytes)
    aligned_path = _atomic_write_bytes(
        workspace_dir, aligned_dir / f"{stem}_aligned.jpg", aligned_jpeg_bytes
    )
    graded_path = _atomic_write_bytes(
        workspace_dir, graded_dir / f"{stem}_graded.jpg", graded_jpeg_bytes
    )

    resolved_root = workspace_dir.resolve()
    return {
        "raw": raw_path.relative_to(resolved_root).as_posix(),
        "aligned": aligned_path.relative_to(resolved_root).as_posix(),
        "graded": graded_path.relative_to(resolved_root).as_posix(),
    }


def prune_orphaned_scan_artifacts(workspace_dir: Path, payload: dict[str, Any]) -> int:
    """Remove non-sandbox scan files whose paper stem no longer exists in workspace.json."""
    scans_dir = workspace_dir / "scans"
    if not scans_dir.is_dir():
        return 0

    active_stems: set[str] = set()
    for paper in payload.get("papers", []):
        if not isinstance(paper, dict):
            continue
        raw_id = paper.get("id")
        if isinstance(raw_id, str) and raw_id.strip():
            active_stems.add(slugify_segment(raw_id.replace("-", "")[:6], "scan", 12))

    removed = 0
    for quiz_dir in list(scans_dir.iterdir()):
        if not quiz_dir.is_dir() or quiz_dir.name == "sandbox":
            continue
        for sub_name in ("uploads", "aligned", "graded"):
            sub_dir = quiz_dir / sub_name
            if not sub_dir.is_dir():
                continue
            for entry in list(sub_dir.iterdir()):
                if not entry.is_file():
                    continue
                match = _SCAN_FILENAME_RE.match(entry.name)
                if match and match.group(1) not in active_stems:
                    _ensure_under_root(workspace_dir, entry).unlink(missing_ok=True)
                    removed += 1
            if not any(sub_dir.iterdir()):
                sub_dir.rmdir()
        if not any(quiz_dir.iterdir()):
            quiz_dir.rmdir()
    return removed


def read_workspace_json(workspace_dir: Path) -> dict[str, Any] | None:
    json_path = workspace_dir / "workspace.json"
    if not json_path.is_file():
        return None
    safe_path = _ensure_under_root(workspace_dir, json_path)
    return json.loads(safe_path.read_text(encoding="utf-8"))


def write_workspace_json(workspace_dir: Path, payload: dict[str, Any]) -> Path:
    workspace_dir.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    return _atomic_write_bytes(workspace_dir, workspace_dir / "workspace.json", serialized)


def get_workspace_status(workspace_dir: Path) -> dict[str, Any]:
    json_path = workspace_dir / "workspace.json"
    scans_dir = workspace_dir / "scans"
    templates_dir = workspace_dir / "templates"

    has_workspace_json = json_path.is_file()
    latest_mtime = json_path.stat().st_mtime if has_workspace_json else None

    scan_count = 0
    if scans_dir.is_dir():
        for upload_file in scans_dir.glob("*/uploads/*"):
            if upload_file.is_file():
                scan_count += 1
                mtime = upload_file.stat().st_mtime
                if latest_mtime is None or mtime > latest_mtime:
                    latest_mtime = mtime

    template_files = (
        sorted(
            p.name
            for p in templates_dir.iterdir()
            if p.is_file() and p.suffix.lower() == ".pdf"
        )
        if templates_dir.is_dir()
        else []
    )

    last_modified = (
        datetime.fromtimestamp(latest_mtime, tz=timezone.utc).isoformat()
        if latest_mtime is not None
        else None
    )

    return {
        "workspace_dir": str(workspace_dir),
        "has_workspace_json": has_workspace_json,
        "scan_count": scan_count,
        "template_files": template_files,
        "last_modified": last_modified,
    }
