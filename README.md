# AutoGradeQuiz

AutoGradeQuiz grades scanned bubble-sheet quizzes. A test is defined against one of a
fixed set of question-count templates (20/50/100 questions); a batch of student sheets
is scanned; each scan is classified bubble-by-bubble and scored against the test's
answer key.

The repo has two parts:

- `backend/` -- a FastAPI service and the grading logic. See below.
- `frontend/` -- a Next.js UI, wrapped for desktop with Tauri (`src-tauri/`).

## Backend layout

Each folder under `backend/app/` owns exactly one responsibility, so the name alone
tells you what's in it and where new code for that concern belongs:

```
backend/app/
├── answer_sheet_templates/   Defines the 20/50/100-question templates: their
│                             millimeter layout (layout_spec.py), the fraction-of-page
│                             geometry built from it (geometry.py, builder.py), the
│                             fixed catalog of templates (catalog.py), and JSON export
│                             (json_export.py) for the frontend/desktop app.
├── sheet_rendering/          Draws a blank answer sheet -- fiducials, text fields,
│                             bubble grid -- from a template (renderer.py). Both the
│                             real print pipeline and the synthetic test-data generator
│                             render through this, so a bubble drawn here and a bubble
│                             graded by bubble_grading/ are always the same position.
├── bubble_grading/           Classifies a filled-in sheet image bubble by bubble
│                             (classifier.py) and scores the result against an answer
│                             key. Assumes the image is already aligned to its
│                             template's page dimensions.
├── synthetic_sheets/         Generates fake scanned sheets with known ground truth,
│                             for testing bubble_grading without needing real scanned
│                             quizzes: question_plan.py picks what should happen on
│                             each question, mark_drawing.py and stray_marks.py draw
│                             it, scan_artifacts.py simulates scan/photo damage,
│                             generator.py ties it together, ground_truth.py
│                             serializes the answer key (never the image -- it's
│                             reproducible from its seed).
├── grading_pipeline/         Orchestrates one scan job end to end: load its image,
│                             classify it against its test's template, score it, and
│                             persist the result (grade_scan_job.py).
├── db/                       SQLite persistence: connection handling, the schema,
│                             typed records, and repository functions.
├── config.py                 App-wide settings (db path, data dir).
└── main.py                   FastAPI app.
```

`scripts/` holds one-off developer scripts (`generate_templates.py`,
`generate_synthetic_sheets.py`) that write real files to `data/` for local inspection --
nothing in the app or test suite writes there automatically.

### Data model (`db/schema.sql`)

`tests` (a template + answer key) → `batches` (a grading run of a test) → `scan_jobs`
(one uploaded sheet image) → `scan_results` (one scored, gradable outcome per scan job).

### The grading pipeline

`grading_pipeline.grade_scan_job.grade_scan_job(scan_job_id)` is the one function that
wires everything above together:

```
scan_job → load image → answer_sheet_templates (look up the test's template)
         → bubble_grading.classify_sheet → bubble_grading.score_sheet
         → db.save_scan_result → db.update_scan_job_status("done")
```

It flags a scan for human review whenever any question comes back ambiguous or
multiply-marked, rather than guessing.

**Known gap:** it assumes `scan_job.raw_image_path` is already aligned to the
template's page dimensions. Detecting and correcting a real photo's rotation and
perspective from its fiducial markers -- so an arbitrary phone photo can be graded
directly -- is a separate step that doesn't exist yet.

**Also reserved for later:** `name_text`, `date_text`, and `section_text` on
`scan_results` are always written blank. Reading them from the scan is an OCR phase
that `config.tesseract_cmd` is reserved for; `pytesseract` is declared as a dependency
but isn't wired up to anything yet.

## Getting started

```bash
cd backend
pip install -e ".[dev]"

pytest app                       # run the full test suite
ruff check app scripts           # lint

python scripts/generate_templates.py             # write template PNG/PDF/JSON to data/
python scripts/generate_synthetic_sheets.py      # write synthetic test sheets to data/

uvicorn app.main:app --reload    # run the API
```

## Conventions

- No inline comments. Explain a piece of code by naming it well, extracting it into its
  own well-named function or module, or writing a docstring on its public entry point --
  not with a trailing `#` comment. A couple of module-level constants that need a short
  note use a plain string literal on the line below them instead (an "attribute
  docstring"), since a `#` comment isn't the only way to document a constant.
- Tests live next to the code they test (`test_*.py` alongside the module), not in a
  separate top-level test tree.
