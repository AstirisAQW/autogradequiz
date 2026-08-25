from dataclasses import dataclass

FIDUCIAL_SIZE_MM = 8.0
ANSWER_CHOICES = ("A", "B", "C", "D", "E")


@dataclass(frozen=True)
class PageSize:
    width_mm: float
    height_mm: float
    dpi: int


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class TextFieldSpec:
    id: str
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class AnswerColumn:
    origin_x: float
    origin_y: float
    question_start: int
    question_end: int


@dataclass(frozen=True)
class AnswerGrid:
    question_count: int
    choices: list[str]
    columns: list[AnswerColumn]
    row_spacing: float
    choice_spacing: float
    bubble_radius: float


@dataclass(frozen=True)
class Template:
    template_id: str
    page: PageSize
    corner_fiducials: dict[str, Point]
    mid_markers: list[Point]
    text_fields: list[TextFieldSpec]
    answer_grid: AnswerGrid