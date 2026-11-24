from __future__ import annotations

import threading
from pathlib import Path

import pytest

from app.workspace_store import (
    FolderExistsError,
    FolderNameError,
    FolderNotFoundError,
    ResourceConflictError,
    ResourceNotFoundError,
    ResourceValidationError,
    create_folder,
    delete_class,
    delete_folder,
    delete_paper,
    delete_quiz,
    delete_student,
    export_quiz_csv,
    folder_dir,
    get_class_detail,
    get_quiz_workspace,
    get_review_queue,
    get_roster,
    get_student_detail,
    import_students,
    is_quiz_key_configured,
    list_class_summaries,
    list_folders,
    list_quiz_summaries,
    parse_full_name,
    rename_folder,
    rescore_paper,
    resolve_paper_image_path,
    save_class,
    save_graded_paper,
    save_quiz,
    save_student,
    submit_paper_review,
    validate_folder_name,
)


def _grade_payload(
    *,
    answers: list[str] | None = None,
    flags: dict[int, str] | None = None,
    score: float = 100.0,
    needs_review: bool = False,
    name_text: str = "Lovelace, Ada",
    class_text: str = "10-Rizal",
    student_id_text: str = "10021",
    date_text: str = "2026-11-22",
    key_version: str | None = None,
    key_version_detected: str = "",
    key_version_flagged: bool = False,
) -> dict:
    ans = answers or ["A"] * 20
    payload: dict = {
        "answers": ans,
        "flags": flags or {},
        "confidence": [0.95] * len(ans),
        "score": score,
        "needs_review": needs_review,
        "name_text": name_text,
        "class_text": class_text,
        "student_id_text": student_id_text,
        "date_text": date_text,
    }
    if key_version is not None:
        payload["key_version"] = key_version
    if key_version_detected:
        payload["key_version_detected"] = key_version_detected
    if key_version_flagged:
        payload["key_version_flagged"] = True
    return payload


def test_folder_validation_and_never_creates_default(tmp_path: Path):
    ws_root = tmp_path / "workspace"
    assert list_folders(ws_root) == []
    assert not ws_root.exists()

    ws_root.mkdir()
    (ws_root / ".gitkeep").write_text("", encoding="utf-8")
    assert list_folders(ws_root) == []

    for bad in ["", "   ", "a" * 61, "bad/name", "a:b", "CON", "nul.txt", "dot.", "..", "a\nb"]:
        with pytest.raises(FolderNameError):
            validate_folder_name(bad)

    created = create_folder(ws_root, "  Midterm Grade 10  ")
    assert created["name"] == "Midterm Grade 10"
    assert (ws_root / "Midterm Grade 10" / "folder.json").is_file()
    assert (ws_root / "Midterm Grade 10" / "classes.json").read_text(encoding="utf-8") == "[]"
    assert (ws_root / "Midterm Grade 10" / "students.json").read_text(encoding="utf-8") == "[]"

    with pytest.raises(FolderExistsError):
        create_folder(ws_root, "midterm grade 10")

    renamed = rename_folder(ws_root, "Midterm Grade 10", "midterm grade 10")
    assert renamed["name"] == "midterm grade 10"

    delete_folder(ws_root, "midterm grade 10")
    assert list_folders(ws_root) == []
    with pytest.raises(FolderNotFoundError):
        folder_dir(ws_root, "midterm grade 10")


def test_roster_crud_copy_and_retroactive_linking(tmp_path: Path):
    ws_root = tmp_path / "workspace"
    create_folder(ws_root, "Session A")
    fdir = folder_dir(ws_root, "Session A")

    cls_rec = save_class(fdir, name="10-Rizal", term="Q1")
    with pytest.raises(ResourceConflictError):
        save_class(fdir, name="10-rizal")

    quiz = save_quiz(
        fdir,
        {
            "name": "Unit 3 Biology",
            "templateId": "20q_a4",
            "answerKey": ["A"] * 20,
            "classIds": [cls_rec["id"]],
        },
    )

    paper = save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(name_text="", student_id_text="99-001", class_text=""),
        raw_bytes=b"raw",
        raw_ext=".jpg",
        aligned_jpeg_bytes=b"aligned",
    )
    assert paper["studentId"] is None

    stu = save_student(
        fdir,
        student_code="99001",
        first_name="Ada",
        last_name="Lovelace",
        class_ids=[cls_rec["id"]],
    )
    with pytest.raises(ResourceConflictError):
        save_student(fdir, student_code="99-001", first_name="Dup", last_name="Person")

    ws = get_quiz_workspace(fdir, quiz["id"])
    linked_paper = ws["papers"][0]
    assert linked_paper["studentId"] == stu["id"]
    assert linked_paper["nameText"] == "Lovelace, Ada"
    assert "Lovelace-Ada" in linked_paper["imagePaths"]["aligned"]

    create_folder(ws_root, "Session B", copy_roster_from="Session A")
    fdir_b = folder_dir(ws_root, "Session B")
    roster_b = get_roster(fdir_b)
    assert len(roster_b["classes"]) == 1
    assert len(roster_b["students"]) == 1
    assert list_quiz_summaries(fdir_b) == []

    assert list_class_summaries(fdir)[0]["quizCount"] == 1
    assert get_class_detail(fdir, cls_rec["id"])["students"][0]["id"] == stu["id"]
    assert len(get_student_detail(fdir, stu["id"])["gradedPapers"]) == 1

    delete_student(fdir, stu["id"])
    assert get_quiz_workspace(fdir, quiz["id"])["papers"][0]["studentId"] is None
    delete_class(fdir, cls_rec["id"])
    assert get_quiz_workspace(fdir, quiz["id"])["papers"]
    assert "classIds" not in get_quiz_workspace(fdir, quiz["id"])["quiz"]


def test_quiz_rename_rescore_review_id6_collision_and_delete(tmp_path: Path):
    ws_root = tmp_path / "workspace"
    create_folder(ws_root, "Midterm Grade 10")
    fdir = folder_dir(ws_root, "Midterm Grade 10")

    quiz = save_quiz(
        fdir,
        {
            "name": "Bio Draft",
            "templateId": "20q_a4",
            "answerKey": ["A"] * 20,
            "points": [1.0] * 20,
            "keyVersions": {"B": {"answerKey": ["C"] * 20}},
        },
    )

    p1 = save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(
            answers=["B"] + ["A"] * 19,
            flags={1: "ambiguous"},
            score=95.0,
            needs_review=True,
            key_version="A",
            key_version_detected="A",
        ),
        raw_bytes=b"raw1",
        raw_ext=".png",
        aligned_jpeg_bytes=b"aligned1",
        paper_id="abc12300-0000-0000-0000-000000000001",
    )
    p2 = save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(
            answers=["C"] * 20,
            name_text="Turing, Alan",
            student_id_text="10022",
            key_version="B",
            key_version_detected="B",
        ),
        raw_bytes=b"raw2",
        raw_ext=".jpg",
        aligned_jpeg_bytes=b"aligned2",
        paper_id="abc12300-0000-0000-0000-000000000002",
    )
    assert len(get_quiz_workspace(fdir, quiz["id"])["papers"]) == 2

    renamed_quiz = save_quiz(
        fdir,
        {
            "id": quiz["id"],
            "name": "Unit 3 Biology",
            "templateId": "20q_a4",
            "answerKey": quiz["answerKey"],
        },
    )
    img1 = resolve_paper_image_path(fdir, renamed_quiz["id"], p1["id"], "aligned")
    assert img1.read_bytes() == b"aligned1"
    img2 = resolve_paper_image_path(fdir, renamed_quiz["id"], p2["id"], "raw")
    assert img2.read_bytes() == b"raw2"

    save_quiz(
        fdir,
        {
            "id": quiz["id"],
            "name": "Unit 3 Biology",
            "templateId": "20q_a4",
            "answerKey": ["B"] + ["A"] * 19,
        },
    )

    queue = get_review_queue(fdir)
    assert [item["id"] for item in queue] == [p1["id"]]

    reviewed = submit_paper_review(
        fdir,
        quiz["id"],
        p1["id"],
        corrections={"1": "B"},
        identity={"nameText": "Hopper, Grace", "studentIdText": "55555"},
    )
    assert reviewed["needsReview"] is False
    assert reviewed["score"] == pytest.approx(100.0)
    assert "Hopper-Grace" in reviewed["imagePaths"]["aligned"]
    reviewed_img = resolve_paper_image_path(fdir, quiz["id"], p1["id"], "aligned")
    assert reviewed_img.read_bytes() == b"aligned1"

    regraded = save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(answers=["C"] + ["A"] * 19, score=90.0),
        raw_bytes=b"raw1-new",
        raw_ext=".jpg",
        aligned_jpeg_bytes=b"aligned1-new",
        paper_id=p1["id"],
    )
    assert regraded["corrections"] == {}
    assert regraded["studentId"] == reviewed["studentId"]
    assert regraded["score"] == pytest.approx(95.0)
    assert resolve_paper_image_path(fdir, quiz["id"], p1["id"], "aligned").read_bytes() == (
        b"aligned1-new"
    )
    with pytest.raises(ResourceNotFoundError):
        resolve_paper_image_path(fdir, quiz["id"], "missing", "raw")
    raw_parent = resolve_paper_image_path(fdir, quiz["id"], p1["id"], "raw").parent
    assert len(list(raw_parent.iterdir())) == 2

    csv_text = export_quiz_csv(fdir, quiz["id"])
    assert csv_text.startswith(
        "\ufeffname,student_id,date,class,key_version,score,needs_review,q1"
    )
    assert "55555" in csv_text

    kv_flagged = save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(
            answers=["B"] + ["A"] * 19,
            score=100.0,
            key_version="A",
            key_version_detected="C",
            key_version_flagged=True,
        ),
        raw_bytes=b"r3",
        raw_ext=".jpg",
        aligned_jpeg_bytes=b"a3",
    )
    assert kv_flagged["needsReview"] is True
    cleared = submit_paper_review(fdir, quiz["id"], kv_flagged["id"], key_version="A")
    assert cleared["needsReview"] is False
    assert "keyVersionFlagged" not in cleared

    delete_paper(fdir, quiz["id"], p1["id"])
    with pytest.raises(ResourceNotFoundError):
        resolve_paper_image_path(fdir, quiz["id"], p1["id"], "aligned")

    delete_quiz(fdir, quiz["id"])
    assert list_quiz_summaries(fdir) == []


def test_rescore_paper_partial_and_incorrect_rules():
    quiz = {
        "answerKey": ["A+B", "C"],
        "points": [2.0, 1.0],
        "questionRules": [
            {"alternateAnswers": [{"choice": "E", "points": 1.0}], "incorrectPoints": -0.5},
            {},
        ],
    }
    paper = {"answers": ["E", "D"], "flags": {}, "corrections": {}}
    score, needs_review, earned, total = rescore_paper(quiz, paper)
    assert needs_review is False
    assert earned == pytest.approx(1.0)
    assert total == pytest.approx(3.0)
    assert score == pytest.approx(100.0 / 3.0)


def test_rescan_write_failure_preserves_images_and_new_paper_rescores(tmp_path: Path, monkeypatch):
    import app.workspace_store.io as ws_io

    ws_root = tmp_path / "workspace"
    created = create_folder(ws_root, "Safety")
    fdir = folder_dir(ws_root, "Safety")

    quiz = save_quiz(
        fdir,
        {
            "name": "Safety Quiz",
            "templateId": "20q_a4",
            "answerKey": ["A"] * 20,
        },
    )
    paper = save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(answers=["B"] + ["A"] * 19, score=10.0),
        raw_bytes=b"raw-orig",
        raw_ext=".png",
        aligned_jpeg_bytes=b"aligned-orig",
    )
    assert paper["score"] == pytest.approx(95.0)
    assert list_folders(ws_root)[0]["lastModified"] >= created["lastModified"]

    orig_stage = ws_io._stage_temp_bytes
    stage_calls = 0

    def fail_second_stage(root: Path, target: Path, data: bytes):
        nonlocal stage_calls
        stage_calls += 1
        if stage_calls == 2:
            raise OSError("disk full")
        return orig_stage(root, target, data)

    monkeypatch.setattr(ws_io, "_stage_temp_bytes", fail_second_stage)
    with pytest.raises(OSError, match="disk full"):
        save_graded_paper(
            fdir,
            quiz["id"],
            grade_result=_grade_payload(answers=["C"] * 20, score=0.0),
            raw_bytes=b"raw-fail",
            raw_ext=".png",
            aligned_jpeg_bytes=b"aligned-fail",
            paper_id=paper["id"],
        )

    assert (
        resolve_paper_image_path(fdir, quiz["id"], paper["id"], "raw").read_bytes()
        == b"raw-orig"
    )
    assert (
        resolve_paper_image_path(fdir, quiz["id"], paper["id"], "aligned").read_bytes()
        == b"aligned-orig"
    )
    assert get_quiz_workspace(fdir, quiz["id"])["papers"][0]["score"] == pytest.approx(95.0)
    qdir = next((fdir / "quizzes").iterdir())
    assert list(qdir.rglob(".tmp-*")) == []


def test_concurrent_create_folder_and_lock_cleanup(tmp_path: Path):
    import app.workspace_store.io as ws_io

    ws_root = tmp_path / "workspace"
    thread_count = 8
    barrier = threading.Barrier(thread_count)
    successes: list[dict] = []
    conflicts: list[FolderExistsError] = []
    errors: list[BaseException] = []
    collect_guard = threading.Lock()

    def worker():
        try:
            barrier.wait(timeout=5)
            created = create_folder(ws_root, "RaceFolder")
            with collect_guard:
                successes.append(created)
        except FolderExistsError as exc:
            with collect_guard:
                conflicts.append(exc)
        except BaseException as exc:
            with collect_guard:
                errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(thread_count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert errors == []
    assert len(successes) == 1
    assert len(conflicts) == thread_count - 1
    assert [f["name"] for f in list_folders(ws_root)] == ["RaceFolder"]

    orig_dir = folder_dir(ws_root, "RaceFolder")
    orig_key = ws_io._lock_key(orig_dir)
    save_class(orig_dir, name="Class A")
    assert orig_key in ws_io._locks

    rename_folder(ws_root, "RaceFolder", "RenamedFolder")
    assert orig_key not in ws_io._locks

    renamed_dir = folder_dir(ws_root, "RenamedFolder")
    renamed_key = ws_io._lock_key(renamed_dir)
    save_class(renamed_dir, name="Class B")
    assert renamed_key in ws_io._locks

    rename_folder(ws_root, "RenamedFolder", "renamedfolder")
    assert renamed_key not in ws_io._locks

    lower_dir = folder_dir(ws_root, "renamedfolder")
    lower_key = ws_io._lock_key(lower_dir)
    save_class(lower_dir, name="Class C")
    assert lower_key in ws_io._locks

    delete_folder(ws_root, "renamedfolder")
    assert lower_key not in ws_io._locks


def test_unset_answer_key_allowed_on_new_quiz_and_rejects_partial(tmp_path: Path):
    ws_root = tmp_path / "workspace"
    create_folder(ws_root, "Draft Key Folder")
    fdir = folder_dir(ws_root, "Draft Key Folder")

    draft = save_quiz(
        fdir,
        {
            "name": "Draft Quiz",
            "templateId": "20q_a4",
            "answerKey": [""] * 20,
        },
    )
    assert is_quiz_key_configured(draft) is False

    updated_meta = save_quiz(
        fdir,
        {
            "id": draft["id"],
            "name": "Draft Quiz Updated",
            "templateId": "20q_a4",
            "answerKey": [""] * 20,
            "tags": ["unit-1"],
        },
    )
    assert is_quiz_key_configured(updated_meta) is False

    with pytest.raises(ResourceValidationError):
        save_quiz(
            fdir,
            {
                "id": draft["id"],
                "name": "Draft Quiz Updated",
                "templateId": "20q_a4",
                "answerKey": ["A"] + [""] * 19,
            },
        )

    configured = save_quiz(
        fdir,
        {
            "id": draft["id"],
            "name": "Draft Quiz Updated",
            "templateId": "20q_a4",
            "answerKey": ["A"] * 20,
        },
    )
    assert is_quiz_key_configured(configured) is True

    with pytest.raises(ResourceValidationError):
        save_quiz(
            fdir,
            {
                "id": draft["id"],
                "name": "Draft Quiz Updated",
                "templateId": "20q_a4",
                "answerKey": [""] * 20,
            },
        )


def test_remove_key_version_and_review_identity_sync(tmp_path: Path):
    ws_root = tmp_path / "workspace"
    create_folder(ws_root, "KeysAndSync")
    fdir = folder_dir(ws_root, "KeysAndSync")

    with pytest.raises(ResourceValidationError, match="Unknown key version"):
        save_quiz(
            fdir,
            {
                "name": "Bad Version",
                "templateId": "20q_a4",
                "answerKey": ["A"] * 20,
                "keyVersions": {"E": {"answerKey": ["B"] * 20}},
            },
        )

    quiz = save_quiz(
        fdir,
        {
            "name": "Multi Key",
            "templateId": "20q_a4",
            "answerKey": ["A"] * 20,
            "keyVersions": {"B": {"answerKey": ["B"] * 20}},
        },
    )
    stu = save_student(
        fdir,
        student_code="2001",
        first_name="Ada",
        last_name="Lovelace",
    )
    paper = save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(
            answers=["B"] * 20,
            student_id_text="2001",
            name_text="Lovelace, Ada",
            key_version="B",
            key_version_detected="B",
        ),
        raw_bytes=b"raw-b",
        raw_ext=".jpg",
        aligned_jpeg_bytes=b"aligned-b",
    )
    assert paper["score"] == pytest.approx(100.0)
    assert "graded" not in paper["imagePaths"]
    qdir = next((fdir / "quizzes").iterdir())
    assert not (qdir / "graded").exists()

    updated_quiz = save_quiz(
        fdir,
        {
            "id": quiz["id"],
            "name": "Multi Key",
            "templateId": "20q_a4",
            "answerKey": ["A"] * 20,
            "keyVersions": {},
        },
    )
    assert "keyVersions" not in updated_quiz
    rescored = get_quiz_workspace(fdir, quiz["id"])["papers"][0]
    assert rescored["keyVersion"] == "A"
    assert rescored["score"] == pytest.approx(0.0)
    assert rescored["keyVersionFlagged"] is True
    assert rescored["needsReview"] is True

    reviewed = submit_paper_review(
        fdir,
        quiz["id"],
        paper["id"],
        identity={
            "nameText": "Byron, Augusta Ada",
            "studentIdText": "2002",
            "classText": "10-Newton",
        },
    )
    assert "2002_Byron-Augusta-Ada_" in reviewed["imagePaths"]["aligned"]
    assert resolve_paper_image_path(fdir, quiz["id"], paper["id"], "aligned").is_file()

    roster = get_roster(fdir)
    synced_stu = next(s for s in roster["students"] if s["id"] == stu["id"])
    assert synced_stu["firstName"] == "Augusta Ada"
    assert synced_stu["lastName"] == "Byron"
    assert synced_stu["studentCode"] == "2002"
    assert any(c["name"] == "10-Newton" for c in roster["classes"])


def test_import_students_bulk_dedup_and_single_pass_linking(tmp_path: Path):
    ws_root = tmp_path / "workspace"
    create_folder(ws_root, "BulkCSV")
    fdir = folder_dir(ws_root, "BulkCSV")

    assert parse_full_name("Juan Dela Cruz") == ("Juan Dela", "Cruz")

    quiz = save_quiz(
        fdir,
        {
            "name": "Diagnostic",
            "templateId": "20q_a4",
            "answerKey": ["A"] * 20,
        },
    )
    unlinked = save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(
            answers=["A"] * 20,
            student_id_text="99-001",
            name_text="",
            class_text="",
        ),
        raw_bytes=b"raw-unlinked",
        raw_ext=".jpg",
        aligned_jpeg_bytes=b"aligned-unlinked",
    )
    assert unlinked["studentId"] is None

    result = import_students(
        fdir,
        [
            {
                "studentCode": "99001",
                "firstName": "Juan Dela",
                "lastName": "Cruz",
                "className": "10-Rizal",
                "externalRef": "LRN-1",
            },
            {
                "studentCode": "99-001",
                "firstName": "Dup",
                "lastName": "Row",
                "className": "10-Rizal",
            },
            {
                "studentCode": "",
                "firstName": "Grace",
                "lastName": "Hopper",
                "className": "10-Rizal",
            },
        ],
    )
    assert result["imported"] == 2
    assert result["skipped"] == 1
    assert len(get_roster(fdir)["students"]) == 2
    assert len(list_class_summaries(fdir)) == 1

    linked = get_quiz_workspace(fdir, quiz["id"])["papers"][0]
    assert linked["studentId"] == result["students"][0]["id"]
    assert linked["nameText"] == "Cruz, Juan Dela"


def test_export_quiz_csv_escapes_tab_and_cr_formulas(tmp_path: Path):
    ws_root = tmp_path / "workspace"
    create_folder(ws_root, "CsvSafe")
    fdir = folder_dir(ws_root, "CsvSafe")
    quiz = save_quiz(
        fdir,
        {"name": "CSV", "templateId": "20q_a4", "answerKey": ["A"] * 20},
    )
    save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(
            answers=["A"] * 20,
            name_text="\t=SUM(A1)",
            class_text="\r+CMD",
            student_id_text="",
        ),
        raw_bytes=b"r",
        raw_ext=".jpg",
        aligned_jpeg_bytes=b"a",
    )
    csv_text = export_quiz_csv(fdir, quiz["id"])
    assert "'\t=SUM(A1)" in csv_text
    assert "'\r+CMD" in csv_text


def test_review_linking_student_does_not_overwrite_roster_name(tmp_path: Path):
    ws_root = tmp_path / "workspace"
    create_folder(ws_root, "LinkSafe")
    fdir = folder_dir(ws_root, "LinkSafe")

    cls_rec = save_class(fdir, name="10-Darwin")
    stu = save_student(
        fdir,
        student_code="10-500",
        first_name="Juan",
        last_name="Dela Cruz",
        class_ids=[cls_rec["id"]],
    )
    quiz = save_quiz(
        fdir,
        {"name": "Link Quiz", "templateId": "20q_a4", "answerKey": ["A"] * 20},
    )
    paper = save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=_grade_payload(
            answers=["A"] * 20,
            name_text="Noisy OCR Name",
            student_id_text="",
            class_text="",
        ),
        raw_bytes=b"raw",
        raw_ext=".jpg",
        aligned_jpeg_bytes=b"aligned",
    )
    assert paper["studentId"] is None

    linked = submit_paper_review(
        fdir,
        quiz["id"],
        paper["id"],
        identity={"studentId": stu["id"]},
    )
    assert linked["studentId"] == stu["id"]
    assert linked["nameText"] == "Dela Cruz, Juan"
    assert linked["studentIdText"] == "10-500"
    assert linked["classText"] == "10-Darwin"

    roster_stu = get_roster(fdir)["students"][0]
    assert roster_stu["firstName"] == "Juan"
    assert roster_stu["lastName"] == "Dela Cruz"
    assert roster_stu["studentCode"] == "10-500"
