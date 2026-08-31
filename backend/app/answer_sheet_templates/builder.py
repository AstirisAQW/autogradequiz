"""Converts a millimeter-based TemplateSpec into a fraction-of-page Template."""

from app.answer_sheet_templates.geometry import (
    ANSWER_CHOICES,
    FIDUCIAL_SIZE_MM,
    AnswerColumn,
    AnswerGrid,
    PageSize,
    Point,
    Template,
    TextFieldSpec,
)
from app.answer_sheet_templates.layout_spec import ColumnSpecMm, TemplateSpec, TextFieldSpecMm

PAGE = PageSize(width_mm=210.0, height_mm=297.0, dpi=300)

FIDUCIAL_MARGIN_MM = 6.0
BUBBLE_RADIUS_MM = 2.5
ROW_SPACING_MM = 7.0
CHOICE_SPACING_MM = 7.0

DEFAULT_TEXT_FIELDS: tuple[TextFieldSpecMm, ...] = (
    TextFieldSpecMm(id="name", label="Name", x_mm=20, y_mm=18, width_mm=90, height_mm=10),
    TextFieldSpecMm(id="date", label="Date", x_mm=130, y_mm=18, width_mm=55, height_mm=10),
    TextFieldSpecMm(id="section", label="Section", x_mm=20, y_mm=32, width_mm=60, height_mm=10),
)


def mm_to_fraction(x_mm: float, y_mm: float, page: PageSize) -> Point:
    return Point(x=x_mm / page.width_mm, y=y_mm / page.height_mm)


def build_corner_fiducials(page: PageSize) -> dict[str, Point]:
    margin = FIDUCIAL_MARGIN_MM
    size = FIDUCIAL_SIZE_MM
    return {
        "top_left": mm_to_fraction(margin, margin, page),
        "top_right": mm_to_fraction(page.width_mm - margin - size, margin, page),
        "bottom_left": mm_to_fraction(margin, page.height_mm - margin - size, page),
        "bottom_right": mm_to_fraction(
            page.width_mm - margin - size, page.height_mm - margin - size, page
        ),
    }


def build_mid_markers(
    mid_marker_positions_mm: tuple[tuple[float, float], ...], page: PageSize
) -> list[Point]:
    return [mm_to_fraction(x_mm, y_mm, page) for x_mm, y_mm in mid_marker_positions_mm]


def build_text_field(field_spec: TextFieldSpecMm, page: PageSize) -> TextFieldSpec:
    origin = mm_to_fraction(field_spec.x_mm, field_spec.y_mm, page)
    return TextFieldSpec(
        id=field_spec.id,
        x=origin.x,
        y=origin.y,
        width=field_spec.width_mm / page.width_mm,
        height=field_spec.height_mm / page.height_mm,
    )


def build_text_fields(
    field_specs: tuple[TextFieldSpecMm, ...], page: PageSize
) -> list[TextFieldSpec]:
    return [build_text_field(field_spec, page) for field_spec in field_specs]


def build_answer_column(column_spec: ColumnSpecMm, page: PageSize) -> AnswerColumn:
    origin = mm_to_fraction(column_spec.origin_x_mm, column_spec.origin_y_mm, page)
    return AnswerColumn(
        origin_x=origin.x,
        origin_y=origin.y,
        question_start=column_spec.question_start,
        question_end=column_spec.question_end,
    )


def build_answer_grid(template_spec: TemplateSpec, page: PageSize) -> AnswerGrid:
    columns = [build_answer_column(column, page) for column in template_spec.columns]
    return AnswerGrid(
        question_count=template_spec.question_count,
        choices=list(ANSWER_CHOICES),
        columns=columns,
        row_spacing=template_spec.row_spacing_mm / page.height_mm,
        choice_spacing=template_spec.choice_spacing_mm / page.width_mm,
        bubble_radius=template_spec.bubble_radius_mm / page.width_mm,
    )


def build_template(
    template_spec: TemplateSpec,
    text_field_specs: tuple[TextFieldSpecMm, ...] = DEFAULT_TEXT_FIELDS,
    page: PageSize = PAGE,
) -> Template:
    return Template(
        template_id=template_spec.template_id,
        page=page,
        corner_fiducials=build_corner_fiducials(page),
        mid_markers=build_mid_markers(template_spec.mid_marker_positions_mm, page),
        text_fields=build_text_fields(text_field_specs, page),
        answer_grid=build_answer_grid(template_spec, page),
    )
