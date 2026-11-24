from __future__ import annotations

import random
import uuid
from pathlib import Path
from typing import Any

from app.workspace_store.io import (
    ResourceConflictError,
    ResourceNotFoundError,
    ResourceValidationError,
    _list_quiz_dirs,
    _lock_for,
    _read_classes,
    _read_json,
    _read_quiz_papers,
    _read_students,
    _rename_paper_scan_files,
    _touch_folder_modified,
    _write_json,
    codes_match,
    has_min_alnum,
    next_created_at,
    normalize_code_for_match,
    parse_full_name,
)
from app.workspace_store.quizzes import _summarize_quiz_dir, rescore_paper


def _ensure_class_in_list(
    class_name: str, classes: list[dict[str, Any]]
) -> tuple[dict[str, Any] | None, bool]:
    trimmed = class_name.strip()
    if not has_min_alnum(trimmed, 2):
        return None, False
    existing = next((c for c in classes if c["name"].strip().lower() == trimmed.lower()), None)
    if existing:
        return existing, False
    created = {
        "id": str(uuid.uuid4()),
        "name": trimmed,
        "term": "",
        "createdAt": next_created_at(),
    }
    classes.append(created)
    return created, True


def _create_student_from_ocr(
    name_text: str,
    class_text: str,
    student_code: str,
    classes: list[dict[str, Any]],
    students: list[dict[str, Any]],
) -> tuple[str | None, bool, bool]:
    parsed = parse_full_name(name_text)
    if not parsed:
        return None, False, False
    class_record, class_created = _ensure_class_in_list(class_text, classes)
    new_student = {
        "id": str(uuid.uuid4()),
        "studentCode": student_code,
        "firstName": parsed[0],
        "lastName": parsed[1],
        "externalRef": "",
        "classIds": [class_record["id"]] if class_record else [],
        "createdAt": next_created_at(),
    }
    students.append(new_student)
    return new_student["id"], class_created, True


def _enroll_student_in_class_text(
    student: dict[str, Any],
    class_text: str,
    classes: list[dict[str, Any]],
) -> tuple[str, bool, bool]:
    class_rec, class_created = _ensure_class_in_list(class_text, classes)
    student_updated = False
    if class_rec and class_rec["id"] not in (student.get("classIds") or []):
        student["classIds"] = [*(student.get("classIds") or []), class_rec["id"]]
        student_updated = True
    elif not class_text.strip() and (student.get("classIds") or []):
        first_class = next((c for c in classes if c["id"] == student["classIds"][0]), None)
        if first_class:
            class_text = first_class["name"]
    return class_text, class_created, student_updated


def _sync_new_paper_roster(
    folder: Path,
    *,
    student_code: str,
    name_text: str,
    class_text: str,
) -> tuple[str | None, str, str]:
    if not has_min_alnum(student_code, 2):
        return None, name_text, class_text

    classes = _read_classes(folder)
    students = _read_students(folder)
    classes_dirty = False
    students_dirty = False
    matched_student_id: str | None = None

    matched = next(
        (s for s in students if codes_match(student_code, s["studentCode"])),
        None,
    )
    if matched:
        matched_student_id = matched["id"]
        if not name_text.strip():
            name_text = f"{matched['lastName']}, {matched['firstName']}"
        class_text, class_created, stu_updated = _enroll_student_in_class_text(
            matched, class_text, classes
        )
        classes_dirty = classes_dirty or class_created
        students_dirty = students_dirty or stu_updated
    else:
        matched_student_id, class_created, stu_created = _create_student_from_ocr(
            name_text, class_text, student_code, classes, students
        )
        classes_dirty = classes_dirty or class_created
        students_dirty = students_dirty or stu_created

    if classes_dirty:
        _write_json(folder, folder / "classes.json", classes)
    if students_dirty:
        _write_json(folder, folder / "students.json", students)
    return matched_student_id, name_text, class_text


def _sync_reviewed_paper_roster(
    folder: Path,
    *,
    paper: dict[str, Any],
    ident: dict[str, Any],
) -> tuple[str | None, str, str, str]:
    classes = _read_classes(folder)
    students = _read_students(folder)
    classes_dirty = False
    students_dirty = False

    next_student_id = ident["studentId"] if "studentId" in ident else paper.get("studentId")
    next_code_text = (
        str(ident["studentIdText"]).strip()
        if "studentIdText" in ident and ident["studentIdText"] is not None
        else str(paper.get("studentIdText") or "")
    )
    next_name_text = (
        str(ident["nameText"])
        if "nameText" in ident and ident["nameText"] is not None
        else str(paper.get("nameText") or "")
    )
    next_class_text = (
        str(ident["classText"])
        if "classText" in ident and ident["classText"] is not None
        else str(paper.get("classText") or "")
    )
    has_text_edits = any(k in ident for k in ("nameText", "classText", "studentIdText"))
    student_link_changed = "studentId" in ident and next_student_id != paper.get("studentId")

    if (
        next_student_id is None
        and "studentId" not in ident
        and has_min_alnum(next_code_text, 2)
    ):
        matched = next(
            (s for s in students if codes_match(next_code_text, s["studentCode"])),
            None,
        )
        if matched:
            next_student_id = matched["id"]
        elif has_text_edits:
            created_id, class_created, stu_created = _create_student_from_ocr(
                next_name_text, next_class_text, next_code_text, classes, students
            )
            classes_dirty = classes_dirty or class_created
            students_dirty = students_dirty or stu_created
            if created_id is not None:
                next_student_id = created_id

    if next_student_id is not None:
        student = next((s for s in students if s["id"] == next_student_id), None)
        if student is None:
            raise ResourceNotFoundError(f"Student {next_student_id} not found.")
        canonical_name = f"{student['lastName']}, {student['firstName']}"
        if student_link_changed:
            if "nameText" not in ident:
                next_name_text = canonical_name
            if "studentIdText" not in ident:
                next_code_text = student["studentCode"]
            if "classText" in ident and has_min_alnum(next_class_text, 2):
                next_class_text, class_created, stu_updated = _enroll_student_in_class_text(
                    student, next_class_text, classes
                )
                classes_dirty = classes_dirty or class_created
                students_dirty = students_dirty or stu_updated
            elif not next_class_text.strip() and (student.get("classIds") or []):
                first_class = next(
                    (c for c in classes if c["id"] == student["classIds"][0]), None
                )
                if first_class:
                    next_class_text = first_class["name"]
        else:
            if "nameText" not in ident and not paper.get("nameText"):
                next_name_text = canonical_name
            if not next_code_text:
                next_code_text = student["studentCode"]
            if has_text_edits:
                if "nameText" in ident:
                    parsed = parse_full_name(next_name_text)
                    if parsed and (
                        parsed[0] != student["firstName"] or parsed[1] != student["lastName"]
                    ):
                        student["firstName"], student["lastName"] = parsed
                        students_dirty = True
                code_taken = any(
                    s["id"] != student["id"] and codes_match(next_code_text, s["studentCode"])
                    for s in students
                )
                if (
                    "studentIdText" in ident
                    and has_min_alnum(next_code_text, 2)
                    and not code_taken
                    and next_code_text != student["studentCode"]
                ):
                    student["studentCode"] = next_code_text
                    students_dirty = True
                if "classText" in ident and has_min_alnum(next_class_text, 2):
                    next_class_text, class_created, stu_updated = _enroll_student_in_class_text(
                        student, next_class_text, classes
                    )
                    classes_dirty = classes_dirty or class_created
                    students_dirty = students_dirty or stu_updated

    if classes_dirty:
        _write_json(folder, folder / "classes.json", classes)
    if students_dirty:
        _write_json(folder, folder / "students.json", students)
    return next_student_id, next_code_text, next_name_text, next_class_text


def _generate_unique_code(used_norm_codes: set[str]) -> str:
    for _ in range(100):
        candidate = str(random.randint(10000, 99999))
        if normalize_code_for_match(candidate) not in used_norm_codes:
            return candidate
    for code in range(10000, 100000):
        candidate = str(code)
        if normalize_code_for_match(candidate) not in used_norm_codes:
            return candidate
    return str(uuid.uuid4().int)[:8]


def _link_unlinked_papers_for_students(
    folder: Path, students_by_norm_code: dict[str, dict[str, Any]]
) -> None:
    if not students_by_norm_code:
        return
    for quiz_dir in _list_quiz_dirs(folder):
        papers_dir = quiz_dir / "papers"
        if not papers_dir.is_dir():
            continue
        for paper_file in list(papers_dir.iterdir()):
            if not paper_file.is_file() or paper_file.suffix != ".json":
                continue
            paper = _read_json(paper_file)
            if paper.get("studentId") is not None:
                continue
            norm_code = normalize_code_for_match(paper.get("studentIdText"))
            matched = students_by_norm_code.get(norm_code) if norm_code else None
            if matched is None:
                continue
            paper["studentId"] = matched["id"]
            if not str(paper.get("nameText") or "").strip():
                paper["nameText"] = f"{matched['lastName']}, {matched['firstName']}"
                _rename_paper_scan_files(folder, quiz_dir, paper)
            _write_json(folder, paper_file, paper)


def get_roster(folder: Path) -> dict[str, Any]:
    with _lock_for(folder):
        classes = _read_classes(folder)
        students = _read_students(folder)
        counts: dict[str, int] = {}
        for student in students:
            for class_id in student.get("classIds") or []:
                counts[class_id] = counts.get(class_id, 0) + 1
        classes_out = sorted(
            [{**cls, "studentCount": counts.get(cls["id"], 0)} for cls in classes],
            key=lambda c: (c["name"].casefold(), c["name"]),
        )
        students_out = sorted(
            students,
            key=lambda s: (
                s["lastName"].casefold(),
                s["firstName"].casefold(),
                s["studentCode"],
            ),
        )
        return {"classes": classes_out, "students": students_out}


def list_class_summaries(folder: Path) -> list[dict[str, Any]]:
    with _lock_for(folder):
        roster = get_roster(folder)
        quiz_counts: dict[str, int] = {}
        for quiz_dir in _list_quiz_dirs(folder):
            quiz = _read_json(quiz_dir / "quiz.json")
            for class_id in quiz.get("classIds") or []:
                quiz_counts[class_id] = quiz_counts.get(class_id, 0) + 1
        return [
            {**cls, "quizCount": quiz_counts.get(cls["id"], 0)}
            for cls in roster["classes"]
        ]


def get_class_detail(folder: Path, class_id: str) -> dict[str, Any]:
    with _lock_for(folder):
        roster = get_roster(folder)
        class_record = next((c for c in roster["classes"] if c["id"] == class_id), None)
        if class_record is None:
            raise ResourceNotFoundError(f"Class {class_id} not found.")
        enrolled = [
            s for s in roster["students"] if class_id in (s.get("classIds") or [])
        ]
        quizzes: list[dict[str, Any]] = []
        for quiz_dir in _list_quiz_dirs(folder):
            quiz = _read_json(quiz_dir / "quiz.json")
            if class_id in (quiz.get("classIds") or []):
                quizzes.append(_summarize_quiz_dir(quiz_dir, quiz))
        quizzes.sort(key=lambda q: str(q.get("createdAt", "")), reverse=True)
        return {"class": class_record, "students": enrolled, "quizzes": quizzes}


def save_class(
    folder: Path,
    *,
    class_id: str | None = None,
    name: str,
    term: str | None = None,
    require_existing: bool = False,
) -> dict[str, Any]:
    trimmed = name.strip()
    if not trimmed:
        raise ResourceValidationError("Class name cannot be empty.")
    with _lock_for(folder):
        classes = _read_classes(folder)
        students = _read_students(folder)
        existing = (
            next((c for c in classes if c["id"] == class_id), None) if class_id else None
        )
        if require_existing and existing is None:
            raise ResourceNotFoundError(f"Class {class_id} not found.")
        target_id = existing["id"] if existing else (class_id or str(uuid.uuid4()))

        if any(
            c["id"] != target_id and c["name"].strip().lower() == trimmed.lower()
            for c in classes
        ):
            raise ResourceConflictError(f"Class '{trimmed}' already exists.")

        fallback_term = existing.get("term", "") if existing else ""
        record = {
            "id": target_id,
            "name": trimmed,
            "term": term.strip() if term is not None else fallback_term,
            "createdAt": existing["createdAt"] if existing else next_created_at(),
        }
        updated = [c for c in classes if c["id"] != target_id] + [record]
        _write_json(folder, folder / "classes.json", updated)
        _touch_folder_modified(folder)
        count = sum(1 for s in students if target_id in (s.get("classIds") or []))
        return {**record, "studentCount": count}


def delete_class(folder: Path, class_id: str) -> None:
    with _lock_for(folder):
        classes = _read_classes(folder)
        if not any(c["id"] == class_id for c in classes):
            raise ResourceNotFoundError(f"Class {class_id} not found.")
        _write_json(
            folder, folder / "classes.json", [c for c in classes if c["id"] != class_id]
        )

        students = _read_students(folder)
        next_students = [
            {
                **s,
                "classIds": [cid for cid in (s.get("classIds") or []) if cid != class_id],
            }
            for s in students
        ]
        if next_students != students:
            _write_json(folder, folder / "students.json", next_students)

        for quiz_dir in _list_quiz_dirs(folder):
            quiz = _read_json(quiz_dir / "quiz.json")
            if class_id in (quiz.get("classIds") or []):
                remaining = [cid for cid in quiz["classIds"] if cid != class_id]
                if remaining:
                    quiz["classIds"] = remaining
                else:
                    quiz.pop("classIds", None)
                _write_json(folder, quiz_dir / "quiz.json", quiz)
        _touch_folder_modified(folder)


def get_student_detail(folder: Path, student_id: str) -> dict[str, Any]:
    with _lock_for(folder):
        classes = _read_classes(folder)
        students = _read_students(folder)
        student = next((s for s in students if s["id"] == student_id), None)
        if student is None:
            raise ResourceNotFoundError(f"Student {student_id} not found.")
        class_by_id = {c["id"]: c for c in classes}
        enrolled = sorted(
            [
                class_by_id[cid]
                for cid in (student.get("classIds") or [])
                if cid in class_by_id
            ],
            key=lambda c: c["name"].casefold(),
        )
        graded: list[dict[str, Any]] = []
        for quiz_dir in _list_quiz_dirs(folder):
            quiz = _read_json(quiz_dir / "quiz.json")
            for paper in _read_quiz_papers(quiz_dir):
                if paper.get("studentId") == student_id:
                    rescored = rescore_paper(quiz, paper)
                    graded.append(
                        {
                            "paper": paper,
                            "quiz": quiz,
                            "earnedPoints": rescored.earned_points,
                            "totalPoints": rescored.total_points,
                        }
                    )
        graded.sort(
            key=lambda item: str(
                item["quiz"].get("date") or item["paper"].get("createdAt") or ""
            ),
            reverse=True,
        )
        return {"student": student, "classes": enrolled, "gradedPapers": graded}


def save_student(
    folder: Path,
    *,
    student_id: str | None = None,
    student_code: str,
    first_name: str,
    last_name: str,
    external_ref: str | None = None,
    class_ids: list[str] | None = None,
    require_existing: bool = False,
) -> dict[str, Any]:
    code = student_code.strip()
    first = first_name.strip()
    last = last_name.strip()
    if not code or not first or not last:
        raise ResourceValidationError("studentCode, firstName, and lastName are required.")

    with _lock_for(folder):
        classes = _read_classes(folder)
        students = _read_students(folder)
        existing = (
            next((s for s in students if s["id"] == student_id), None)
            if student_id
            else None
        )
        if require_existing and existing is None:
            raise ResourceNotFoundError(f"Student {student_id} not found.")
        target_id = existing["id"] if existing else (student_id or str(uuid.uuid4()))

        if any(
            s["id"] != target_id and codes_match(code, s["studentCode"]) for s in students
        ):
            raise ResourceConflictError(f"Student code '{code}' already exists.")

        fallback_classes = existing.get("classIds") or [] if existing else []
        raw_classes = class_ids if class_ids is not None else fallback_classes
        unique_classes = list(dict.fromkeys(raw_classes))
        known_classes = {c["id"] for c in classes}
        for cid in unique_classes:
            if cid not in known_classes:
                raise ResourceValidationError(f"Class {cid} not found.")

        fallback_ext = existing.get("externalRef", "") if existing else ""
        record = {
            "id": target_id,
            "studentCode": code,
            "firstName": first,
            "lastName": last,
            "externalRef": external_ref.strip() if external_ref is not None else fallback_ext,
            "classIds": unique_classes,
            "createdAt": existing["createdAt"] if existing else next_created_at(),
        }
        updated = [s for s in students if s["id"] != target_id] + [record]
        _write_json(folder, folder / "students.json", updated)

        norm = normalize_code_for_match(code)
        if norm:
            _link_unlinked_papers_for_students(folder, {norm: record})
        _touch_folder_modified(folder)
        return record


def import_students(folder: Path, items: list[dict[str, Any]]) -> dict[str, Any]:
    with _lock_for(folder):
        classes = _read_classes(folder)
        students = _read_students(folder)
        classes_dirty = False

        used_norm_codes: set[str] = {
            norm
            for s in students
            if (norm := normalize_code_for_match(s.get("studentCode")))
        }
        class_by_lower: dict[str, dict[str, Any]] = {
            c["name"].strip().lower(): c for c in classes
        }

        created_students: list[dict[str, Any]] = []
        new_by_norm_code: dict[str, dict[str, Any]] = {}
        skipped = 0

        for item in items:
            first = str(item.get("firstName") or "").strip()
            last = str(item.get("lastName") or "").strip()
            if not first or not last:
                skipped += 1
                continue

            raw_code = str(item.get("studentCode") or "").strip()
            norm_raw = normalize_code_for_match(raw_code)
            if raw_code:
                if not norm_raw or norm_raw in used_norm_codes:
                    skipped += 1
                    continue
                code = raw_code
                norm_code = norm_raw
            else:
                code = _generate_unique_code(used_norm_codes)
                norm_code = normalize_code_for_match(code)

            used_norm_codes.add(norm_code)

            class_ids: list[str] = []
            class_name = str(item.get("className") or "").strip()
            if class_name:
                class_lower = class_name.lower()
                existing_class = class_by_lower.get(class_lower)
                if existing_class is None:
                    class_rec, class_created = _ensure_class_in_list(class_name, classes)
                    if class_rec is not None:
                        class_by_lower[class_lower] = class_rec
                        classes_dirty = classes_dirty or class_created
                        class_ids = [class_rec["id"]]
                else:
                    class_ids = [existing_class["id"]]

            record = {
                "id": str(uuid.uuid4()),
                "studentCode": code,
                "firstName": first,
                "lastName": last,
                "externalRef": str(item.get("externalRef") or "").strip(),
                "classIds": class_ids,
                "createdAt": next_created_at(),
            }
            students.append(record)
            created_students.append(record)
            new_by_norm_code[norm_code] = record

        if classes_dirty:
            _write_json(folder, folder / "classes.json", classes)
        if created_students:
            _write_json(folder, folder / "students.json", students)
            _link_unlinked_papers_for_students(folder, new_by_norm_code)
        if classes_dirty or created_students:
            _touch_folder_modified(folder)

        return {
            "imported": len(created_students),
            "skipped": skipped,
            "students": created_students,
        }


def delete_student(folder: Path, student_id: str) -> None:
    with _lock_for(folder):
        students = _read_students(folder)
        if not any(s["id"] == student_id for s in students):
            raise ResourceNotFoundError(f"Student {student_id} not found.")
        remaining_students = [s for s in students if s["id"] != student_id]
        _write_json(folder, folder / "students.json", remaining_students)
        for quiz_dir in _list_quiz_dirs(folder):
            papers_dir = quiz_dir / "papers"
            if not papers_dir.is_dir():
                continue
            for paper_file in list(papers_dir.iterdir()):
                if paper_file.is_file() and paper_file.suffix == ".json":
                    paper = _read_json(paper_file)
                    if paper.get("studentId") == student_id:
                        paper["studentId"] = None
                        _write_json(folder, paper_file, paper)
        _touch_folder_modified(folder)
