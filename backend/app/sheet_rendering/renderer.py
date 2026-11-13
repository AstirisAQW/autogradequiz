"""Draws a blank answer sheet -- fiducials, text fields, and the answer bubble grid --
from a TemplateSpec.
"""

import cv2
import numpy as np

from app.answer_sheet_templates.builder import DEFAULT_TEXT_FIELDS, FIDUCIAL_MARGIN_MM, PAGE
from app.answer_sheet_templates.geometry import (
    ANSWER_CHOICES,
    BUBBLE_OUTLINE_THICKNESS_PX,
    FIDUCIAL_SIZE_MM,
    ROW_GROUP_SIZE,
    PageSize,
    mm_length_to_px,
    mm_to_px,
    row_position_mm,
)
from app.answer_sheet_templates.layout_spec import ColumnSpecMm, TemplateSpec, TextFieldSpecMm

BLACK = (0, 0, 0)
BUBBLE_GRAY = (180, 180, 180)

LABEL_ROW_OFFSET_MM = 5.0
BASE_HERSHEY_TOTAL_HEIGHT_PX = 27.0

ROW_GROUP_MARKER_SIZE_MM = 3.0


def font_pt_to_scale(font_size_pt: float, page: PageSize) -> float:
    """Convert font size in points to OpenCV Hershey Simplex font scale."""
    font_height_px = (font_size_pt / 72.0) * page.dpi
    return font_height_px / BASE_HERSHEY_TOTAL_HEIGHT_PX


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
    font_scale = font_pt_to_scale(10.0, page)
    label_position = mm_to_px(field.x_mm, field.y_mm - 1.5, page)

    cv2.putText(canvas, field.label, label_position, cv2.FONT_HERSHEY_SIMPLEX, font_scale, BLACK, 2)
    cv2.rectangle(canvas, top_left, bottom_right, BLACK, 2)


def draw_bubble(
    canvas: np.ndarray, center_x_mm: float, center_y_mm: float, radius_mm: float, page: PageSize
) -> None:
    center = mm_to_px(center_x_mm, center_y_mm, page)
    radius_px = mm_length_to_px(radius_mm, page)
    cv2.circle(canvas, center, radius_px, BUBBLE_GRAY, BUBBLE_OUTLINE_THICKNESS_PX)


def draw_column_header(
    canvas: np.ndarray,
    column: ColumnSpecMm,
    choice_spacing_mm: float,
    font_size_pt: float,
    page: PageSize,
) -> None:
    header_y_mm = column.origin_y_mm - LABEL_ROW_OFFSET_MM
    font_scale = font_pt_to_scale(font_size_pt, page)
    _, header_y_px = mm_to_px(0, header_y_mm, page)

    for choice_index, choice in enumerate(ANSWER_CHOICES):
        choice_x_mm = column.origin_x_mm + choice_index * choice_spacing_mm
        choice_x_px, _ = mm_to_px(choice_x_mm, 0, page)
        text_size, _ = cv2.getTextSize(choice, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 2)
        label_x_px = choice_x_px - text_size[0] // 2
        cv2.putText(
            canvas,
            choice,
            (label_x_px, header_y_px),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            BLACK,
            2,
        )


def draw_row_group_marker(canvas: np.ndarray, x_mm: float, y_mm: float, page: PageSize) -> None:
    half_size = ROW_GROUP_MARKER_SIZE_MM / 2
    top_left = mm_to_px(x_mm - half_size, y_mm - half_size, page)
    bottom_right = mm_to_px(x_mm + half_size, y_mm + half_size, page)
    cv2.rectangle(canvas, top_left, bottom_right, BLACK, -1)


def row_group_boundary_count(columns: tuple[ColumnSpecMm, ...]) -> int:
    longest_column_question_count = max(
        column.question_end - column.question_start + 1 for column in columns
    )
    return (longest_column_question_count - 1) // ROW_GROUP_SIZE


def draw_row_group_markers(
    canvas: np.ndarray, columns: tuple[ColumnSpecMm, ...], row_spacing_mm: float, page: PageSize
) -> None:
    reference_column = columns[0]
    left_marker_x_mm = FIDUCIAL_MARGIN_MM + FIDUCIAL_SIZE_MM / 2
    right_marker_x_mm = page.width_mm - FIDUCIAL_MARGIN_MM - FIDUCIAL_SIZE_MM / 2

    for boundary_index in range(1, row_group_boundary_count(columns) + 1):
        last_row_of_group = boundary_index * ROW_GROUP_SIZE - 1
        first_row_of_next_group = boundary_index * ROW_GROUP_SIZE
        y_before_mm = row_position_mm(reference_column, last_row_of_group, row_spacing_mm)
        y_after_mm = row_position_mm(reference_column, first_row_of_next_group, row_spacing_mm)
        boundary_y_mm = (y_before_mm + y_after_mm) / 2

        draw_row_group_marker(canvas, left_marker_x_mm, boundary_y_mm, page)
        draw_row_group_marker(canvas, right_marker_x_mm, boundary_y_mm, page)


def draw_question_row(
    canvas: np.ndarray,
    column: ColumnSpecMm,
    question_number: int,
    row_y_mm: float,
    template_spec: TemplateSpec,
    page: PageSize,
) -> None:
    font_scale = font_pt_to_scale(template_spec.font_size_pt, page)
    number_str = str(question_number)
    text_size, _ = cv2.getTextSize(number_str, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 2)

    origin_x_px, row_y_px = mm_to_px(column.origin_x_mm, row_y_mm, page)
    gap_px = int(3.0 / 25.4 * page.dpi)
    number_x_px = origin_x_px - gap_px - text_size[0]
    number_y_px = row_y_px + text_size[1] // 2

    cv2.putText(
        canvas,
        number_str,
        (number_x_px, number_y_px),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale,
        BLACK,
        2,
    )

    for choice_index in range(len(ANSWER_CHOICES)):
        choice_x_mm = column.origin_x_mm + choice_index * template_spec.choice_spacing_mm
        draw_bubble(canvas, choice_x_mm, row_y_mm, template_spec.bubble_radius_mm, page)


def draw_answer_column(
    canvas: np.ndarray, column: ColumnSpecMm, template_spec: TemplateSpec, page: PageSize
) -> None:
    draw_column_header(
        canvas, column, template_spec.choice_spacing_mm, template_spec.font_size_pt, page
    )
    question_count = column.question_end - column.question_start + 1
    for row_index in range(question_count):
        question_number = column.question_start + row_index
        row_y_mm = row_position_mm(column, row_index, template_spec.row_spacing_mm)
        draw_question_row(canvas, column, question_number, row_y_mm, template_spec, page)


def draw_title(canvas: np.ndarray, question_count: int, page: PageSize) -> None:
    title_position = mm_to_px(20, 13, page)
    font_scale = font_pt_to_scale(14.0, page)
    title = f"AutoGradeQuiz - {question_count} questions"
    cv2.putText(canvas, title, title_position, cv2.FONT_HERSHEY_SIMPLEX, font_scale, BLACK, 2)


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
        draw_answer_column(canvas, column, template_spec, page)

    draw_row_group_markers(canvas, template_spec.columns, template_spec.row_spacing_mm, page)

    return canvas
