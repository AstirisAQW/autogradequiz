# AutoGradeQuiz

AutoGradeQuiz is a local web application that grades multiple-choice answer sheets (`20`, `50`, or `100` questions) from scanned or photographed A4 pages. It aligns skewed or rotated pages using printed black corner squares, classifies bubble fills across up to four key versions (`A`–`D`), reads handwritten `Name`, `Date`, `Class`, and `Student ID` header boxes with Tesseract OCR, and saves everything to plain files on disk under `workspace/<Folder Name>/`.

> **Project Status:** Active local prototype verified on synthetic and distorted sheets (`81` backend tests in `backend/tests/`, `39` frontend unit tests in `frontend/tests/`). Not yet calibrated on real camera photos under uneven lighting.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [Usage](#usage)
- [How the Grading Pipeline Works](#how-the-grading-pipeline-works)
- [API Reference & Configuration](#api-reference--configuration)
- [Running Tests](#running-tests)
- [Project Layout](#project-layout)
- [Known Limitations](#known-limitations)

---

## Features

- **Folder-backed disk workspaces:** Each school term or grading session lives in `workspace/<Folder Name>/` on disk (`folder.json`, `classes.json`, `students.json`, and `quizzes/<slug-id>/`). No browser IndexedDB is used, and no default folder is auto-created.
- **Printable A4 bubble templates:** Download ready-to-print `300 DPI` PDFs for `20`, `50`, or `100` questions (`A`–`E` choices) with a `Key Version: A B C D` bubble strip and handwritten header boxes.
- **Multi-version keys & partial credit:** Configure up to 4 key versions (`A`–`D`), per-question point weights, multi-mark primary answers (`A+B`), alternate partial-credit choices, wrong-attempt point penalties, and topic tags—or scan a filled master sheet to populate the key automatically.
- **Automatic student & class linking:** Scanned `Student ID` and `Class` boxes link papers to existing roster students (or auto-create roster entries); importing a roster CSV retroactively links previously graded papers.
- **Fast flagged-mark review (`/review`):** Keyboard-driven review queue (`A`–`E`, `Backspace`, `↑`/`↓`, `←`/`→`, `Enter`) with zoomed question-row crops, live score previews, and student identity linking.
- **Analytics & CSV export:** View score distributions, hardest-first item analysis with discrimination index, and per-tag proficiency (`70%+`), or export UTF-8 BOM CSV spreadsheets (`name, student_id, date, class, key_version, score, needs_review, q1..qN`).

---

## Tech Stack

| Layer | Technology | Role |
| --- | --- | --- |
| **Backend** (`backend/`, Python 3.13+) | `FastAPI`, `Uvicorn`, `Pydantic` | REST API (`/health`, `/scan-key`, `/workspace/*`) and settings |
| **Computer Vision & OCR** | `OpenCV`, `NumPy`, `pytesseract`, `Pillow` | Perspective warp, normalized-ink bubble classification, parallel header OCR, PDF generation |
| **Frontend** (`frontend/`, Node.js 22.6+) | `Next.js 16` (App Router), `React 19`, `Tailwind CSS 4` | Folder workspace UI (`/`, `/classes`, `/students`, `/quizzes/[id]`, `/review`) |
| **Testing & Linting** | `pytest`, `Ruff`, `node --test`, `TypeScript`, `ESLint` | Unit/integration test suites and static analysis |

---

## Installation

### Prerequisites
- **Python 3.13+**
- **Node.js 22.6+** and `npm`
- **[Tesseract OCR](https://github.com/tesseract-ocr/tesseract)** (optional, for reading handwritten header boxes). If `tesseract.exe` is not on your system `PATH`, set `TESSERACT_CMD` to its full path.

### Part 1: Backend Setup (Windows PowerShell)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -e ".[dev]"
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- API server: `http://127.0.0.1:8000`
- Interactive OpenAPI docs: `http://127.0.0.1:8000/docs`

### Part 2: Frontend Setup

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

- Web UI: `http://localhost:3000`

---

## Usage

1. **Create or select a folder:** Open `http://localhost:3000` and create a folder (e.g., `Midterm Grade 10`). You can optionally copy the class and student roster from an existing folder.
2. **Import your roster (optional):** Go to **Students → Import CSV** to bulk-import student names, IDs, classes, and LRNs, or add classes and students manually.
3. **Create a quiz & print sheets:** Click **New quiz**, choose a template (`20`, `50`, or `100` questions), and set the answer key (or click **Scan key from sheet**). Use **More quiz actions → Download blank A4 PDF** and print at **100% scale ("Actual size")**.
4. **Upload scans:** In the quiz **Papers** tab, drag and drop `.png` or `.jpg` scans (up to `10 MB` each).
5. **Review uncertain marks:** Click **Review Papers** in the sidebar to resolve ambiguous or double-marked bubbles and confirm any unconfigured Key Version marks.
6. **Analyze & export:** Open the **Statistics**, **Item analysis**, or **Tags** tabs, or click **More quiz actions → Export grades** to download `<quiz>-grades.csv`.

### CLI Scripts (`backend/`)

Regenerate printable template PDFs/PNGs/JSON specs or generate synthetic test sheets on disk:

```powershell
cd backend
.\.venv\Scripts\python.exe -m scripts.generate_templates
.\.venv\Scripts\python.exe -m scripts.generate_synthetic_sheets --templates 20q_a4 --count 5
```

- Templates are written to `backend/data/templates/<template_id>/`.
- Synthetic sheets are written to `backend/data/synthetic_sheets/<template_id>/`.

---

## How the Grading Pipeline Works

Every scan uploaded to `POST /workspace/folders/{folder}/quizzes/{quiz_id}/grade` runs a 4-stage pipeline:

1. **Fiducial Detection & Perspective Alignment (`backend/app/scan_alignment/aligner.py`):** Tests all 4 cardinal orientations (`0°`, `90°`, `180°`, `270°`), locates the four `8 × 8 mm` corner squares (falling back to a mid-edge marker if one corner is clipped), warps the image to canonical `2480 × 3507 px` A4 coordinates (`300 DPI`), and selects the orientation where the expected mid-edge markers are darkest.
2. **Per-Sheet Ink Calibration (`backend/app/bubble_grading/classifier.py`):** Measures the sheet's blank paper `white` level and corner fiducial `black` level, converting pixel intensities into a normalized ink fraction in `[0.0, 1.0]`.
3. **Key Version & Row-Relative Bubble Classification (`backend/app/bubble_grading/`):** Reads the `Key Version: A B C D` strip, samples each bubble's inner disc (`mean_ink`, 90th-percentile `peak_ink`, and largest dark component `blob_ratio`), classifies each row as `BLANK`, `FILLED`, `MULTIPLE`, or `AMBIGUOUS`, and scores against the active key version (`scoring.py`).
4. **Header Ink Check & Parallel Tesseract OCR (`backend/app/grading_pipeline/pipeline.py`):** Crops `Name`, `Date`, `Class`, and `Student ID` boxes, skips blank boxes via a fast dark-pixel check, and runs `pytesseract` (`--psm 7`) concurrently across non-empty boxes.

---

## API Reference & Configuration

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `TESSERACT_CMD` | empty (uses `PATH`) | Path to the `tesseract` executable (backend) |
| `AUTOGRADE_DATA_DIR` | `backend/data` | Directory for bundled template assets and synthetic sheet CLI outputs (backend) |
| `AUTOGRADE_WORKSPACE_DIR` | `workspace` | Root directory holding user-created `<Folder Name>/` workspaces (backend) |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:8000` | Backend base URL used by the Next.js frontend |

### HTTP Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check (`{"status": "ok"}`) |
| `POST` | `/scan-key` | Extract answer key choices from a filled master sheet image |
| `GET` | `/workspace/templates/{template_id}` | Download printable A4 template PDF (`20q_a4`, `50q_a4`, `100q_a4`) |
| `GET` / `POST` | `/workspace/folders` | List workspace folders or create a folder (optional `copyRosterFrom`) |
| `PATCH` / `DELETE` | `/workspace/folders/{folder}` | Rename or permanently delete a workspace folder |
| `GET` | `/workspace/folders/{folder}/roster` | Read all classes and students in a folder |
| `GET` / `POST` / `PUT` / `DELETE` | `/workspace/folders/{folder}/classes[/{class_id}]` | List, create, update, or delete classes |
| `GET` / `POST` / `PUT` / `DELETE` | `/workspace/folders/{folder}/students[/{student_id}]` | Read, create, update, or delete students (with retroactive paper linking) |
| `POST` | `/workspace/folders/{folder}/students/import` | Bulk-import students from parsed CSV rows in a single lock pass |
| `GET` / `POST` / `PUT` / `DELETE` | `/workspace/folders/{folder}/quizzes[/{quiz_id}]` | List, create, update (with automatic paper rescoring), or delete quizzes |
| `GET` | `/workspace/folders/{folder}/quizzes/{quiz_id}/export.csv` | Download UTF-8 BOM CSV grades for a quiz |
| `POST` | `/workspace/folders/{folder}/quizzes/{quiz_id}/grade` | Grade an uploaded scan image into a quiz and persist raw/aligned images |
| `GET` | `/workspace/folders/{folder}/review` | List all papers needing review across the folder |
| `PATCH` / `DELETE` | `/workspace/folders/{folder}/quizzes/{quiz_id}/papers/{paper_id}` | Save review corrections/identity edits or delete a graded paper |
| `GET` | `/workspace/folders/{folder}/quizzes/{quiz_id}/papers/{paper_id}/image/{kind}` | Stream `raw` or `aligned` scan image from disk |

---

## Running Tests

### Backend (`backend/`)

```powershell
cd backend
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\python.exe -m pytest -q
```

### Frontend (`frontend/`)

```powershell
cd frontend
npm test
npx tsc --noEmit
npx eslint src/ tests/
```

---

## Project Layout

```text
backend/
  app/
    answer_sheet_templates/   A4 template specs (20q, 50q, 100q), header boxes, Key Version A-D geometry
    sheet_rendering/          Printable PDF/PNG sheet renderer and synthetic text drawer
    scan_alignment/           Corner/mid fiducial detection and perspective warp (aligner.py)
    bubble_grading/           Normalized-ink bubble classifier and partial-credit scorer
    grading_pipeline/         Multi-key grading pipeline and parallel Tesseract OCR (pipeline.py)
    workspace_store/          Folder-backed disk store (io, folders, roster, quizzes, papers)
    main.py                   FastAPI application and exception handlers
    stateless_router.py       POST /scan-key and shared image decoding helpers
    workspace_router.py       /workspace/folders/* and /workspace/templates/* routes
  data/templates/             Committed printable A4 PDF, PNG, and JSON template specs
  scripts/                    CLI scripts for generating templates and synthetic sample sheets
  tests/                      Backend pytest suite (10 test modules) and synthetic_sheets/ fixtures
frontend/
  src/
    app/                      Next.js App Router pages (/, /classes, /students, /quizzes/[id], /review)
    components/               AppShell, FolderGate, FolderSwitcher, quiz/, roster/, review/, and ui/
    lib/                      Scoring, geometry, analytics, CSV export/import, and workspace API client
  tests/                      Frontend unit test suite (9 *.test.ts modules)
workspace/                    User-created <Folder Name>/ directories on disk
```

---

## Known Limitations

- **Single-user localhost design:** The app has no authentication or multi-process database lock; it is designed for one teacher running a single `uvicorn` worker locally (`127.0.0.1`).
- **Real-world photo lighting:** Classifier thresholds are tested against synthetic sheets with simulated rotation, perspective skew, blur, brightness gradients, and noise, but have not yet been calibrated on phone photos with harsh shadows or deep paper creases.
- **Handwriting OCR accuracy:** Tesseract `--psm 7` works best on printed or neatly printed block characters; cursive handwriting in the `Name` or `Student ID` box may require manual linking in `/review`.
