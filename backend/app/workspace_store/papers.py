from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from app.answer_sheet_templates.geometry import ANSWER_CHOICES
from app.workspace_store.io import (
    _IMAGE_DIR_FOR_KIND,
    IMAGE_KINDS,
    ResourceNotFoundError,
    ResourceValidationError,
    _atomic_write_batch,
    _build_scan_rel_paths,
    _choose_paper_json_path,
    _encode_json,
    _ensure_under_root,
    _find_paper_file,
    _find_quiz_dir,
    _invalidate_quiz_counts,
    _list_quiz_dirs,
    _lock_for,
    _read_json,
    _read_quiz_papers,
    _rename_paper_scan_files,
    _short_id,
    _touch_folder_modified,
    _unlink_paper_images,
    _write_json,
    next_created_at,
)
from app.workspace_store.quizzes import (
    _apply_quiz_rescore,
    available_key_versions,
    rescore_paper,
    resolve_quiz_key_for_version,
)
from app.workspace_store.roster import (
    _sync_new_paper_roster,
    _sync_reviewed_paper_roster,
)


def save_graded_paper(
    folder: Path,
    quiz_id: str,
    *,
    grade_result: dict[str, Any],
    raw_bytes: bytes,
    raw_ext: str,
    aligned_jpeg_bytes: bytes,
    paper_id: str | None = None,
) -> dict[str, Any]:
    with _lock_for(folder):
        quiz_dir, quiz = _find_quiz_dir(folder, quiz_id)
        existing_file: Path | None = None
        existing_paper: dict[str, Any] | None = None
        if paper_id and paper_id.strip():
            try:
                existing_file, existing_paper = _find_paper_file(quiz_dir, paper_id.strip())
            except ResourceNotFoundError:
                pass

        detected_kv = str(grade_result.get("key_version_detected") or "").strip().upper()
        available_kvs = available_key_versions(quiz)
        multi_key = len(available_kvs) > 1
        requested_kv = (
            grade_result.get("key_version")
            or detected_kv
            or (existing_paper or {}).get("keyVersion")
            or "A"
        )
        active_ver = resolve_quiz_key_for_version(quiz, requested_kv).version
        kv_flagged = multi_key and (
            bool(grade_result.get("key_version_flagged"))
            or not detected_kv
            or detected_kv not in available_kvs
        )

        old_image_paths: dict[str, str] = {}
        if existing_paper is not None and existing_file is not None:
            old_image_paths = dict(existing_paper.get("imagePaths") or {})
            paper: dict[str, Any] = {
                **existing_paper,
                "status": "done",
                "answers": list(grade_result["answers"]),
                "flags": {str(k): str(v) for k, v in (grade_result.get("flags") or {}).items()},
                "confidence": list(grade_result["confidence"]),
                "corrections": {},
                "keyVersion": active_ver,
                "nameText": (
                    existing_paper.get("nameText") or str(grade_result.get("name_text") or "")
                ),
                "dateText": (
                    existing_paper.get("dateText") or str(grade_result.get("date_text") or "")
                ),
                "classText": (
                    existing_paper.get("classText")
                    or str(grade_result.get("class_text") or "")
                ),
                "studentIdText": (
                    existing_paper.get("studentIdText")
                    or str(grade_result.get("student_id_text") or "").strip()
                ),
            }
            if detected_kv:
                paper["detectedKeyVersion"] = detected_kv
            paper_path = existing_file
        else:
            scanned_code = str(grade_result.get("student_id_text") or "").strip()
            matched_student_id, resolved_name, resolved_class = _sync_new_paper_roster(
                folder,
                student_code=scanned_code,
                name_text=str(grade_result.get("name_text") or ""),
                class_text=str(grade_result.get("class_text") or ""),
            )

            new_id = paper_id.strip() if paper_id and paper_id.strip() else str(uuid.uuid4())
            paper = {
                "id": new_id,
                "quizId": quiz["id"],
                "status": "done",
                "answers": list(grade_result["answers"]),
                "flags": {str(k): str(v) for k, v in (grade_result.get("flags") or {}).items()},
                "confidence": list(grade_result["confidence"]),
                "nameText": resolved_name,
                "dateText": str(grade_result.get("date_text") or ""),
                "classText": resolved_class,
                "studentIdText": scanned_code,
                "studentId": matched_student_id,
                "corrections": {},
                "createdAt": next_created_at(),
            }
            if detected_kv:
                paper["detectedKeyVersion"] = detected_kv
            paper_path = _choose_paper_json_path(quiz_dir, new_id)

        _apply_quiz_rescore(
            quiz,
            paper,
            requested_version=active_ver,
            set_key_version=bool(
                existing_paper is not None
                or grade_result.get("key_version") is not None
                or detected_kv
            ),
            kv_flagged=kv_flagged,
            extra_needs_review=bool(grade_result.get("needs_review")),
        )

        rel_paths = _build_scan_rel_paths(paper, raw_ext)
        paper["imagePaths"] = rel_paths
        batch_items: list[tuple[Path, bytes]] = [
            (quiz_dir / rel_paths["raw"], raw_bytes),
            (quiz_dir / rel_paths["aligned"], aligned_jpeg_bytes),
            (paper_path, _encode_json(paper)),
        ]
        _atomic_write_batch(folder, batch_items)
        _unlink_paper_images(
            folder, quiz_dir, old_image_paths, exclude_rels=set(rel_paths.values())
        )
        _invalidate_quiz_counts(quiz_dir)
        _touch_folder_modified(folder)
        return paper


def get_review_queue(folder: Path) -> list[dict[str, Any]]:
    with _lock_for(folder):
        queue: list[dict[str, Any]] = []
        for quiz_dir in _list_quiz_dirs(folder):
            quiz = _read_json(quiz_dir / "quiz.json")
            avail_kvs = available_key_versions(quiz)
            for paper in _read_quiz_papers(quiz_dir):
                if not paper.get("needsReview"):
                    continue
                resolved = resolve_quiz_key_for_version(quiz, paper.get("keyVersion"))
                rescored = rescore_paper(quiz, paper)
                item = {
                    **paper,
                    "quizName": quiz["name"],
                    "answerKey": resolved.answer_key,
                    "points": resolved.points,
                    "availableKeyVersions": avail_kvs,
                    "earnedPoints": rescored.earned_points,
                    "totalPoints": rescored.total_points,
                }
                if resolved.question_rules is not None:
                    item["questionRules"] = resolved.question_rules
                queue.append(item)
        return sorted(queue, key=lambda p: (str(p.get("createdAt", "")), str(p.get("id", ""))))


def submit_paper_review(
    folder: Path,
    quiz_id: str,
    paper_id: str,
    *,
    corrections: dict[str, str] | None = None,
    key_version: str | None = None,
    identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with _lock_for(folder):
        quiz_dir, quiz = _find_quiz_dir(folder, quiz_id)
        paper_file, paper = _find_paper_file(quiz_dir, paper_id)
        q_count = len(quiz["answerKey"])

        next_corrections = dict(paper.get("corrections") or {})
        if corrections is not None:
            for k, choice in corrections.items():
                if not str(k).isdigit() or not (1 <= int(k) <= q_count):
                    raise ResourceValidationError(f"Question number {k} out of range.")
                if not isinstance(choice, str) or (choice != "" and choice not in ANSWER_CHOICES):
                    raise ResourceValidationError(f"Invalid correction choice {choice!r}.")
                next_corrections[str(int(k))] = choice

        ident = identity or {}
        (
            next_student_id,
            next_code_text,
            next_name_text,
            next_class_text,
        ) = _sync_reviewed_paper_roster(folder, paper=paper, ident=ident)

        next_kv_flagged = (
            False
            if key_version is not None
            else bool(paper.get("keyVersionFlagged"))
        )

        updated_paper: dict[str, Any] = {
            **paper,
            "nameText": next_name_text,
            "dateText": (
                str(ident["dateText"])
                if "dateText" in ident and ident["dateText"] is not None
                else str(paper.get("dateText") or "")
            ),
            "classText": next_class_text,
            "studentIdText": next_code_text,
            "studentId": next_student_id,
            "corrections": next_corrections,
        }
        _apply_quiz_rescore(
            quiz,
            updated_paper,
            requested_version=key_version or paper.get("keyVersion") or "A",
            set_key_version=bool(key_version is not None or "keyVersion" in paper),
            kv_flagged=next_kv_flagged,
        )
        _rename_paper_scan_files(folder, quiz_dir, updated_paper)
        _write_json(folder, paper_file, updated_paper)
        _invalidate_quiz_counts(quiz_dir)
        _touch_folder_modified(folder)
        return updated_paper


def delete_paper(folder: Path, quiz_id: str, paper_id: str) -> None:
    with _lock_for(folder):
        quiz_dir, _ = _find_quiz_dir(folder, quiz_id)
        paper_file, paper = _find_paper_file(quiz_dir, paper_id)
        _unlink_paper_images(folder, quiz_dir, paper.get("imagePaths"))
        paper_file.unlink(missing_ok=True)
        _invalidate_quiz_counts(quiz_dir)
        _touch_folder_modified(folder)


def resolve_paper_image_path(folder: Path, quiz_id: str, paper_id: str, kind: str) -> Path:
    if kind not in IMAGE_KINDS:
        raise ResourceValidationError(f"Unknown image kind '{kind}'.")
    with _lock_for(folder):
        quiz_dir, _ = _find_quiz_dir(folder, quiz_id)
        _, paper = _find_paper_file(quiz_dir, paper_id)
        rel = (paper.get("imagePaths") or {}).get(kind)
        if isinstance(rel, str) and rel:
            candidate = _ensure_under_root(folder, quiz_dir / rel)
            if candidate.is_file():
                return candidate
        sub_dir = quiz_dir / _IMAGE_DIR_FOR_KIND[kind]
        if sub_dir.is_dir():
            short_paper_id = _short_id(paper_id, "scan")
            for match in sub_dir.glob(f"*_{short_paper_id}_{kind}.*"):
                if match.is_file():
                    return _ensure_under_root(folder, match)
        raise ResourceNotFoundError(f"Image '{kind}' for paper {paper_id} not found.")
