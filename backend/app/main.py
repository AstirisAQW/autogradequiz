from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.answer_sheet_templates.exceptions import UnknownTemplateError
from app.db.connection import init_db
from app.db.exceptions import (
    BatchNotFoundError,
    InvalidCorrectionError,
    InvalidTestError,
    ScanJobNotFoundError,
    ScanResultNotFoundError,
    TestNotFoundError,
)
from app.grading_pipeline.exceptions import (
    ScanImageUnreadableError,
    ScanJobAlreadyGradedError,
)
from app.routers import batches_router, review_router, scans_router, tests_router
from app.scan_alignment.align_scan import ScanAlignmentError


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(title="AutoGradeQuiz Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "tauri://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(TestNotFoundError)
@app.exception_handler(BatchNotFoundError)
@app.exception_handler(ScanJobNotFoundError)
@app.exception_handler(ScanResultNotFoundError)
def handle_not_found(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ScanJobAlreadyGradedError)
def handle_conflict(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(InvalidTestError)
@app.exception_handler(InvalidCorrectionError)
@app.exception_handler(UnknownTemplateError)
@app.exception_handler(ScanImageUnreadableError)
@app.exception_handler(ScanAlignmentError)
def handle_unprocessable(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


app.include_router(tests_router)
app.include_router(batches_router)
app.include_router(scans_router)
app.include_router(review_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
