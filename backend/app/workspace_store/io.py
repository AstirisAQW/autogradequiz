from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 2
MAX_FOLDER_NAME_LEN = 60
IMAGE_KINDS = ("raw", "aligned")

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

_FORBIDDEN_NAME_CHARS = set('<>:"/\\|?*')
_NON_ALNUM_RUN = re.compile(r"[^A-Za-z0-9]+")
_IMAGE_DIR_FOR_KIND = {"raw": "uploads", "aligned": "aligned"}

_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()
_workspace_lock = threading.RLock()
_ts_guard = threading.Lock()
_last_ts_ms = 0
_folder_summary_cache: dict[str, tuple[str, str, dict[str, Any]]] = {}
_quiz_counts_cache: dict[str, tuple[int, int]] = {}


class FolderNameError(ValueError):
    pass


class FolderExistsError(Exception):
    pass


class FolderNotFoundError(Exception):
    pass


class ResourceNotFoundError(Exception):
    pass


class ResourceConflictError(Exception):
    pass


class ResourceValidationError(ValueError):
    pass


def slugify_segment(
    value: str,
    fallback: str,
    max_len: int = 48,
    *,
    lowercase: bool = False,
) -> str:
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
        raise ValueError(f"Path {resolved_target} escapes {resolved_root}.")
    return resolved_target


def _stage_temp_bytes(root: Path, target: Path, data: bytes) -> tuple[Path, Path]:
    safe_target = _ensure_under_root(root, target)
    safe_target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path_str = tempfile.mkstemp(prefix=".tmp-", dir=str(safe_target.parent))
    tmp_path = Path(tmp_path_str)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    return tmp_path, safe_target


def _atomic_write_batch(root: Path, items: list[tuple[Path, bytes]]) -> None:
    staged: list[tuple[Path, Path]] = []
    try:
        for target, data in items:
            staged.append(_stage_temp_bytes(root, target, data))
        for tmp_path, safe_target in staged:
            os.replace(tmp_path, safe_target)
    except Exception:
        for tmp_path, _ in staged:
            tmp_path.unlink(missing_ok=True)
        raise


def _atomic_write_bytes(root: Path, target: Path, data: bytes) -> Path:
    safe_target = _ensure_under_root(root, target)
    _atomic_write_batch(root, [(safe_target, data)])
    return safe_target


def _encode_json(value: Any) -> bytes:
    return json.dumps(value, indent=2, ensure_ascii=False).encode("utf-8")


def _write_json(root: Path, target: Path, value: Any) -> Path:
    return _atomic_write_bytes(root, target, _encode_json(value))


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _lock_key(folder: Path) -> str:
    return os.path.normcase(str(folder.resolve()))


def _lock_for(folder: Path) -> threading.RLock:
    key = _lock_key(folder)
    with _locks_guard:
        return _locks.setdefault(key, threading.RLock())


def _release_lock_for(key: str) -> None:
    with _locks_guard:
        _locks.pop(key, None)
        _folder_summary_cache.pop(key, None)
        prefix = key + os.sep
        for qkey in [k for k in _quiz_counts_cache if k == key or k.startswith(prefix)]:
            _quiz_counts_cache.pop(qkey, None)


def _invalidate_folder_summary(folder: Path) -> None:
    _folder_summary_cache.pop(_lock_key(folder), None)


def _invalidate_quiz_counts(quiz_dir: Path) -> None:
    _quiz_counts_cache.pop(_lock_key(quiz_dir), None)


def next_created_at() -> str:
    global _last_ts_ms
    with _ts_guard:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        _last_ts_ms = now_ms if now_ms > _last_ts_ms else _last_ts_ms + 1
        dt = datetime.fromtimestamp(_last_ts_ms / 1000.0, tz=timezone.utc)
        return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _short_id(raw_id: str, fallback: str) -> str:
    return slugify_segment(raw_id.replace("-", "")[:6], fallback, 12, lowercase=True)


def _quiz_dir_name(quiz_id: str, quiz_name: str) -> str:
    slug = slugify_segment(quiz_name, "quiz", 36, lowercase=True)
    return f"{slug}-{_short_id(quiz_id, 'local')}"


def _touch_folder_modified(folder: Path) -> None:
    meta_path = folder / "folder.json"
    meta = _read_json(meta_path) if meta_path.is_file() else {"name": folder.name}
    meta["lastModified"] = next_created_at()
    _write_json(folder, meta_path, meta)
    _invalidate_folder_summary(folder)


def normalize_code_for_match(value: str | None) -> str:
    return re.sub(r"[^a-zA-Z0-9]", "", value or "").lower()


def codes_match(scanned_text: str | None, student_code: str) -> bool:
    a = normalize_code_for_match(scanned_text)
    b = normalize_code_for_match(student_code)
    return bool(a and b and a == b)


def has_min_alnum(value: str | None, minimum: int = 2) -> bool:
    return len(re.findall(r"[a-zA-Z0-9]", value or "")) >= minimum


def parse_full_name(raw_name: str) -> tuple[str, str] | None:
    normalized = " ".join((raw_name or "").strip().split())
    if not normalized:
        return None
    if "," in normalized:
        last_name, first_name = normalized.split(",", 1)
        first_name, last_name = first_name.strip(), last_name.strip()
        return (first_name, last_name) if first_name and last_name else None
    parts = normalized.split(" ")
    if len(parts) < 2:
        return None
    first_name = " ".join(parts[:-1])
    last_name = parts[-1]
    return (first_name, last_name) if first_name and last_name else None


def _read_classes(folder: Path) -> list[dict[str, Any]]:
    path = folder / "classes.json"
    return list(_read_json(path)) if path.is_file() else []


def _read_students(folder: Path) -> list[dict[str, Any]]:
    path = folder / "students.json"
    return list(_read_json(path)) if path.is_file() else []


def _list_quiz_dirs(folder: Path) -> list[Path]:
    q_root = folder / "quizzes"
    if not q_root.is_dir():
        return []
    return [d for d in q_root.iterdir() if d.is_dir() and (d / "quiz.json").is_file()]


def _find_quiz_dir(folder: Path, quiz_id: str) -> tuple[Path, dict[str, Any]]:
    for qdir in _list_quiz_dirs(folder):
        quiz = _read_json(qdir / "quiz.json")
        if quiz.get("id") == quiz_id:
            return qdir, quiz
    raise ResourceNotFoundError(f"Quiz {quiz_id} not found.")


def _find_paper_file(quiz_dir: Path, paper_id: str) -> tuple[Path, dict[str, Any]]:
    papers_dir = quiz_dir / "papers"
    if papers_dir.is_dir():
        for pfile in papers_dir.iterdir():
            if pfile.is_file() and pfile.suffix == ".json":
                paper = _read_json(pfile)
                if paper.get("id") == paper_id:
                    return pfile, paper
    raise ResourceNotFoundError(f"Paper {paper_id} not found.")


def _read_quiz_papers(quiz_dir: Path) -> list[dict[str, Any]]:
    papers_dir = quiz_dir / "papers"
    if not papers_dir.is_dir():
        return []
    papers = [
        _read_json(pfile)
        for pfile in papers_dir.iterdir()
        if pfile.is_file() and pfile.suffix == ".json"
    ]
    return sorted(papers, key=lambda p: (str(p.get("createdAt", "")), str(p.get("id", ""))))


def _count_quiz_papers(quiz_dir: Path) -> tuple[int, int]:
    key = _lock_key(quiz_dir)
    papers_dir = quiz_dir / "papers"
    if not papers_dir.is_dir():
        _quiz_counts_cache.pop(key, None)
        return 0, 0
    cached = _quiz_counts_cache.get(key)
    if cached is not None:
        return cached
    paper_count = 0
    needs_review_count = 0
    for pfile in papers_dir.iterdir():
        if not pfile.is_file() or pfile.suffix != ".json":
            continue
        paper_count += 1
        if _read_json(pfile).get("needsReview"):
            needs_review_count += 1
    result = (paper_count, needs_review_count)
    _quiz_counts_cache[key] = result
    return result


def _choose_paper_json_path(quiz_dir: Path, paper_id: str) -> Path:
    papers_dir = quiz_dir / "papers"
    papers_dir.mkdir(parents=True, exist_ok=True)
    short = _short_id(paper_id, "paper")
    short_path = papers_dir / f"{short}.json"
    if short_path.is_file():
        existing = _read_json(short_path)
        if existing.get("id") != paper_id:
            full = slugify_segment(paper_id, "paper", 64, lowercase=True)
            return papers_dir / f"{full}.json"
    return short_path


def _build_scan_rel_paths(
    paper: dict[str, Any],
    raw_ext: str = ".jpg",
) -> dict[str, str]:
    id_part = slugify_segment(str(paper.get("studentIdText") or ""), "no-id", 24)
    name_part = slugify_segment(str(paper.get("nameText") or ""), "unnamed", 36)
    short_paper_id = _short_id(str(paper["id"]), "scan")
    stem = f"{id_part}_{name_part}_{short_paper_id}"
    safe_raw_ext = ".png" if raw_ext.lower() == ".png" else ".jpg"
    return {
        "raw": f"uploads/{stem}_raw{safe_raw_ext}",
        "aligned": f"aligned/{stem}_aligned.jpg",
    }


def _prune_empty_image_dirs(quiz_dir: Path) -> None:
    for sub in ("uploads", "aligned"):
        sub_dir = quiz_dir / sub
        if sub_dir.is_dir() and not any(sub_dir.iterdir()):
            sub_dir.rmdir()


def _unlink_paper_images(
    folder: Path,
    quiz_dir: Path,
    image_paths: dict[str, Any] | None,
    *,
    exclude_rels: set[str] | None = None,
) -> None:
    paths = image_paths or {}
    for rel in paths.values():
        if isinstance(rel, str) and rel and (not exclude_rels or rel not in exclude_rels):
            target = _ensure_under_root(folder, quiz_dir / rel)
            target.unlink(missing_ok=True)
    _prune_empty_image_dirs(quiz_dir)


def _rename_paper_scan_files(folder: Path, quiz_dir: Path, paper: dict[str, Any]) -> None:
    old_paths = paper.get("imagePaths")
    if not isinstance(old_paths, dict) or not old_paths.get("raw"):
        return
    raw_ext = Path(str(old_paths["raw"])).suffix or ".jpg"
    new_paths = _build_scan_rel_paths(paper, raw_ext)
    if new_paths == old_paths:
        return
    updated_paths: dict[str, str] = {}
    for kind in IMAGE_KINDS:
        old_rel = old_paths.get(kind)
        new_rel = new_paths.get(kind)
        if not old_rel or not new_rel:
            continue
        src = _ensure_under_root(folder, quiz_dir / old_rel)
        dst = _ensure_under_root(folder, quiz_dir / new_rel)
        if src.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.replace(src, dst)
        updated_paths[kind] = new_rel
    paper["imagePaths"] = updated_paths
