# AutoGradeQuiz

AutoGradeQuiz grades multiple-choice bubble sheets from uploaded images. All processing runs on your machine. The app does not use the cloud. The app does not use a camera. The app does not accept PDF uploads.

Read `AutoGradeQuiz_Documentation.md` for the full design. That file covers the tech stack, the REST API, the grading pipeline, and the template schema. This file covers setup, current status, and how to run the project.

**Done:**

1. Next.js app scaffolded and moved into `frontend/`.
2. Tauri initialized inside `frontend/`. The desktop shell builds and runs.
3. `backend/pyproject.toml` defines the backend package and its dependencies.
4. A Python virtual environment exists at `backend/.venv`.
5. Backend dependencies install in editable mode with `pip install -e ".[dev]"`.
6. Tesseract OCR is installed and working.
7. `ruff` formats and lints the backend on every change.
8. The SQLite schema and repository layer exist and pass their tests.
9. The three template specs (20, 50, and 100 questions) exist and generate correctly.
10. `template.json` and the printable `sheet.png` generate from one shared source for each template.

**Not done yet:**

1. The grading pipeline: image preprocessing, fiducial detection, grid mapping, bubble classification, and OCR.
2. The REST API routes for tests, batches, and scans.
3. The frontend upload UI, batch dashboard, and review queue.
4. A synthetic accuracy-testing harness for the bubble classifier.
5. Real-sheet calibration of the classifier thresholds.

## Requirements

1. Python 3.13.
2. Node.js 20 or later.
3. Rust, for the Tauri desktop build.
4. Tesseract OCR, as a native binary. Get the Windows installer at https://github.com/UB-Mannheim/tesseract/wiki.

This project uses native Tesseract through `pytesseract`, not a browser-based OCR library. The backend is a local Python server process. Native Tesseract gives offline, batch-speed OCR.

## Setup

Follow these steps in order.

1. Clone or copy this folder to your machine.
2. Open a terminal and go to the `backend` folder.
3. Create a virtual environment: `python -m venv .venv`.
4. Activate it: `.venv\Scripts\activate` on Windows.
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

This writes `template.json` and `sheet.png` for each of the three templates under `backend/data/templates/`.

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
├── AutoGradeQuiz_Documentation.md   the full design document
├── README.md                     this file
```

## Tech stack

| Layer              | Choice                                | License           |
| ------------------ | ------------------------------------- | ----------------- |
| Frontend           | Next.js, TypeScript, and Tailwind CSS | MIT               |
| Desktop shell      | Tauri                                 | MIT or Apache 2.0 |
| Image processing   | OpenCV, through Python                | Apache 2.0        |
| OCR                | Tesseract, through `pytesseract`      | Apache 2.0        |
| Backend            | FastAPI                               | MIT               |
| Structured storage | SQLite                                | Public domain     |

Every dependency uses a permissive license. The project has no copyleft obligations.

## Roadmap

1. **Phase 0, project setup.** Done. Folder structure, dependencies, and a working FastAPI entry point.
2. **Phase 1, data model.** Done. SQLite schema and repositories for tests, batches, scan jobs, and results.
3. **Phase 2, templates.** Done. The three `template.json` files and their matching printable sheets generate from one shared source function.
4. **Phase 3, grading pipeline.** In progress. Preprocessing, fiducial detection, grid mapping, bubble classification, OCR, and scoring.
5. **Phase 4, API layer.** Not started. The REST endpoints listed in `AutoGradeQuiz_Documentation.md`.
6. **Phase 5, frontend.** Not started. The upload UI, the batch dashboard, per-student review, and the manual correction queue.

## License

Every dependency uses a permissive license: MIT, Apache 2.0, or public domain.
