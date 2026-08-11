from app.grading.exceptions import UnknownTemplateError
from app.grading.template_spec import ColumnSpecMm, TemplateSpec

TWENTY_QUESTIONS = TemplateSpec(
    template_id="20q_a4",
    question_count=20,
    columns=(
        ColumnSpecMm(origin_x_mm=30, origin_y_mm=55, question_start=1, question_end=10),
        ColumnSpecMm(origin_x_mm=115, origin_y_mm=55, question_start=11, question_end=20),
    ),
    mid_marker_positions_mm=(),
)

STACK_TOP_Y_MM = 55.0
STACK_BOTTOM_Y_MM = 145.0
MID_MARKER_Y_MM = 123.0

FIFTY_QUESTIONS = TemplateSpec(
    template_id="50q_a4",
    question_count=50,
    columns=(
        ColumnSpecMm(origin_x_mm=22, origin_y_mm=STACK_TOP_Y_MM, question_start=1, question_end=10),
        ColumnSpecMm(origin_x_mm=22, origin_y_mm=STACK_BOTTOM_Y_MM, question_start=11, question_end=20),
        ColumnSpecMm(origin_x_mm=72, origin_y_mm=STACK_TOP_Y_MM, question_start=21, question_end=30),
        ColumnSpecMm(origin_x_mm=72, origin_y_mm=STACK_BOTTOM_Y_MM, question_start=31, question_end=40),
        ColumnSpecMm(origin_x_mm=122, origin_y_mm=STACK_TOP_Y_MM, question_start=41, question_end=50),
    ),
    mid_marker_positions_mm=((55, MID_MARKER_Y_MM), (105, MID_MARKER_Y_MM), (155, MID_MARKER_Y_MM)),
)

HUNDRED_QUESTIONS = TemplateSpec(
    template_id="100q_a4",
    question_count=100,
    columns=(
        ColumnSpecMm(origin_x_mm=18, origin_y_mm=STACK_TOP_Y_MM, question_start=1, question_end=10),
        ColumnSpecMm(origin_x_mm=18, origin_y_mm=STACK_BOTTOM_Y_MM, question_start=11, question_end=20),
        ColumnSpecMm(origin_x_mm=58, origin_y_mm=STACK_TOP_Y_MM, question_start=21, question_end=30),
        ColumnSpecMm(origin_x_mm=58, origin_y_mm=STACK_BOTTOM_Y_MM, question_start=31, question_end=40),
        ColumnSpecMm(origin_x_mm=98, origin_y_mm=STACK_TOP_Y_MM, question_start=41, question_end=50),
        ColumnSpecMm(origin_x_mm=98, origin_y_mm=STACK_BOTTOM_Y_MM, question_start=51, question_end=60),
        ColumnSpecMm(origin_x_mm=138, origin_y_mm=STACK_TOP_Y_MM, question_start=61, question_end=70),
        ColumnSpecMm(origin_x_mm=138, origin_y_mm=STACK_BOTTOM_Y_MM, question_start=71, question_end=80),
        ColumnSpecMm(origin_x_mm=178, origin_y_mm=STACK_TOP_Y_MM, question_start=81, question_end=90),
        ColumnSpecMm(origin_x_mm=178, origin_y_mm=STACK_BOTTOM_Y_MM, question_start=91, question_end=100),
    ),
    mid_marker_positions_mm=(
        (40, MID_MARKER_Y_MM),
        (90, MID_MARKER_Y_MM),
        (140, MID_MARKER_Y_MM),
        (190, MID_MARKER_Y_MM),
    ),
)

TEMPLATE_CATALOG: dict[str, TemplateSpec] = {
    TWENTY_QUESTIONS.template_id: TWENTY_QUESTIONS,
    FIFTY_QUESTIONS.template_id: FIFTY_QUESTIONS,
    HUNDRED_QUESTIONS.template_id: HUNDRED_QUESTIONS,
}


def get_template_spec(template_id: str) -> TemplateSpec:
    """Return the spec for one template id, or raise UnknownTemplateError."""
    if template_id not in TEMPLATE_CATALOG:
        raise UnknownTemplateError(template_id)
    return TEMPLATE_CATALOG[template_id]


def list_template_specs() -> list[TemplateSpec]:
    """Return every template spec in the catalog."""
    return list(TEMPLATE_CATALOG.values())