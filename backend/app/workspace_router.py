from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.answer_sheet_templates.catalog import get_template_spec
from app.config import get_settings
from app.grading_pipeline.pipeline import build_resolved_key_specs
from app.stateless_router import (
    grade_decoded_sheet,
    read_and_decode_image,
)
from app.workspace_store import (
    TEMPLATE_PDF_SOURCE_NAMES,
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
    get_quiz,
    get_quiz_workspace,
    get_review_queue,
    get_roster,
    get_student_detail,
    import_students,
    is_quiz_key_configured,
    list_class_summaries,
    list_folders,
    list_quiz_summaries,
    rename_folder,
    resolve_paper_image_path,
    save_class,
    save_graded_paper,
    save_quiz,
    save_student,
    slugify_segment,
    submit_paper_review,
)

workspace_router = APIRouter(prefix="/workspace", tags=["workspace"])


def _ws_root() -> Path:
    return Path(get_settings().autograde_workspace_dir)


def _templates_root() -> Path:
    return Path(get_settings().autograde_data_dir) / "templates"


class CreateFolderRequest(BaseModel):
    name: str
    copyRosterFrom: str | None = None


class RenameFolderRequest(BaseModel):
    name: str


class SaveClassRequest(BaseModel):
    id: str | None = None
    name: str
    term: str | None = None


class SaveStudentRequest(BaseModel):
    id: str | None = None
    studentCode: str
    firstName: str
    lastName: str
    externalRef: str | None = None
    classIds: list[str] | None = None


class ImportStudentItem(BaseModel):
    studentCode: str = ""
    firstName: str
    lastName: str
    externalRef: str = ""
    className: str = ""


class ImportStudentsRequest(BaseModel):
    students: list[ImportStudentItem]


class SaveQuizRequest(BaseModel):
    id: str | None = None
    name: str
    templateId: str
    answerKey: list[str]
    points: list[float] | None = None
    date: str | None = None
    classIds: list[str] | None = None
    tags: list[str] | None = None
    questionRules: list[dict[str, Any]] | None = None
    keyVersions: dict[str, Any] | None = None


class ReviewIdentityPatch(BaseModel):
    nameText: str | None = None
    dateText: str | None = None
    classText: str | None = None
    studentIdText: str | None = None
    studentId: str | None = None


class SubmitReviewRequest(BaseModel):
    corrections: dict[str, str] | None = None
    keyVersion: str | None = None
    identity: ReviewIdentityPatch | None = Field(default=None)




@workspace_router.get("/folders")
def list_folders_endpoint() -> list[dict[str, Any]]:
    return list_folders(_ws_root())


@workspace_router.post("/folders", status_code=201)
def create_folder_endpoint(payload: CreateFolderRequest) -> dict[str, Any]:
    return create_folder(
        _ws_root(),
        payload.name,
        copy_roster_from=payload.copyRosterFrom,
    )


@workspace_router.patch("/folders/{folder}")
def rename_folder_endpoint(folder: str, payload: RenameFolderRequest) -> dict[str, Any]:
    return rename_folder(_ws_root(), folder, payload.name)


@workspace_router.delete("/folders/{folder}", status_code=204)
def delete_folder_endpoint(folder: str) -> Response:
    delete_folder(_ws_root(), folder)
    return Response(status_code=204)


@workspace_router.get("/templates/{template_id}")
def workspace_download_template_endpoint(template_id: str) -> FileResponse:
    get_template_spec(template_id)
    src_name = TEMPLATE_PDF_SOURCE_NAMES.get(template_id)
    pdf_path = _templates_root() / template_id / src_name if src_name else Path()
    if not src_name or not pdf_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"Printable PDF for template '{template_id}' not found.",
        )
    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=src_name,
    )




@workspace_router.get("/folders/{folder}/roster")
def folder_roster_endpoint(folder: str) -> dict[str, Any]:
    return get_roster(folder_dir(_ws_root(), folder))


@workspace_router.get("/folders/{folder}/classes")
def folder_classes_endpoint(folder: str) -> list[dict[str, Any]]:
    return list_class_summaries(folder_dir(_ws_root(), folder))


@workspace_router.get("/folders/{folder}/classes/{class_id}")
def folder_class_detail_endpoint(folder: str, class_id: str) -> dict[str, Any]:
    return get_class_detail(folder_dir(_ws_root(), folder), class_id)


@workspace_router.post("/folders/{folder}/classes", status_code=201)
def create_class_endpoint(folder: str, payload: SaveClassRequest) -> dict[str, Any]:
    return save_class(
        folder_dir(_ws_root(), folder),
        class_id=payload.id,
        name=payload.name,
        term=payload.term,
    )


@workspace_router.put("/folders/{folder}/classes/{class_id}")
def update_class_endpoint(
    folder: str, class_id: str, payload: SaveClassRequest
) -> dict[str, Any]:
    return save_class(
        folder_dir(_ws_root(), folder),
        class_id=class_id,
        name=payload.name,
        term=payload.term,
        require_existing=True,
    )


@workspace_router.delete("/folders/{folder}/classes/{class_id}", status_code=204)
def delete_class_endpoint(folder: str, class_id: str) -> Response:
    delete_class(folder_dir(_ws_root(), folder), class_id)
    return Response(status_code=204)


@workspace_router.get("/folders/{folder}/students/{student_id}")
def student_detail_endpoint(folder: str, student_id: str) -> dict[str, Any]:
    return get_student_detail(folder_dir(_ws_root(), folder), student_id)


@workspace_router.post("/folders/{folder}/students", status_code=201)
def create_student_endpoint(folder: str, payload: SaveStudentRequest) -> dict[str, Any]:
    return save_student(
        folder_dir(_ws_root(), folder),
        student_id=payload.id,
        student_code=payload.studentCode,
        first_name=payload.firstName,
        last_name=payload.lastName,
        external_ref=payload.externalRef,
        class_ids=payload.classIds,
    )


@workspace_router.post("/folders/{folder}/students/import", status_code=201)
def import_students_endpoint(folder: str, payload: ImportStudentsRequest) -> dict[str, Any]:
    return import_students(
        folder_dir(_ws_root(), folder),
        [item.model_dump() for item in payload.students],
    )


@workspace_router.put("/folders/{folder}/students/{student_id}")
def update_student_endpoint(
    folder: str, student_id: str, payload: SaveStudentRequest
) -> dict[str, Any]:
    return save_student(
        folder_dir(_ws_root(), folder),
        student_id=student_id,
        student_code=payload.studentCode,
        first_name=payload.firstName,
        last_name=payload.lastName,
        external_ref=payload.externalRef,
        class_ids=payload.classIds,
        require_existing=True,
    )


@workspace_router.delete("/folders/{folder}/students/{student_id}", status_code=204)
def delete_student_endpoint(folder: str, student_id: str) -> Response:
    delete_student(folder_dir(_ws_root(), folder), student_id)
    return Response(status_code=204)




@workspace_router.get("/folders/{folder}/quizzes")
def list_quizzes_endpoint(folder: str) -> list[dict[str, Any]]:
    return list_quiz_summaries(folder_dir(_ws_root(), folder))


@workspace_router.get("/folders/{folder}/quizzes/{quiz_id}")
def get_quiz_workspace_endpoint(folder: str, quiz_id: str) -> dict[str, Any]:
    return get_quiz_workspace(folder_dir(_ws_root(), folder), quiz_id)


@workspace_router.post("/folders/{folder}/quizzes", status_code=201)
def create_quiz_endpoint(folder: str, payload: SaveQuizRequest) -> dict[str, Any]:
    return save_quiz(
        folder_dir(_ws_root(), folder),
        payload.model_dump(exclude_unset=True),
    )


@workspace_router.put("/folders/{folder}/quizzes/{quiz_id}")
def update_quiz_endpoint(
    folder: str, quiz_id: str, payload: SaveQuizRequest
) -> dict[str, Any]:
    return save_quiz(
        folder_dir(_ws_root(), folder),
        payload.model_dump(exclude_unset=True),
        quiz_id=quiz_id,
        require_existing=True,
    )


@workspace_router.delete("/folders/{folder}/quizzes/{quiz_id}", status_code=204)
def delete_quiz_endpoint(folder: str, quiz_id: str) -> Response:
    delete_quiz(folder_dir(_ws_root(), folder), quiz_id)
    return Response(status_code=204)


@workspace_router.get("/folders/{folder}/quizzes/{quiz_id}/export.csv")
def export_quiz_csv_endpoint(folder: str, quiz_id: str) -> Response:
    fdir = folder_dir(_ws_root(), folder)
    quiz = get_quiz(fdir, quiz_id)
    slug = slugify_segment(quiz.get("name", ""), "quiz", lowercase=True)
    csv_text = export_quiz_csv(fdir, quiz_id)
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}-grades.csv"'},
    )




def _grade_into_folder_sync(
    fdir: Path,
    quiz: dict[str, Any],
    decoded,
    raw_bytes: bytes,
    raw_ext: str,
    paper_id: str,
) -> dict[str, Any]:
    spec = get_template_spec(quiz["templateId"])
    primary_key, key_versions = build_resolved_key_specs(quiz, spec.question_count)
    payload, aligned_bytes = grade_decoded_sheet(
        decoded,
        spec,
        primary_key,
        key_versions,
    )

    return save_graded_paper(
        fdir,
        quiz["id"],
        grade_result=payload,
        raw_bytes=raw_bytes,
        raw_ext=raw_ext,
        aligned_jpeg_bytes=aligned_bytes,
        paper_id=paper_id or None,
    )


@workspace_router.post("/folders/{folder}/quizzes/{quiz_id}/grade", status_code=201)
async def grade_folder_paper_endpoint(
    folder: str,
    quiz_id: str,
    file: UploadFile = File(...),
    paper_id: str = Form(""),
) -> dict[str, Any]:
    fdir = folder_dir(_ws_root(), folder)
    quiz = get_quiz(fdir, quiz_id)
    if not is_quiz_key_configured(quiz):
        raise ResourceValidationError("Set and save the answer key before uploading papers.")
    decoded, raw_bytes, raw_ext = await read_and_decode_image(file)
    return await run_in_threadpool(
        _grade_into_folder_sync,
        fdir,
        quiz,
        decoded,
        raw_bytes,
        raw_ext,
        paper_id,
    )


@workspace_router.get("/folders/{folder}/review")
def folder_review_queue_endpoint(folder: str) -> list[dict[str, Any]]:
    return get_review_queue(folder_dir(_ws_root(), folder))


@workspace_router.patch("/folders/{folder}/quizzes/{quiz_id}/papers/{paper_id}")
def submit_paper_review_endpoint(
    folder: str,
    quiz_id: str,
    paper_id: str,
    payload: SubmitReviewRequest,
) -> dict[str, Any]:
    ident = (
        payload.identity.model_dump(exclude_unset=True)
        if payload.identity is not None
        else None
    )
    return submit_paper_review(
        folder_dir(_ws_root(), folder),
        quiz_id,
        paper_id,
        corrections=payload.corrections,
        key_version=payload.keyVersion,
        identity=ident,
    )


@workspace_router.delete(
    "/folders/{folder}/quizzes/{quiz_id}/papers/{paper_id}", status_code=204
)
def delete_paper_endpoint(folder: str, quiz_id: str, paper_id: str) -> Response:
    delete_paper(folder_dir(_ws_root(), folder), quiz_id, paper_id)
    return Response(status_code=204)


@workspace_router.get("/folders/{folder}/quizzes/{quiz_id}/papers/{paper_id}/image/{kind}")
def get_paper_image_endpoint(folder: str, quiz_id: str, paper_id: str, kind: str) -> FileResponse:
    img_path = resolve_paper_image_path(folder_dir(_ws_root(), folder), quiz_id, paper_id, kind)
    media_type = "image/png" if img_path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(
        path=img_path,
        media_type=media_type,
        headers={"Cache-Control": "no-store"},
    )
