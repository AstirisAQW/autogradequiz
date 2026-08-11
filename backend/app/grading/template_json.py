from app.grading.template_schema import AnswerColumn, Point, Template, TextFieldSpec

JSON_DECIMAL_PLACES = 6


def round_fraction(value: float) -> float:
    return round(value, JSON_DECIMAL_PLACES)


def point_to_dict(marker_id: str, point: Point) -> dict:
    return {"id": marker_id, "x": round_fraction(point.x), "y": round_fraction(point.y)}


def text_field_to_dict(field: TextFieldSpec) -> dict:
    return {
        "id": field.id,
        "x": round_fraction(field.x),
        "y": round_fraction(field.y),
        "width": round_fraction(field.width),
        "height": round_fraction(field.height),
    }


def column_to_dict(column: AnswerColumn) -> dict:
    return {
        "origin_x": round_fraction(column.origin_x),
        "origin_y": round_fraction(column.origin_y),
        "question_start": column.question_start,
        "question_end": column.question_end,
    }


def template_to_json_dict(template: Template) -> dict:
    """Return the template.json-shaped dict for one built Template."""
    corners = [
        point_to_dict(marker_id, point) for marker_id, point in template.corner_fiducials.items()
    ]
    mid_markers = [
        point_to_dict(f"mid_{index}", point) for index, point in enumerate(template.mid_markers)
    ]
    return {
        "template_id": template.template_id,
        "page": {
            "width_mm": template.page.width_mm,
            "height_mm": template.page.height_mm,
            "dpi": template.page.dpi,
        },
        "fiducials": {"corners": corners, "mid_markers": mid_markers},
        "text_fields": [text_field_to_dict(field) for field in template.text_fields],
        "answer_grid": {
            "question_count": template.answer_grid.question_count,
            "choices": template.answer_grid.choices,
            "columns": [column_to_dict(column) for column in template.answer_grid.columns],
            "row_spacing": round_fraction(template.answer_grid.row_spacing),
            "choice_spacing": round_fraction(template.answer_grid.choice_spacing),
            "bubble_radius": round_fraction(template.answer_grid.bubble_radius),
        },
    }