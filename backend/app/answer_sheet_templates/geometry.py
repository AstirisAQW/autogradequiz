"""The fraction-of-page geometry a built Template is made of.

Every position here is a fraction of the page (0.0-1.0 on each axis), not millimeters --
see layout_spec.py for the millimeter-based specs these are built from, and builder.py
for the conversion between the two.
"""

from dataclasses import dataclass

from app.answer_sheet_templates.layout_spec import ColumnSpecMm, TemplateSpec

FIDUCIAL_SIZE_MM = 8.0
ANSWER_CHOICES = ("A", "B", "C", "D", "E")
BUBBLE_OUTLINE_THICKNESS_PX = 2
ROW_GROUP_SIZE = 10
ROW_GROUP_GAP_MM = 5.0


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


def mm_to_px(x_mm: float, y_mm: float, page: PageSize) -> tuple[int, int]:
    x_px = int(x_mm / 25.4 * page.dpi)
    y_px = int(y_mm / 25.4 * page.dpi)
    return x_px, y_px


def mm_length_to_px(length_mm: float, page: PageSize) -> int:
    return int(length_mm / 25.4 * page.dpi)


def row_group_count(row_index: int) -> int:
    return row_index // ROW_GROUP_SIZE


def row_position_mm(column: ColumnSpecMm, row_index: int, row_spacing_mm: float) -> float:
    row_group_offset_mm = row_group_count(row_index) * ROW_GROUP_GAP_MM
    return column.origin_y_mm + row_index * row_spacing_mm + row_group_offset_mm


def find_column_for_question(
    columns: tuple[ColumnSpecMm, ...], question_number: int
) -> ColumnSpecMm:
    for column in columns:
        if column.question_start <= question_number <= column.question_end:
            return column
    raise ValueError(f"No column contains question {question_number}.")


def bubble_position_mm(
    template_spec: TemplateSpec, question_number: int, choice_index: int
) -> tuple[float, float]:
    """Return the (x_mm, y_mm) center of one answer bubble.

    Uses the same column lookup and row-group-gap math as draw_answer_column, so a bubble
    drawn on the rendered sheet and a bubble located for grading always agree.
    """
    column = find_column_for_question(template_spec.columns, question_number)
    row_index = question_number - column.question_start
    y_mm = row_position_mm(column, row_index, template_spec.row_spacing_mm)
    x_mm = column.origin_x_mm + choice_index * template_spec.choice_spacing_mm
    return x_mm, y_mm


def bubble_position_px(
    template_spec: TemplateSpec, question_number: int, choice_index: int, page: PageSize
) -> tuple[int, int]:
    x_mm, y_mm = bubble_position_mm(template_spec, question_number, choice_index)
    return mm_to_px(x_mm, y_mm, page)


def bubble_radius_px(template_spec: TemplateSpec, page: PageSize) -> int:
    return mm_length_to_px(template_spec.bubble_radius_mm, page)

