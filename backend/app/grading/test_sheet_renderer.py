from app.grading.sheet_renderer import mm_to_px, render_sheet
from app.grading.template_builder import PAGE
from app.grading.template_catalog import HUNDRED_QUESTIONS, TWENTY_QUESTIONS


def test_mm_to_px_scales_by_dpi():
    x_px, y_px = mm_to_px(25.4, 25.4, PAGE)

    assert x_px == PAGE.dpi
    assert y_px == PAGE.dpi


def test_render_sheet_produces_page_sized_canvas():
    canvas = render_sheet(TWENTY_QUESTIONS)
    width_px, height_px = mm_to_px(PAGE.width_mm, PAGE.height_mm, PAGE)

    assert canvas.shape == (height_px, width_px, 3)


def test_render_sheet_works_for_template_with_mid_markers():
    canvas = render_sheet(HUNDRED_QUESTIONS)

    assert canvas.min() < 255
