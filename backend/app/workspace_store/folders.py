from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.workspace_store.io import (
    _FORBIDDEN_NAME_CHARS,
    MAX_FOLDER_NAME_LEN,
    SCHEMA_VERSION,
    WINDOWS_RESERVED_NAMES,
    FolderExistsError,
    FolderNameError,
    FolderNotFoundError,
    _count_quiz_papers,
    _ensure_under_root,
    _folder_summary_cache,
    _list_quiz_dirs,
    _lock_for,
    _lock_key,
    _read_classes,
    _read_json,
    _read_students,
    _release_lock_for,
    _workspace_lock,
    _write_json,
    next_created_at,
)


def validate_folder_name(name: str) -> str:
    if not isinstance(name, str):
        raise FolderNameError("Folder name must be text.")
    cleaned = name.strip()
    if not 1 <= len(cleaned) <= MAX_FOLDER_NAME_LEN:
        raise FolderNameError(f"Folder name must be 1-{MAX_FOLDER_NAME_LEN} characters.")
    if cleaned in (".", "..") or cleaned.endswith((".", " ")):
        raise FolderNameError("Folder name cannot be '.'/'..' or end with a period or space.")
    if any(ch in _FORBIDDEN_NAME_CHARS or ord(ch) < 32 or ord(ch) == 127 for ch in cleaned):
        raise FolderNameError('Folder name cannot contain <>:"/\\|?* or control characters.')
    stem = cleaned.split(".", 1)[0].upper()
    if cleaned.upper() in WINDOWS_RESERVED_NAMES or stem in WINDOWS_RESERVED_NAMES:
        raise FolderNameError(f"Folder name '{cleaned}' uses a reserved system name.")
    return cleaned


def folder_dir(workspace_root: Path, name: str) -> Path:
    cleaned = validate_folder_name(name)
    candidate = _ensure_under_root(workspace_root, workspace_root / cleaned)
    if not candidate.is_dir() or not (candidate / "folder.json").is_file():
        raise FolderNotFoundError(f"Folder '{cleaned}' does not exist.")
    return candidate


def _summarize_folder_unlocked(folder: Path) -> dict[str, Any]:
    meta_path = folder / "folder.json"
    meta = _read_json(meta_path)
    folder_name = str(meta.get("name") or folder.name)
    last_modified = meta.get("lastModified")
    if not last_modified:
        last_modified = datetime.fromtimestamp(
            meta_path.stat().st_mtime, tz=timezone.utc
        ).isoformat()
    last_modified_str = str(last_modified)
    cache_key = _lock_key(folder)
    cached = _folder_summary_cache.get(cache_key)
    if cached is not None and cached[0] == last_modified_str and cached[1] == folder_name:
        return dict(cached[2])

    classes = _read_classes(folder)
    students = _read_students(folder)
    quizzes = _list_quiz_dirs(folder)
    paper_count = 0
    needs_review_count = 0
    for qdir in quizzes:
        q_papers, q_review = _count_quiz_papers(qdir)
        paper_count += q_papers
        needs_review_count += q_review
    summary = {
        "name": folder_name,
        "createdAt": str(meta.get("createdAt") or ""),
        "lastModified": last_modified_str,
        "classCount": len(classes),
        "studentCount": len(students),
        "quizCount": len(quizzes),
        "paperCount": paper_count,
        "needsReviewCount": needs_review_count,
    }
    _folder_summary_cache[cache_key] = (last_modified_str, folder_name, summary)
    return dict(summary)


def _summarize_folder(folder: Path) -> dict[str, Any]:
    with _lock_for(folder):
        return _summarize_folder_unlocked(folder)


def list_folders(workspace_root: Path) -> list[dict[str, Any]]:
    with _workspace_lock:
        if not workspace_root.is_dir():
            return []
        items = [
            _summarize_folder(entry)
            for entry in workspace_root.iterdir()
            if entry.is_dir() and (entry / "folder.json").is_file()
        ]
        return sorted(items, key=lambda item: item["name"].lower())


def create_folder(
    workspace_root: Path,
    name: str,
    *,
    copy_roster_from: str | None = None,
) -> dict[str, Any]:
    cleaned = validate_folder_name(name)
    with _workspace_lock:
        classes_seed: list[dict[str, Any]] = []
        students_seed: list[dict[str, Any]] = []
        if copy_roster_from is not None and copy_roster_from.strip():
            src = folder_dir(workspace_root, copy_roster_from)
            with _lock_for(src):
                classes_seed = _read_classes(src)
                students_seed = _read_students(src)

        workspace_root.mkdir(parents=True, exist_ok=True)
        target = _ensure_under_root(workspace_root, workspace_root / cleaned)
        for entry in workspace_root.iterdir():
            if entry.name.lower() == cleaned.lower():
                raise FolderExistsError(f"Folder '{cleaned}' already exists.")

        target.mkdir(parents=True, exist_ok=False)
        (target / "quizzes").mkdir(exist_ok=True)
        created_at = next_created_at()
        _write_json(
            target,
            target / "folder.json",
            {
                "name": cleaned,
                "createdAt": created_at,
                "lastModified": created_at,
                "schemaVersion": SCHEMA_VERSION,
            },
        )
        _write_json(target, target / "classes.json", classes_seed)
        _write_json(target, target / "students.json", students_seed)
        return _summarize_folder_unlocked(target)


def rename_folder(workspace_root: Path, old_name: str, new_name: str) -> dict[str, Any]:
    cleaned_new = validate_folder_name(new_name)
    with _workspace_lock:
        src = folder_dir(workspace_root, old_name)
        if src.name == cleaned_new:
            return _summarize_folder(src)

        for entry in workspace_root.iterdir():
            if entry.name.lower() == cleaned_new.lower() and entry.resolve() != src.resolve():
                raise FolderExistsError(f"Folder '{cleaned_new}' already exists.")

        dst = _ensure_under_root(workspace_root, workspace_root / cleaned_new)
        src_key = _lock_key(src)
        with _lock_for(src):
            if src.name.lower() == cleaned_new.lower():
                tmp = _ensure_under_root(
                    workspace_root, workspace_root / f".rename-{uuid.uuid4().hex}"
                )
                src.rename(tmp)
                tmp.rename(dst)
            else:
                src.rename(dst)
            meta = _read_json(dst / "folder.json")
            meta["name"] = cleaned_new
            meta["lastModified"] = next_created_at()
            _write_json(dst, dst / "folder.json", meta)
            summary = _summarize_folder_unlocked(dst)
            _release_lock_for(src_key)
        return summary


def delete_folder(workspace_root: Path, name: str) -> None:
    with _workspace_lock:
        target = folder_dir(workspace_root, name)
        target_key = _lock_key(target)
        with _lock_for(target):
            shutil.rmtree(target)
            _release_lock_for(target_key)
