from app.grading.exceptions import UnknownTemplateError
from app.grading.template_spec import ColumnSpecMm, TemplateSpec

TWENTY_QUESTIONS = TemplateSpec(
    template_id="20q_a4",
    question_count=20,
    bubble_radius_mm=3.0,
    choice_spacing_mm=9.0,
    row_spacing_mm=10.0,
    font_size_pt=14.0,
    columns=(
        ColumnSpecMm(40, 60.0, 1, 10),
        ColumnSpecMm(120, 60.0, 11, 20),
    ),
    mid_marker_positions_mm=((6.0, 148.5), (196.0, 148.5)),
)

FIFTY_QUESTIONS = TemplateSpec(
    template_id="50q_a4",
    question_count=50,
    bubble_radius_mm=2.4,
    choice_spacing_mm=7.0,
    row_spacing_mm=8.0,
    font_size_pt=10.0,
    columns=(
        ColumnSpecMm(25, 60.0, 1, 20),
        ColumnSpecMm(85, 60.0, 21, 40),
        ColumnSpecMm(145, 60.0, 41, 50),
    ),
    mid_marker_positions_mm=((6.0, 100.0), (196.0, 100.0)),
)

HUNDRED_QUESTIONS = TemplateSpec(
    template_id="100q_a4",
    question_count=100,
    bubble_radius_mm=1.6,
    choice_spacing_mm=5.5,
    row_spacing_mm=6.5,
    font_size_pt=8.0,
    columns=(
        ColumnSpecMm(26, 60.0, 1, 20),
        ColumnSpecMm(61, 60.0, 21, 40),
        ColumnSpecMm(96, 60.0, 41, 60),
        ColumnSpecMm(131, 60.0, 61, 80),
        ColumnSpecMm(166, 60.0, 81, 100),
    ),
    mid_marker_positions_mm=(
        (6.0, 100.0),
        (196.0, 100.0),
        (6.0, 190.0),
        (196.0, 190.0),
    ),
)

TEMPLATE_CATALOG: dict[str, TemplateSpec] = {
    TWENTY_QUESTIONS.template_id: TWENTY_QUESTIONS,
    FIFTY_QUESTIONS.template_id: FIFTY_QUESTIONS,
    HUNDRED_QUESTIONS.template_id: HUNDRED_QUESTIONS,
}


def get_template_spec(template_id: str) -> TemplateSpec:
    if template_id not in TEMPLATE_CATALOG:
        raise UnknownTemplateError(template_id)
    return TEMPLATE_CATALOG[template_id]


def list_template_specs() -> list[TemplateSpec]:
    return list(TEMPLATE_CATALOG.values())