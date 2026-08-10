from dataclasses import dataclass


@dataclass(frozen=True)
class NewTest:
    name: str
    template_id: str
    answer_key: list[str]


@dataclass(frozen=True)
class TestRecord:
    id: int
    name: str
    template_id: str
    answer_key: list[str]
    question_count: int
    created_at: str


@dataclass(frozen=True)
class NewBatch:
    test_id: int


@dataclass(frozen=True)
class BatchRecord:
    id: int
    test_id: int
    status: str
    created_at: str


@dataclass(frozen=True)
class NewScanJob:
    batch_id: int
    raw_image_path: str


@dataclass(frozen=True)
class ScanJobRecord:
    id: int
    batch_id: int
    raw_image_path: str
    status: str
    created_at: str


@dataclass(frozen=True)
class NewScanResult:
    scan_job_id: int
    name_text: str
    date_text: str
    section_text: str
    score: float
    answers_json: str
    flags_json: str
    needs_review: bool
    processed_image_path: str


@dataclass(frozen=True)
class ScanResultRecord:
    id: int
    scan_job_id: int
    name_text: str
    date_text: str
    section_text: str
    score: float
    answers_json: str
    flags_json: str
    needs_review: bool
    processed_image_path: str
    error_message: str
    created_at: str
