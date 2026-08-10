# AutoGradeQuiz

AutoGradeQuiz grades multiple-choice bubble sheets from uploaded images. All work runs on your machine. The app does not use the cloud, a camera, or PDF upload.

See `AutoGradeQuiz_Documentation.md` for the full design: tech stack decisions, the REST API shape, the grading pipeline, and the template schema. This README covers setup, current status, and how to run the project.

## Status: Phase 0 — project setup (in progress)

The project uses a `frontend/` and `backend/` split, with a root `package.json` that only orchestrates both. This phase gets that structure in place and confirms both halves start up. No grading logic exists yet.

**Done:**

- Next.js app scaffolded and moved into `frontend/`
- Tauri initialized inside `frontend/` (desktop shell)
- `backend/pyproject.toml` defines the backend package and its dependencies
- Python virtual environment created at `backend/.venv`
- Backend dependencies installed in editable mode (`pip install -e .`)
- Tesseract OCR installed and confirmed working (`C:\Program Files\Tesseract-OCR\tesseract.exe`, tested against a sample image)

**Not done yet:**

- `backend/app/` package skeleton (`api/`, `db/`, `grading/`, `models/`, `services/`)
- A FastAPI entry point (`backend/app/main.py`) — the backend does not run yet
- Root orchestrator `package.json` (`concurrently`, `dev` script)
- `.env.example` with `TESSERACT_CMD` set to the path above
- `backend/.venv` exclusion in `.gitignore` — add this before the first backend commit

## Requirements

1. Python 3.13
2. Node.js 20 or later
3. Rust (for the Tauri desktop build)
4. Tesseract OCR, native binary (Windows installer: https://github.com/UB-Mannheim/tesseract/wiki)

This project uses native Tesseract, not Tesseract.js. The backend is a local Python server process, not a browser page, so it calls the native binary through `pytesseract` for offline, batch-speed OCR.

## Setup

1. Clone or copy this folder to your machine.
2. Set up the backend:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e .
```

3. Confirm the install:

```powershell
pip list
pip show fastapi
pip show pytesseract
```

4. Install Tesseract OCR (the binary, not a Python package) and add it to PATH, or set `TESSERACT_CMD` in a `.env` file inside `backend/`.
5. Install frontend dependencies:

```powershell
cd frontend
npm install
```

## Run (development)

Backend, once `backend/app/main.py` exists:

```powershell
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd frontend
npm run dev
```

Open http://localhost:3000 in a browser.

## Project structure

```
autogradequiz/
├── backend/          FastAPI + OpenCV + Tesseract grading service
├── frontend/          Next.js + Tauri desktop UI
├── AutoGradeQuiz_Documentation.md   Full design document
└── README.md          This file
```

## Tech stack

| Layer              | Choice                              | License          |
| ------------------ | ----------------------------------- | ---------------- |
| Frontend           | Next.js + TypeScript + Tailwind CSS | MIT              |
| Desktop shell      | Tauri                               | MIT / Apache 2.0 |
| Image processing   | OpenCV (Python)                     | Apache 2.0       |
| OCR                | Tesseract, via `pytesseract`        | Apache 2.0       |
| Backend            | FastAPI                             | MIT              |
| Structured storage | SQLite                              | Public domain    |

All dependencies use permissive licenses. The project has no copyleft obligations.

## Roadmap

1. **Phase 0 — project setup** (current phase): folder structure, dependencies, empty FastAPI entry point.
2. **Phase 1 — data model**: SQLite schema and repositories for tests, batches, scan jobs, and results.
3. **Phase 2 — templates**: generate the three `template.json` files (20 / 50 / 100 questions) from one shared source function.
4. **Phase 3 — grading pipeline**: preprocessing, template match, grid mapping, bubble classification, OCR, scoring.
5. **Phase 4 — API layer**: the REST endpoints listed in `AutoGradeQuiz_Documentation.md`.
6. **Phase 5 — frontend**: upload UI, batch dashboard, per-student review, manual correction queue.

Each phase is a small set of git commits. See `AutoGradeQuiz_Documentation.md` for the full pipeline design behind these phases.

## Support

This is a solo eportfolio project. Track open work as GitHub issues once the repository is public.

## Contributing

Not open for outside contributions at this stage. The project follows a fixed working pattern: plan a phase, confirm it, then implement it as small, single-purpose git commits. Code stays self-documenting — no inline comments, descriptive names instead.

## Project status

Active development. Currently in Phase 0 (project setup).

## License

All dependencies use permissive licenses (MIT, Apache 2.0, or public domain).
