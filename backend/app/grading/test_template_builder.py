import pytest

from app.grading.exceptions import UnknownTemplateError
from app.grading.template_builder import build_template
from app.grading.template_catalog import (
    FIFTY_QUESTIONS,
    HUNDRED_QUESTIONS,
    TWENTY_QUESTIONS,
    get_template_spec,
    list_template_specs,
)
from app.grading.template_json import template_to_json_dict


def test_get_template_spec_returns_known_spec():
    spec = get_template_spec("20q_a4")

    assert spec.question_count == 20


def test_get_template_spec_raises_for_unknown_id():
    with pytest.raises(UnknownTemplateError):
        get_template_spec("999q_a4")


def test_list_template_specs_returns_all_three():
    specs = list_template_specs()

    assert {spec.template_id for spec in specs} == {"20q_a4", "50q_a4", "100q_a4"}


@pytest.mark.parametrize(
    "template_spec",
    [TWENTY_QUESTIONS, FIFTY_QUESTIONS, HUNDRED_QUESTIONS],
)
def test_columns_cover_every_question_exactly_once(template_spec):
    covered_questions = []
    for column in template_spec.columns:
        covered_questions.extend(range(column.question_start, column.question_end + 1))

    assert sorted(covered_questions) == list(range(1, template_spec.question_count + 1))


def test_twenty_question_template_has_mid_markers():
    template = build_template(TWENTY_QUESTIONS)

    assert len(template.mid_markers) == 2


def test_fifty_question_template_has_mid_markers():
    template = build_template(FIFTY_QUESTIONS)

    assert len(template.mid_markers) == 2


def test_hundred_question_template_has_mid_markers():
    template = build_template(HUNDRED_QUESTIONS)

    assert len(template.mid_markers) == 4


def test_build_template_includes_all_four_corners():
    template = build_template(TWENTY_QUESTIONS)

    assert set(template.corner_fiducials.keys()) == {
        "top_left",
        "top_right",
        "bottom_left",
        "bottom_right",
    }


def test_build_template_includes_default_text_fields():
    template = build_template(TWENTY_QUESTIONS)

    field_ids = {field.id for field in template.text_fields}

    assert field_ids == {"name", "date", "section"}


def test_template_to_json_dict_round_trips_question_count():
    template = build_template(FIFTY_QUESTIONS)

    json_dict = template_to_json_dict(template)

    assert json_dict["answer_grid"]["question_count"] == 50
    assert len(json_dict["fiducials"]["corners"]) == 4
    assert len(json_dict["fiducials"]["mid_markers"]) == 2
    assert len(json_dict["text_fields"]) == 3
