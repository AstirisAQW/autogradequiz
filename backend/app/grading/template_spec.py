from dataclasses import dataclass


@dataclass(frozen=True)
class ColumnSpecMm:
    origin_x_mm: float
    origin_y_mm: float
    question_start: int
    question_end: int


@dataclass(frozen=True)
class TemplateSpec:
    template_id: str
    question_count: int
    columns: tuple[ColumnSpecMm, ...]
    mid_marker_positions_mm: tuple[tuple[float, float], ...]


@dataclass(frozen=True)
class TextFieldSpecMm:
    id: str
    label: str
    x_mm: float
    y_mm: float
    width_mm: float
    height_mm: float