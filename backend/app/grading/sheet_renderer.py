import cv2
import numpy as np

from app.grading.template_builder import DEFAULT_TEXT_FIELDS, FIDUCIAL_MARGIN_MM, PAGE
from app.grading.template_schema import PageSize
from app.grading.template_spec import ColumnSpecMm, TemplateSpec, TextFieldSpecMm

BLACK = (0, 0, 0)  # OpenCV colors are BGR, not RGB.
BUBBLE_GRAY = (180, 180, 180)

BUBBLE_RADIUS_MM = 2.5
CHOICE_SPACING_MM = 7.0
ROW_SPACING_MM = 7.0
FIDUCIAL_SIZE_MM = 8.0
LABEL_ROW_OFFSET_MM = 6.0
QUESTION_NUMBER_OFFSET_MM = 8.0
ANSWER_CHOICES = ("A", "B", "C", "D", "E")


def mm_to_px(x_mm: float, y_mm: float, page: PageSize) -> tuple[int, int]:
    x_px = int(x_mm / 25.4 * page.dpi)
    y_px = int(y_mm / 25.4 * page.dpi)
    return x_px, y_px


def blank_canvas(page: PageSize) -> np.ndarray:
    width_px, height_px = mm_to_px(page.width_mm, page.height_mm, page)
    return np.full((height_px, width_px, 3), 255, dtype=np.uint8)


def draw_fiducial(canvas: np.ndarray, x_mm: float, y_mm: float, page: PageSize) -> None:
    top_left = mm_to_px(x_mm, y_mm, page)
    bottom_right = mm_to_px(x_mm + FIDUCIAL_SIZE_MM, y_mm + FIDUCIAL_SIZE_MM, page)
    cv2.rectangle(canvas, top_left, bottom_right, BLACK, -1)


def draw_corner_fiducials(canvas: np.ndarray, page: PageSize) -> None:
    margin = FIDUCIAL_MARGIN_MM
    size = FIDUCIAL_SIZE_MM
    draw_fiducial(canvas, margin, margin, page)
    draw_fiducial(canvas, page.width_mm - margin - size, margin, page)
    draw_fiducial(canvas, margin, page.height_mm - margin - size, page)
    draw_fiducial(canvas, page.width_mm - margin - size, page.height_mm - margin - size, page)


def draw_mid_markers(
    canvas: np.ndarray, positions_mm: tuple[tuple[float, float], ...], page: PageSize
) -> None:
    for x_mm, y_mm in positions_mm:
        draw_fiducial(canvas, x_mm, y_mm, page)


def draw_text_field(canvas: np.ndarray, field: TextFieldSpecMm, page: PageSize) -> None:
    top_left = mm_to_px(field.x_mm, field.y_mm, page)
    bottom_right = mm_to_px(field.x_mm + field.width_mm, field.y_mm + field.height_mm, page)
    label_position = mm_to_px(field.x_mm, field.y_mm - 2, page)

    cv2.putText(canvas, field.label, label_position, cv2.FONT_HERSHEY_SIMPLEX, 0.55, BLACK, 1)
    cv2.rectangle(canvas, top_left, bottom_right, BLACK, 2)


def draw_bubble(canvas: np.ndarray, center_x_mm: float, center_y_mm: float, page: PageSize) -> None:
    center = mm_to_px(center_x_mm, center_y_mm, page)
    radius_px = int(BUBBLE_RADIUS_MM / 25.4 * page.dpi)
    cv2.circle(canvas, center, radius_px, BUBBLE_GRAY, 2)


def draw_column_header(canvas: np.ndarray, column: ColumnSpecMm, page: PageSize) -> None:
    header_y_mm = column.origin_y_mm - LABEL_ROW_OFFSET_MM
    for choice_index, choice in enumerate(ANSWER_CHOICES):
        choice_x_mm = column.origin_x_mm + choice_index * CHOICE_SPACING_MM
        label_position = mm_to_px(choice_x_mm - 1.5, header_y_mm, page)
        cv2.putText(canvas, choice, label_position, cv2.FONT_HERSHEY_SIMPLEX, 0.45, BLACK, 1)


def draw_question_row(
    canvas: np.ndarray, column: ColumnSpecMm, question_number: int, row_y_mm: float, page: PageSize
) -> None:
    number_position = mm_to_px(column.origin_x_mm - QUESTION_NUMBER_OFFSET_MM, row_y_mm + 1, page)
    cv2.putText(canvas, str(question_number), number_position, cv2.FONT_HERSHEY_SIMPLEX, 0.45, BLACK, 1)
    for choice_index in range(len(ANSWER_CHOICES)):
        choice_x_mm = column.origin_x_mm + choice_index * CHOICE_SPACING_MM
        draw_bubble(canvas, choice_x_mm, row_y_mm, page)


def draw_answer_column(canvas: np.ndarray, column: ColumnSpecMm, page: PageSize) -> None:
    draw_column_header(canvas, column, page)
    question_count = column.question_end - column.question_start + 1
    for row_index in range(question_count):
        question_number = column.question_start + row_index
        row_y_mm = column.origin_y_mm + row_index * ROW_SPACING_MM
        draw_question_row(canvas, column, question_number, row_y_mm, page)


def draw_title(canvas: np.ndarray, question_count: int, page: PageSize) -> None:
    title_position = mm_to_px(20, 8, page)
    title = f"AutoGradeQuiz - {question_count} questions"
    cv2.putText(canvas, title, title_position, cv2.FONT_HERSHEY_SIMPLEX, 0.8, BLACK, 2)


def render_sheet(
    template_spec: TemplateSpec,
    text_field_specs: tuple[TextFieldSpecMm, ...] = DEFAULT_TEXT_FIELDS,
    page: PageSize = PAGE,
) -> np.ndarray:
    canvas = blank_canvas(page)
    draw_corner_fiducials(canvas, page)
    draw_mid_markers(canvas, template_spec.mid_marker_positions_mm, page)

    for field in text_field_specs:
        draw_text_field(canvas, field, page)

    draw_title(canvas, template_spec.question_count, page)

    for column in template_spec.columns:
        draw_answer_column(canvas, column, page)

    return canvas