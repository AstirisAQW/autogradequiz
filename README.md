# AutoGradeQuiz

AutoGradeQuiz grades multiple-choice answer sheets from scanned or photographed pages.
A teacher prints a sheet, students fill in the bubbles, and the app reads the answers,
scores them against an answer key, and lets the teacher fix doubtful answers before
exporting the results as CSV.

> **Status: work in progress.** The backend is built and tested on synthetic sheets only.
> It has not been calibrated on real scans yet, and there is no client app yet.

## How it works

1. **Template.** Three A4 sheet templates (20, 50 and 100 questions) are defined in
   millimeters and converted to page-fraction geometry. Each sheet has corner markers,
   Name / Date / Section boxes, and answer bubbles A to E.
2. **Alignment.** The scan is found by its four corner markers and warped to the template
   page size. A sheet rotated by 180 degrees is detected and turned the right way.
   A scan with fewer than four markers is rejected, never graded.
3. **Grading.** The fill ratio of each bubble is measured. Each question becomes one of
   `correct`, `wrong`, `blank`, `ambiguous` or `multiple`, and the sheet is scored.
4. **Identity.** Name, date and section are read with Tesseract OCR. If OCR fails, the
   fields stay empty and grading still completes.
5. **Review.** Sheets with ambiguous or multiple answers, or with every question blank,
   are flagged `needs_review`. A teacher corrects answers and identity fields by hand.
   Corrections are stored separately and the original answers are kept.
6. **Export.** Batch results download as CSV.

## Requirements

- Python 3.13 or newer
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) installed (needed only to
  read names, dates and sections). On Windows, install it and set `TESSERACT_CMD` to the
  full path of `tesseract.exe` if it is not on your `PATH`.

## Setup

From the repository root:

```
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux
pip install -e ".[dev]"
```

## Run the API

```
cd backend
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000/docs> for interactive API docs. Health check: `GET /health`.

The SQLite database and uploaded scans are stored under `backend/data/`.

### Settings

Set these as environment variables if you need to change the defaults.

| Variable             | Default                     | Purpose                                      |
| -------------------- | --------------------------- | -------------------------------------------- |
| `AUTOGRADE_DATA_DIR` | `backend/data`              | Where uploads and processed images are saved |
| `AUTOGRADE_DB_PATH`  | `backend/data/autograde.db` | SQLite database file                         |
| `TESSERACT_CMD`      | empty (uses `PATH`)         | Full path to the Tesseract program           |

## API overview

| Method | Path                               | What it does                                               |
| ------ | ---------------------------------- | ---------------------------------------------------------- |
| POST   | `/tests`                           | Create a test: name, `template_id`, answer key             |
| POST   | `/tests/{test_id}/batches`         | Create a batch of scans under a test                       |
| POST   | `/batches/{batch_id}/scans`        | Upload a PNG or JPEG scan (up to 10 MB)                    |
| POST   | `/scans/{scan_job_id}/grade`       | Grade a scan. Add `?force=true` to regrade a done scan     |
| GET    | `/batches/{batch_id}/results`      | List results, with job status and any error                |
| GET    | `/batches/{batch_id}/export.csv`   | Download results as CSV                                    |
| GET    | `/review-queue`                    | List scans that need review                                |
| PATCH  | `/scans/{scan_job_id}/corrections` | Correct answers, for example `{"corrections": {"1": "B"}}` |
| PATCH  | `/scans/{scan_job_id}/identity`    | Set name, date or section by hand                          |

Template ids: `20q_a4`, `50q_a4`, `100q_a4`. The answer key needs one letter from A to E
per question.

Error codes: `404` not found, `409` scan already graded, `422` invalid input or a scan
that cannot be aligned.

### Try it

1. `POST /tests` with `template_id` `20q_a4` and a 20-letter answer key.
2. `POST /tests/{id}/batches`.
3. `POST /batches/{id}/scans` with a sheet image.
4. `POST /scans/{id}/grade`.
5. `GET /batches/{id}/results`, then `GET /batches/{id}/export.csv`.

## Tests and lint

```
cd backend
pytest
ruff check .
```

## Generate sheets

Print templates (PNG, PDF and JSON) are written to `backend/data/templates/`:

```
cd backend
python scripts/generate_templates.py
```

Print them at 100% scale. Do not use "fit to page", because it changes the marker
geometry.

Synthetic filled-in sheets for testing are written to `backend/data/synthetic_sheets/`:

```
python scripts/generate_synthetic_sheets.py
python scripts/generate_synthetic_sheets.py --templates 20q_a4 --count 10 --pdf
python scripts/generate_synthetic_sheets.py --start-seed 100 --count 3
```

## Project layout

```
backend/
  app/
    answer_sheet_templates/   template definitions and geometry
    sheet_rendering/          draws printable sheets
    scan_alignment/           finds corner markers and warps scans
    bubble_grading/           bubble classifier and scoring
    grading_pipeline/         grades one scan job end to end
    db/                       SQLite schema and repositories
    synthetic_sheets/         fake filled-in sheets for tests
    main.py, routers.py       FastAPI app and routes
  data/templates/             printable sheets and template JSON
  scripts/                    sheet generators
```

## Known limits

- Thresholds are tuned on synthetic marks only. Light pencil marks on the 100-question
  sheet may read as blank.
- OCR on handwriting is weak. Use the identity endpoint to fix names.
- Scans taken in very uneven light or with extreme perspective can be rejected.
- Uploads are checked by content type and size only.
- Grading runs inside the request. There is no background worker.
- Cells in the CSV that start with `=`, `+`, `-` or `@` are not yet escaped.
