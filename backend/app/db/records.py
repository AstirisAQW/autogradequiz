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
    """The fields save_scan_result writes on insert and on update.

    Deliberately has no error_message: that column exists in scan_results but is
    reserved for a later phase (see schema.sql and ScanResultRecord.error_message) until
    there's a real grading-failure pipeline to decide what belongs in it.
    """

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
    """A stored scan result, as read back from scan_results.

    error_message: reserved for a later phase. save_scan_result never sets it, so this
        is always ''.
    """

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

