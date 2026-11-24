from __future__ import annotations

import csv
import io
import json
import shutil
import uuid
from pathlib import Path
from typing import Any, NamedTuple

from app.answer_sheet_templates.catalog import get_template_spec
from app.bubble_grading.scoring import QuestionRule, score_single_answer
from app.grading_pipeline.exceptions import InvalidAnswerKeyError
from app.grading_pipeline.pipeline import (
    parse_single_question_rule,
    validate_answer_key_and_points,
)
from app.workspace_store.io import (
    ResourceNotFoundError,
    ResourceValidationError,
    _count_quiz_papers,
    _ensure_under_root,
    _find_quiz_dir,
    _invalidate_quiz_counts,
    _list_quiz_dirs,
    _lock_for,
    _quiz_dir_name,
    _read_classes,
    _read_json,
    _read_quiz_papers,
    _touch_folder_modified,
    _write_json,
    next_created_at,
)


class ResolvedQuizKey(NamedTuple):

    version: str
    answer_key: list[str]
    points: list[float]
    question_rules: list[dict[str, Any]] | None


class PaperScoreSummary(NamedTuple):

    score: float
    needs_review: bool
    earned_points: float
    total_points: float


def _validate_key_and_points(
    count: int, raw_key: Any, raw_points: Any
) -> tuple[list[str], list[float] | None]:
    try:
        norm_key, norm_pts = validate_answer_key_and_points(count, raw_key, raw_points)
    except InvalidAnswerKeyError as exc:
        raise ResourceValidationError(str(exc)) from exc
    return norm_key, (norm_pts if raw_points is not None else None)


def _validate_question_rules(count: int, raw_rules: Any) -> list[dict[str, Any]] | None:
    if raw_rules is None:
        return None
    if not isinstance(raw_rules, list) or len(raw_rules) != count:
        raise ResourceValidationError(f"Expected {count} question rule entries.")
    cleaned: list[dict[str, Any]] = []
    for idx, entry in enumerate(raw_rules):
        try:
            parsed_rule = parse_single_question_rule(entry)
        except InvalidAnswerKeyError as exc:
            raise ResourceValidationError(
                f"Invalid question rule at question {idx + 1}: {exc}"
            ) from exc
        out_rule: dict[str, Any] = {}
        if parsed_rule.alternate_answers:
            out_rule["alternateAnswers"] = [
                {"choice": ch, "points": pts} for ch, pts in parsed_rule.alternate_answers
            ]
        if "incorrectPoints" in entry and entry["incorrectPoints"] is not None:
            out_rule["incorrectPoints"] = parsed_rule.incorrect_points
        if "tags" in entry and entry["tags"] is not None:
            tags = list(dict.fromkeys(str(t).strip() for t in entry["tags"] if str(t).strip()))
            if tags:
                out_rule["tags"] = tags
        cleaned.append(out_rule)
    return cleaned


def _validate_key_versions(count: int, raw_versions: Any) -> dict[str, Any] | None:
    if raw_versions is None:
        return None
    if not isinstance(raw_versions, dict):
        raise ResourceValidationError("keyVersions must be an object.")
    out: dict[str, Any] = {}
    for raw_ver, ver_data in raw_versions.items():
        ver = str(raw_ver).strip().upper()
        if ver not in ("B", "C", "D"):
            raise ResourceValidationError(f"Unknown key version '{raw_ver}'.")
        if not isinstance(ver_data, dict):
            raise ResourceValidationError(f"Key version '{ver}' must be an object.")
        raw_ak = ver_data.get("answerKey")
        if not isinstance(raw_ak, list) or len(raw_ak) != count:
            raise ResourceValidationError(f"Key version {ver} must have {count} answers.")
        norm_ak, norm_pts = _validate_key_and_points(
            count, [str(a) for a in raw_ak], ver_data.get("points")
        )
        entry: dict[str, Any] = {"answerKey": norm_ak}
        if norm_pts is not None:
            entry["points"] = norm_pts
        if "questionRules" in ver_data and ver_data["questionRules"] is not None:
            entry["questionRules"] = _validate_question_rules(count, ver_data["questionRules"])
        out[ver] = entry
    return out or None


def available_key_versions(quiz: dict[str, Any]) -> list[str]:
    kvs = quiz.get("keyVersions") or {}
    return ["A", *(ver for ver in ("B", "C", "D") if ver in kvs)]


def resolve_quiz_key_for_version(
    quiz: dict[str, Any], requested: str | None
) -> ResolvedQuizKey:
    norm = (requested or "A").strip().upper()
    count = len(quiz["answerKey"])
    default_pts = [float(p) for p in (quiz.get("points") or [1.0] * count)]
    ver_data = (quiz.get("keyVersions") or {}).get(norm)
    if norm in ("B", "C", "D") and ver_data:
        pts = [float(p) for p in ver_data["points"]] if ver_data.get("points") else default_pts
        return ResolvedQuizKey(
            version=norm,
            answer_key=list(ver_data["answerKey"]),
            points=pts,
            question_rules=ver_data.get("questionRules"),
        )
    return ResolvedQuizKey(
        version="A",
        answer_key=list(quiz["answerKey"]),
        points=default_pts,
        question_rules=quiz.get("questionRules"),
    )


def resolve_effective_choice(
    q_num: int,
    answers: list[str],
    flags: dict[str, str],
    corrections: dict[str, str],
) -> tuple[str, bool]:
    q_key = str(q_num)
    if q_key in corrections:
        return str(corrections[q_key]), False
    if q_key in flags:
        return "", True
    idx = q_num - 1
    return (str(answers[idx]) if idx < len(answers) else ""), False


def evaluate_question_score(
    q_num: int,
    *,
    answer_key: list[str],
    points: list[float] | None,
    question_rules: list[dict[str, Any]] | None,
    answers: list[str],
    flags: dict[str, str],
    corrections: dict[str, str],
) -> tuple[str, float, float]:
    idx = q_num - 1
    weight = float(points[idx]) if points and idx < len(points) else 1.0
    rule = question_rules[idx] if question_rules and idx < len(question_rules) else None
    q_rule = parse_single_question_rule(rule) if rule else QuestionRule()

    choice, is_unresolved_flag = resolve_effective_choice(q_num, answers, flags, corrections)
    if is_unresolved_flag:
        _, _, max_pts = score_single_answer("", answer_key[idx], weight, q_rule)
        return "flagged", 0.0, max_pts

    outcome, earned, max_pts = score_single_answer(choice, answer_key[idx], weight, q_rule)
    return outcome.value, earned, max_pts


def rescore_paper(quiz: dict[str, Any], paper: dict[str, Any]) -> PaperScoreSummary:
    resolved = resolve_quiz_key_for_version(quiz, paper.get("keyVersion"))
    q_count = len(resolved.answer_key)
    answers = paper.get("answers") or []
    flags = {str(k): str(v) for k, v in (paper.get("flags") or {}).items()}
    corrections = {str(k): str(v) for k, v in (paper.get("corrections") or {}).items()}
    kv_flagged = bool(paper.get("keyVersionFlagged"))

    earned = 0.0
    total = 0.0
    has_unresolved_flag = False
    for q_num in range(1, q_count + 1):
        status, q_earned, q_max = evaluate_question_score(
            q_num,
            answer_key=resolved.answer_key,
            points=resolved.points,
            question_rules=resolved.question_rules,
            answers=answers,
            flags=flags,
            corrections=corrections,
        )
        earned += q_earned
        total += q_max
        if status == "flagged":
            has_unresolved_flag = True

    all_blank = q_count > 0 and all(
        resolve_effective_choice(q, answers, {}, corrections)[0] == ""
        for q in range(1, q_count + 1)
    )
    needs_review = has_unresolved_flag or kv_flagged or (all_blank and not corrections)
    score = (earned / total) * 100.0 if total > 0 else 0.0
    return PaperScoreSummary(
        score=score,
        needs_review=needs_review,
        earned_points=earned,
        total_points=total,
    )


def _apply_quiz_rescore(
    quiz: dict[str, Any],
    paper: dict[str, Any],
    *,
    requested_version: str | None = None,
    set_key_version: bool = False,
    kv_flagged: bool = False,
    extra_needs_review: bool = False,
) -> PaperScoreSummary:
    resolved = resolve_quiz_key_for_version(
        quiz, requested_version if requested_version is not None else paper.get("keyVersion")
    )
    if set_key_version or "keyVersion" in paper:
        paper["keyVersion"] = resolved.version
    if kv_flagged:
        paper["keyVersionFlagged"] = True
    else:
        paper.pop("keyVersionFlagged", None)
    summary = rescore_paper(quiz, paper)
    paper["score"] = summary.score
    paper["needsReview"] = summary.needs_review or extra_needs_review or kv_flagged
    return summary


def _scoring_snapshot(quiz: dict[str, Any]) -> str:
    return json.dumps(
        {
            "answerKey": quiz.get("answerKey"),
            "points": quiz.get("points") or [1.0] * len(quiz.get("answerKey") or []),
            "questionRules": quiz.get("questionRules"),
            "keyVersions": quiz.get("keyVersions"),
        },
        sort_keys=True,
    )


def _summarize_quiz_dir(qdir: Path, quiz: dict[str, Any] | None = None) -> dict[str, Any]:
    quiz_data = quiz if quiz is not None else _read_json(qdir / "quiz.json")
    paper_count, needs_review_count = _count_quiz_papers(qdir)
    return {
        **quiz_data,
        "paperCount": paper_count,
        "needsReviewCount": needs_review_count,
    }


def list_quiz_summaries(folder: Path) -> list[dict[str, Any]]:
    with _lock_for(folder):
        items = [_summarize_quiz_dir(qdir) for qdir in _list_quiz_dirs(folder)]
        return sorted(items, key=lambda q: str(q.get("createdAt", "")), reverse=True)


def get_quiz(folder: Path, quiz_id: str) -> dict[str, Any]:
    with _lock_for(folder):
        _, quiz = _find_quiz_dir(folder, quiz_id)
        return quiz


def get_quiz_workspace(folder: Path, quiz_id: str) -> dict[str, Any]:
    with _lock_for(folder):
        qdir, quiz = _find_quiz_dir(folder, quiz_id)
        return {"quiz": quiz, "papers": _read_quiz_papers(qdir)}


def is_quiz_key_configured(quiz: dict[str, Any]) -> bool:
    ak = quiz.get("answerKey") or []
    return bool(ak) and all(bool(str(a).strip()) for a in ak)


def save_quiz(
    folder: Path,
    payload: dict[str, Any],
    *,
    quiz_id: str | None = None,
    require_existing: bool = False,
) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ResourceValidationError("Quiz name cannot be empty.")
    template_id = str(payload.get("templateId") or "")
    spec = get_template_spec(template_id)
    raw_ak = payload.get("answerKey")
    if not isinstance(raw_ak, list) or len(raw_ak) != spec.question_count:
        raise ResourceValidationError(f"Expected {spec.question_count} answer key entries.")
    is_all_blank = all(str(a).strip() == "" for a in raw_ak)

    if is_all_blank:
        _, points = _validate_key_and_points(
            spec.question_count, ["A"] * spec.question_count, payload.get("points")
        )
        norm_key_validated: list[str] | None = None
    else:
        norm_key_validated, points = _validate_key_and_points(
            spec.question_count, [str(a) for a in raw_ak], payload.get("points")
        )

    rules = _validate_question_rules(spec.question_count, payload.get("questionRules"))
    key_versions = _validate_key_versions(spec.question_count, payload.get("keyVersions"))

    with _lock_for(folder):
        existing_dir: Path | None = None
        existing_quiz: dict[str, Any] | None = None
        lookup_id = quiz_id or payload.get("id")
        if lookup_id:
            for qdir in _list_quiz_dirs(folder):
                q = _read_json(qdir / "quiz.json")
                if q.get("id") == lookup_id:
                    existing_dir, existing_quiz = qdir, q
                    break
        if require_existing and existing_quiz is None:
            raise ResourceNotFoundError(f"Quiz {lookup_id} not found.")

        if is_all_blank:
            already_configured = existing_quiz is not None and (
                is_quiz_key_configured(existing_quiz)
                or (existing_dir is not None and bool(_read_quiz_papers(existing_dir)))
            )
            if already_configured:
                raise ResourceValidationError(
                    "Answer key cannot be blank once papers are graded or a key is set."
                )
            norm_key = [""] * spec.question_count
        else:
            assert norm_key_validated is not None
            norm_key = norm_key_validated

        target_id = (
            existing_quiz["id"]
            if existing_quiz
            else (str(lookup_id) if lookup_id else str(uuid.uuid4()))
        )
        classes = _read_classes(folder)
        known_class_ids = {c["id"] for c in classes}
        raw_class_ids = payload.get("classIds")
        if raw_class_ids is not None:
            resolved_class_ids = [
                cid for cid in dict.fromkeys(raw_class_ids) if cid in known_class_ids
            ]
        else:
            resolved_class_ids = (
                list(existing_quiz.get("classIds") or []) if existing_quiz else []
            )

        raw_tags = payload.get("tags")
        if raw_tags is not None:
            resolved_tags = list(dict.fromkeys(str(t).strip() for t in raw_tags if str(t).strip()))
        else:
            resolved_tags = list(existing_quiz.get("tags") or []) if existing_quiz else []

        resolved_date = (
            str(payload["date"]).strip()
            if payload.get("date") is not None
            else (existing_quiz.get("date", "") if existing_quiz else "")
        )

        quiz: dict[str, Any] = {
            "id": target_id,
            "name": name,
            "templateId": existing_quiz["templateId"] if existing_quiz else spec.template_id,
            "answerKey": norm_key,
            "createdAt": existing_quiz["createdAt"] if existing_quiz else next_created_at(),
        }
        if resolved_date:
            quiz["date"] = resolved_date
        if resolved_class_ids:
            quiz["classIds"] = resolved_class_ids
        if resolved_tags:
            quiz["tags"] = resolved_tags
        if points is not None:
            quiz["points"] = points
        elif existing_quiz and existing_quiz.get("points") is not None:
            quiz["points"] = existing_quiz["points"]
        if rules is not None:
            if any(rules):
                quiz["questionRules"] = rules
        elif existing_quiz and "questionRules" in existing_quiz:
            quiz["questionRules"] = existing_quiz["questionRules"]
        if key_versions is not None:
            quiz["keyVersions"] = key_versions
        elif "keyVersions" not in payload and existing_quiz and "keyVersions" in existing_quiz:
            quiz["keyVersions"] = existing_quiz["keyVersions"]

        quiz_rel = Path("quizzes") / _quiz_dir_name(target_id, name)
        desired_dir = _ensure_under_root(folder, folder / quiz_rel)
        if existing_dir is not None and existing_dir.resolve() != desired_dir.resolve():
            _invalidate_quiz_counts(existing_dir)
            desired_dir.parent.mkdir(parents=True, exist_ok=True)
            existing_dir.rename(desired_dir)
        else:
            desired_dir.mkdir(parents=True, exist_ok=True)
        _write_json(folder, desired_dir / "quiz.json", quiz)

        scoring_changed = (
            existing_quiz is not None
            and _scoring_snapshot(existing_quiz) != _scoring_snapshot(quiz)
        )
        if scoring_changed:
            avail_kvs = set(available_key_versions(quiz))
            papers_dir = desired_dir / "papers"
            paper_files = list(papers_dir.iterdir()) if papers_dir.is_dir() else []
            for pfile in paper_files:
                if not pfile.is_file() or pfile.suffix != ".json":
                    continue
                paper = _read_json(pfile)
                prev_kv = str(paper.get("keyVersion") or "A").strip().upper()
                kv_removed = prev_kv not in avail_kvs
                _apply_quiz_rescore(
                    quiz,
                    paper,
                    kv_flagged=kv_removed or bool(paper.get("keyVersionFlagged")),
                )
                _write_json(folder, pfile, paper)
            _invalidate_quiz_counts(desired_dir)
        _touch_folder_modified(folder)
        return quiz


def delete_quiz(folder: Path, quiz_id: str) -> None:
    with _lock_for(folder):
        qdir, _ = _find_quiz_dir(folder, quiz_id)
        _invalidate_quiz_counts(qdir)
        shutil.rmtree(qdir)
        _touch_folder_modified(folder)


def _escape_csv_cell(value: str) -> str:
    return f"'{value}" if value.startswith(("=", "+", "-", "@", "\t", "\r")) else value


def _format_num(val: float) -> str:
    return f"{val:.1f}" if float(val).is_integer() else str(val)


def export_quiz_csv(folder: Path, quiz_id: str) -> str:
    with _lock_for(folder):
        qdir, quiz = _find_quiz_dir(folder, quiz_id)
        papers = _read_quiz_papers(qdir)
        q_count = len(quiz["answerKey"])
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\r\n")
        writer.writerow(
            [
                "name",
                "student_id",
                "date",
                "class",
                "key_version",
                "score",
                "needs_review",
                *(f"q{i}" for i in range(1, q_count + 1)),
            ]
        )
        for paper in papers:
            corrs = {str(k): str(v) for k, v in (paper.get("corrections") or {}).items()}
            answers = [str(a) for a in (paper.get("answers") or [])]
            row_answers = [
                _escape_csv_cell(resolve_effective_choice(i, answers, {}, corrs)[0])
                for i in range(1, q_count + 1)
            ]
            writer.writerow(
                [
                    _escape_csv_cell(str(paper.get("nameText") or "")),
                    _escape_csv_cell(str(paper.get("studentIdText") or "")),
                    _escape_csv_cell(str(paper.get("dateText") or "")),
                    _escape_csv_cell(str(paper.get("classText") or "")),
                    _escape_csv_cell(str(paper.get("keyVersion") or "A")),
                    _format_num(float(paper.get("score") or 0.0)),
                    "True" if paper.get("needsReview") else "False",
                    *row_answers,
                ]
            )
        return "\ufeff" + buf.getvalue()
