import json
from pathlib import Path

import cv2
from PIL import Image

from app.answer_sheet_templates.builder import build_template
from app.answer_sheet_templates.catalog import list_template_specs
from app.answer_sheet_templates.json_export import template_to_json_dict
from app.answer_sheet_templates.layout_spec import TemplateSpec
from app.config import get_settings
from app.sheet_rendering.renderer import render_sheet


def templates_output_dir() -> Path:
    settings = get_settings()
    return Path(settings.autograde_data_dir) / "templates"


def write_template_files(template_spec: TemplateSpec, output_root: Path) -> None:
    output_dir = output_root / template_spec.template_id
    output_dir.mkdir(parents=True, exist_ok=True)

    template = build_template(template_spec)
    json_filename = f"autograde{template_spec.question_count}Questions_template.json"
    json_path = output_dir / json_filename

    old_json = output_dir / "template.json"
    if old_json.exists():
        old_json.unlink()

    json_path.write_text(json.dumps(template_to_json_dict(template), indent=2), encoding="utf-8")

    sheet = render_sheet(template_spec)
    image_filename = f"autograde{template_spec.question_count}Questions.png"
    sheet_path = output_dir / image_filename

    old_sheet = output_dir / "sheet.png"
    if old_sheet.exists():
        old_sheet.unlink()

    cv2.imwrite(str(sheet_path), sheet)

    pdf_filename = f"autograde{template_spec.question_count}Questions.pdf"
    pdf_path = output_dir / pdf_filename

    old_pdf = output_dir / "sheet.pdf"
    if old_pdf.exists():
        old_pdf.unlink()

    rgb_sheet = cv2.cvtColor(sheet, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(rgb_sheet)
    pil_image.save(str(pdf_path), "PDF", resolution=300.0)

    print(f"Wrote {json_path}")
    print(f"Wrote {sheet_path}")
    print(f"Wrote {pdf_path}")


def main() -> None:
    output_root = templates_output_dir()
    for template_spec in list_template_specs():
        write_template_files(template_spec, output_root)


if __name__ == "__main__":
    main()

