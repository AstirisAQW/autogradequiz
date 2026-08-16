# AutoGradeQuiz

AutoGradeQuiz grades multiple-choice bubble sheets from uploaded images. The app runs on your machine. The app does not use the cloud. The app does not use a camera. The app does not accept PDF uploads.

A user uploads photo or scan images of graded bubble sheets. The app reads each sheet and produces a score.

## What the app leaves out

| Feature left out | Reason |
|---|---|
| Live camera capture | Camera capture needs device permissions, a live preview, and glare handling. None of this affects the grading logic. |
| Multi-page PDF upload | PDF libraries carry mixed licenses. A PDF page also raises a data question: does one page equal one student. |
| A bubble-coded student ID grid | Student identity comes from OCR on the Name field. A second bubble grid adds a second scoring system for no clear gain. |
| Dynamic, user-defined templates | The app supports three fixed templates. A dynamic template system needs general template-detection logic. |

These choices keep the pipeline simple. One image goes in. One graded result comes out.

## Tech stack

| Layer | Choice | License | Role |
|---|---|---|---|
| Frontend | Next.js, TypeScript, Tailwind CSS | MIT | Upload UI, dashboards, review queue |
| Desktop shell | Tauri | MIT or Apache 2.0 | Packages the web frontend as a native local app |
| Image processing | OpenCV, through Python | Apache 2.0 | Fiducial detection, perspective correction, bubble analysis |
| OCR | Tesseract, through `pytesseract` | Apache 2.0 | Reads the Name, Date, and Section fields |
| Backend | FastAPI | MIT | The local REST API between the frontend and the grading pipeline |
| Structured storage | SQLite | Public domain | Tests, batches, scan jobs, scores |
| File storage | The local filesystem | — | Raw images, processed images, template files |
| Ingestion | Direct image upload, JPEG or PNG | — | One image file per test paper |

Every dependency uses a permissive license: MIT, Apache 2.0, or public domain. The project has no copyleft duty.

### Two local processes, not one

Next.js cannot run Python directly. OpenCV.js is a browser-only option. It gives less control over pixel-level bubble analysis than native OpenCV. So the project runs Next.js and FastAPI as two local processes. The two processes talk over `localhost` through a REST API. Both processes stay on your machine. Neither process needs internet access at run time.

### Storage: files and a database, split by job

SQLite stores anything the app must query, filter, or total: test metadata, batch status, scores, and file paths. The filesystem stores files instead: raw scan images, processed images, and template files. SQLite never stores an image as a blob. It stores the path to that image instead.

Only the FastAPI process writes to SQLite. The frontend only reads. This rule stops SQLite lock conflicts between two writers.

## Requirements

1. Python 3.13.
2. Node.js 20 or later.
3. Rust, for the Tauri desktop build.
4. Tesseract OCR, as a native binary. Get the Windows installer at https://github.com/UB-Mannheim/tesseract/wiki.

The project uses native Tesseract through `pytesseract`, not a browser-based OCR library. The backend runs as a local Python server process. Native Tesseract gives offline OCR at batch speed.

## Setup

Follow these steps in order.

1. Clone or copy this folder to your machine.
2. Open a terminal and go to the `backend` folder.
3. Create a virtual environment: `python -m venv .venv`.
4. Activate it. On Windows, run `.venv\Scripts\activate`.
5. Install the backend package: `pip install -e ".[dev]"`.
6. Install Tesseract OCR as a system binary. Add it to your PATH, or set `TESSERACT_CMD` in a `.env` file inside `backend/`.
7. Go to the `frontend` folder.
8. Install frontend dependencies: `npm install`.
9. Install the Tauri CLI: `npm install -D @tauri-apps/cli`.
10. Install the Tauri API package: `npm install @tauri-apps/api`.

## Run in development

Start the backend:

```powershell
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check `http://127.0.0.1:8000/health`. The response must show `{"status":"ok"}`.

Start the frontend:

```powershell
cd frontend
npm run dev
```

Open `http://localhost:3000` in a browser.

Start the desktop shell:

```powershell
cd frontend
npm run tauri dev
```

The first run compiles Rust. This takes a few minutes. Later runs are faster.

## Run the backend tests

```powershell
cd backend
pytest -v
```

## Generate the template files

```powershell
cd backend
python scripts/generate_templates.py
```

This command writes a `template.json` file and a `sheet.png` file for each of the three templates, under `backend/data/templates/`.

## Project structure

```
autogradequiz/
├── backend/
│   ├── app/                      the FastAPI application package
│   │   ├── db/                   SQLite schema and repositories
│   │   └── grading/              template generation and, later, the grading pipeline
│   ├── scripts/                  command-line entry points, outside the app package
│   ├── data/                     runtime state, created on first run, not committed to git
│   └── pyproject.toml
├── frontend/                     Next.js UI, packaged with Tauri
├── AGENTS.md                     the working ruleset for this codebase
└── README.md                     this file, with setup steps and the full design
```

## Roadmap

| Phase | Status | Covers |
|---|---|---|
| 0. Project setup | Done | Folder structure, dependencies, a working FastAPI entry point |
| 1. Data model | Done | SQLite schema and repositories, for tests, batches, scan jobs, and results |
| 2. Templates | Done | The three `template.json` files and their matching printable sheets, from one shared source function |
| 3. Grading pipeline | In progress | Preprocessing, fiducial detection, grid mapping, bubble classification, OCR, and scoring |
| 4. API layer | Not started | The REST routes in the section below |
| 5. Frontend | Not started | The upload UI, the batch dashboard, per-student review, and the manual correction queue |

Done so far, in detail:

1. The Next.js app, scaffolded and moved into `frontend/`.
2. Tauri, set up inside `frontend/`. The desktop shell builds and runs.
3. `backend/pyproject.toml`, with the backend package and its dependencies.
4. A Python virtual environment at `backend/.venv`.
5. Backend dependencies, installed in editable mode with `pip install -e ".[dev]"`.
6. Tesseract OCR, installed and working.
7. `ruff`, formatting and linting the backend on every change.
8. The SQLite schema and repository layer, with passing tests.
9. The three template specs, for 20, 50, and 100 questions, generating correctly.
10. `template.json` and the printable `sheet.png`, generated from one shared source for each template.

Not done yet, in planned order:

1. The grading pipeline: preprocessing, fiducial detection, grid mapping, bubble classification, OCR, and scoring.
2. The fill-ratio bubble classifier.
3. Whole-field OCR for the Name, Date, and Section fields.
4. A synthetic accuracy-testing harness for the bubble classifier.
5. Real-sheet calibration of the classifier thresholds.
6. The REST API routes, for tests, batches, and scans.
7. The frontend upload UI, batch dashboard, and review queue.

## REST API design

Status: not built yet. This section shows the planned shape.

The API uses resource-oriented routes. Each route names a noun, not a verb. Each route uses the correct HTTP method. Every response returns JSON.

```
POST   /tests                      create a test
GET    /tests                      list tests
GET    /tests/{id}                 get one test

POST   /tests/{id}/batches         upload a batch of scanned images
GET    /tests/{id}/batches/{bid}   get batch status

GET    /batches/{bid}/scans        list scans in a batch
GET    /scans/{sid}                get one scan result
PATCH  /scans/{sid}                submit a manual correction

GET    /scans/{sid}/image          serve the processed image
```

## End-to-end grading pipeline

Status: template generation is done. The steps below are not built yet.

1. **Upload.** The frontend sends a batch of images to the backend. The backend assigns the batch to a test.
2. **Queue.** Each image becomes a scan job in SQLite, with status `pending`. A background worker picks up pending jobs.
3. **Preprocess.** Convert the image to grayscale. Detect the four corner fiducial marks. If the marks are not found, mark the job `needs_review` and stop. Correct the perspective and the skew.
4. **Verify mid-page markers.** For the 50-question and 100-question templates, check the mid-page markers. If a marker sits too far from its expected position, flag the scan for review.
5. **Map the grid.** Read the template for this test. Map each bubble position onto the corrected image.
6. **Classify each bubble.** Measure the fill ratio inside each bubble. Classify the result as filled, blank, ambiguous, or multiple.
7. **Read the text fields.** Run Tesseract on the Name, Date, and Section fields as whole regions. Tesseract reads full words, not single characters.
8. **Score.** Compare each filled bubble against the answer key. Compute the raw score. Track blank answers and wrong answers as separate counts.
9. **Store and show.** Save the scan result to SQLite and the filesystem. Show the batch summary and the review queue in the frontend.
10. **Manual review.** A person resolves any flagged scan. The correction updates the score.

## Template design

### Paper size

All three templates use full A4 paper. An early design used smaller paper for the 20-question template. A review of real ZipGrade templates showed a better rule: keep bubble size constant, and add columns as the question count grows. Small paper makes bubbles small. Small bubbles are harder to detect. Full A4 avoids this problem.

| Template | Layout |
|---|---|
| 20 questions | Two columns |
| 50 questions | Five column blocks, some stacked |
| 100 questions | Ten column blocks, stacked in pairs |

### Fiducial marks

The 20-question template uses four corner marks only. Question density is low, so error from one global perspective correction stays small.

The 50-question and 100-question templates add mid-page marks between column blocks. A dense page can bow or skew locally. One global correction can miss that local error. The mid-page marks let the pipeline check for local misalignment. A scan with a misaligned mid-marker goes to manual review, instead of a silent misread.

### Student information fields

The layout places Name in the top left, Date in the top right, and Section below Name. All three fields use whole-field OCR. An earlier design drew a divider line for each expected character. Tesseract reads full words from one field directly. The dividers added visual clutter with no gain in accuracy. The current design removed them.

### One source of truth

Each template starts as a `TemplateSpec`, in millimeters. One function converts a `TemplateSpec` into two outputs: the `template.json` file for the grading pipeline, and the `sheet.png` file for printing. Both outputs use the same numbers, so the two files cannot drift out of sync.

### `template.json` shape

```json
{
  "template_id": "50q_a4",
  "page": { "width_mm": 210, "height_mm": 297, "dpi": 300 },
  "fiducials": {
    "corners": [{ "id": "top_left", "x": 0.029, "y": 0.02 }],
    "mid_markers": [{ "id": "mid_0", "x": 0.262, "y": 0.414 }]
  },
  "text_fields": [
    { "id": "name", "x": 0.095, "y": 0.061, "width": 0.429, "height": 0.034 }
  ],
  "answer_grid": {
    "question_count": 50,
    "choices": ["A", "B", "C", "D", "E"],
    "columns": [
      {
        "origin_x": 0.105,
        "origin_y": 0.185,
        "question_start": 1,
        "question_end": 10
      }
    ],
    "row_spacing": 0.024,
    "choice_spacing": 0.033,
    "bubble_radius": 0.012
  }
}
```

All coordinates use fractions of the page, from 0.0 to 1.0. A fraction stays correct when the scan resolution changes. A raw pixel value does not.

## Bubble classification design

Status: not built yet. This section shows the planned design.

### The fill-ratio method

An old design measured the average pixel intensity in a rectangle around each bubble. That method mixes two signals: how dark a mark is, and how much of the bubble it covers. The planned design measures fill ratio instead:

```
fill_ratio = count of dark pixels inside a circular mask / total pixel count inside that mask
```

The mask matches the true bubble shape. The mask also extends a small margin past the printed circle, since real pencil or pen marks often bleed past the printed line.

### Classification bands

| Fill ratio | Result |
|---|---|
| Near 0 percent | Blank |
| A low-to-mid band | Ambiguous, most often an incomplete or light fill |
| High, and clearly the only high value in the row | Filled |
| Two or more bubbles both land in the high band | Multiple |

An incomplete fill, a light pencil mark, or a non-circular mark all land between fully blank and fully filled. A non-circular mark means a shape like an X or a checkmark. The fill-ratio method puts these marks in the ambiguous band. It does not force a guess. A person reviews ambiguous results in the manual review queue.

### Blank and wrong stay apart

A scoring report tracks three counts per question: correct, wrong, and blank. A teacher reading a class report needs to see that twelve students left question seven blank. They should not see one merged count of twelve wrong answers. The two cases carry the same score impact, but a different meaning in the classroom.

## Accuracy testing plan

Status: not built yet. This section shows the planned approach.

### Synthetic test sheets

A generator uses the same bubble coordinates the renderer knows. It draws marks onto a rendered sheet at known positions. Each generated sheet gets its own known-correct answer key.

The generator makes these fill defects on purpose:

1. A perfect, fully dark fill.
2. An incomplete fill, at a reduced radius.
3. A faint, gray fill.
4. An off-center fill.
5. A non-circular mark, such as an X or a scribble.
6. A stray mark, away from any bubble.
7. No mark at all, for the blank case.
8. Two marks in one row, for the multiple case.

The generator also adds scan and photo defects: slight rotation, blur, a brightness change, and JPEG compression noise.

### The test harness

The harness runs every synthetic sheet through the grading pipeline. It checks the result against the known ground truth. The harness reports:

1. Precision and recall for each of the four bubble classes.
2. A confusion matrix for the four classes.
3. End-to-end score accuracy, against the expected score.

### Real-sheet calibration

Synthetic defects cover known error types. Real paper, real pencil marks, and real camera sensors carry errors that a synthetic generator will not predict. The plan is to use fifteen to twenty hand-filled, hand-scored real sheets. You will scan or photograph these sheets. This step will calibrate the classification thresholds against real data, before the thresholds ship as defaults.

## Data model

### SQLite tables

| Table | Key columns |
|---|---|
| `tests` | id, name, template_id, answer_key_json, question_count |
| `batches` | id, test_id, status |
| `scan_jobs` | id, batch_id, raw_image_path, status |
| `scan_results` | id, scan_job_id, name_text, date_text, section_text, score, answers_json, flags_json, needs_review |

### Filesystem layout

```
backend/data/
├── autograde.db
└── templates/
    ├── 20q_a4/{template.json, sheet.png}
    ├── 50q_a4/{template.json, sheet.png}
    └── 100q_a4/{template.json, sheet.png}
```

## License

Every dependency uses a permissive license: MIT, Apache 2.0, or public domain. The project carries no copyleft duty.