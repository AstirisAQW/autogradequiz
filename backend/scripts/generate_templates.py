import json
from pathlib import Path

import cv2

from app.config import get_settings
from app.grading.sheet_renderer import render_sheet
from app.grading.template_builder import build_template
from app.grading.template_catalog import list_template_specs
from app.grading.template_json import template_to_json_dict
from app.grading.template_spec import TemplateSpec


def templates_output_dir() -> Path:
    settings = get_settings()
    return Path(settings.autograde_data_dir) / "templates"


def write_template_files(template_spec: TemplateSpec, output_root: Path) -> None:
    output_dir = output_root / template_spec.template_id
    output_dir.mkdir(parents=True, exist_ok=True)

    template = build_template(template_spec)
    json_path = output_dir / "template.json"
    json_path.write_text(json.dumps(template_to_json_dict(template), indent=2), encoding="utf-8")

    sheet = render_sheet(template_spec)
    sheet_path = output_dir / "sheet.png"
    cv2.imwrite(str(sheet_path), sheet)

    print(f"Wrote {json_path}")
    print(f"Wrote {sheet_path}")


def main() -> None:
    output_root = templates_output_dir()
    for template_spec in list_template_specs():
        write_template_files(template_spec, output_root)


if __name__ == "__main__":
    main()
