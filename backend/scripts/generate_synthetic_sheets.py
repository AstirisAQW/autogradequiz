"""Write synthetic sample sheets to disk for local inspection.

Nothing in the pipeline writes these files automatically -- generate_synthetic_sheet()
returns an in-memory image, and the pytest suite only ever saves ground truth JSON into a
throwaway tmp_path that pytest deletes after the run. Run this script directly to get real
files on disk: one PNG (and, with --pdf, one PDF) per sheet, plus the seed and answer key
as JSON, so you can open a sheet and see what the generator actually drew.

Usage:
    python scripts/generate_synthetic_sheets.py
    python scripts/generate_synthetic_sheets.py --templates 20q_a4 --count 10 --pdf
    python scripts/generate_synthetic_sheets.py --start-seed 100 --count 3

Files land under <autograde_data_dir>/synthetic_sheets/<template_id>/seed_NNNN.{png,json[,pdf]}
"""

import argparse
from pathlib import Path

import cv2
from PIL import Image

from app.config import get_settings
from app.grading.synthetic_sheets import generate_synthetic_sheet, save_ground_truth
from app.grading.template_catalog import list_template_specs
from app.grading.template_spec import TemplateSpec


def synthetic_sheets_output_dir() -> Path:
    settings = get_settings()
    return Path(settings.autograde_data_dir) / "synthetic_sheets"


def write_synthetic_sheet_files(
    template_spec: TemplateSpec, seed: int, output_root: Path, write_pdf: bool
) -> None:
    output_dir = output_root / template_spec.template_id
    output_dir.mkdir(parents=True, exist_ok=True)

    sheet = generate_synthetic_sheet(template_spec, seed)
    stem = f"seed_{seed:04d}"

    image_path = output_dir / f"{stem}.png"
    cv2.imwrite(str(image_path), sheet.image)
    print(f"Wrote {image_path}")

    json_path = output_dir / f"{stem}.json"
    save_ground_truth(sheet, json_path)
    print(f"Wrote {json_path}")

    if write_pdf:
        pdf_path = output_dir / f"{stem}.pdf"
        rgb_sheet = cv2.cvtColor(sheet.image, cv2.COLOR_BGR2RGB)
        Image.fromarray(rgb_sheet).save(str(pdf_path), "PDF", resolution=300.0)
        print(f"Wrote {pdf_path}")


def resolve_template_specs(requested_ids: list[str] | None) -> list[TemplateSpec]:
    all_specs = {spec.template_id: spec for spec in list_template_specs()}
    if not requested_ids:
        return list(all_specs.values())

    unknown_ids = set(requested_ids) - set(all_specs)
    if unknown_ids:
        known = ", ".join(sorted(all_specs))
        unknown = ", ".join(sorted(unknown_ids))
        raise SystemExit(f"Unknown template id(s): {unknown}. Known: {known}")
    return [all_specs[template_id] for template_id in requested_ids]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--templates", nargs="*", default=None, help="Template ids to generate (default: all)."
    )
    parser.add_argument("--count", type=int, default=5, help="Number of sheets per template.")
    parser.add_argument(
        "--start-seed", type=int, default=0, help="First seed to use; seeds count up from here."
    )
    parser.add_argument("--pdf", action="store_true", help="Also write a PDF alongside the PNG.")
    args = parser.parse_args()

    template_specs = resolve_template_specs(args.templates)
    output_root = synthetic_sheets_output_dir()

    for template_spec in template_specs:
        for seed in range(args.start_seed, args.start_seed + args.count):
            write_synthetic_sheet_files(template_spec, seed, output_root, args.pdf)


if __name__ == "__main__":
    main()