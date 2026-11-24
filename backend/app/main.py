from __future__ import annotations

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.answer_sheet_templates.exceptions import UnknownTemplateError
from app.grading_pipeline.exceptions import InvalidAnswerKeyError, ScanImageUnreadableError
from app.scan_alignment.aligner import ScanAlignmentError
from app.stateless_router import stateless_router
from app.workspace_router import workspace_router
from app.workspace_store import (
    FolderExistsError,
    FolderNameError,
    FolderNotFoundError,
    ResourceConflictError,
    ResourceNotFoundError,
    ResourceValidationError,
)

app = FastAPI(title="AutoGradeQuiz Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(InvalidAnswerKeyError)
@app.exception_handler(UnknownTemplateError)
@app.exception_handler(ScanImageUnreadableError)
@app.exception_handler(ScanAlignmentError)
@app.exception_handler(FolderNameError)
@app.exception_handler(ResourceValidationError)
def handle_unprocessable(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(FolderExistsError)
@app.exception_handler(ResourceConflictError)
def handle_conflict(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(FolderNotFoundError)
@app.exception_handler(ResourceNotFoundError)
def handle_not_found(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


app.include_router(stateless_router)
app.include_router(workspace_router)


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
