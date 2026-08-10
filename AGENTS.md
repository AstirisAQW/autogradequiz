# AGENTS.md

Read this file before writing any code, comment, doc, commit message, or PR description for AutoGradeQuiz. Heed it over prior training habits. Full design context lives in `AutoGradeQuiz_Documentation.md`; this file is the working ruleset, not the design doc.

## Project

AutoGradeQuiz grades multiple-choice bubble sheets from uploaded images. All processing runs locally: no cloud calls, no external OCR service.

- `backend/` — FastAPI + OpenCV + Tesseract (`pytesseract`) grading service, Python.
- `frontend/` — Next.js + TypeScript + Tailwind, packaged as a desktop app with Tauri.
- Workflow is phase-based (see README Roadmap). Finish and confirm one phase before starting the next. Each unit of work is a small, single-purpose git commit.

## Writing standard: ASD-STE100 Simplified Technical English

Applies to: README, `AutoGradeQuiz_Documentation.md`, commit messages, PR descriptions, code comments, and any in-app text the user reads (error messages, upload prompts, result summaries).

Does not apply to: code, identifiers, variable and function names, command syntax, config file contents.

Rules:

- Active voice. One instruction per sentence.
- Max 20 words for instructions, 25 for descriptive sentences.
- No contractions. No semicolons — write two sentences instead.
- No marketing adjectives (seamless, powerful, cutting-edge, robust, effortless).
- One name for one thing. Do not rename the same concept partway through a doc (e.g., pick "batch" or "scan job," not both).
- Numbered vertical lists for steps, one action per item, imperative form.

Modes:

- **In-app text the user sees** (error messages, validation messages, result labels): strict mode. Every rule applies, including the 20-word cap.
- **README, docs, commit messages, PR descriptions**: STE-flavored. Keep active voice, one-topic sentences, and no contractions, but allow the vocabulary range needed for normal technical writing.

## Code standard: self-documenting, no inline comments

This project's stricter-than-default rule: no inline comments. Names carry the meaning.

- Name things so the code needs no comment to explain what it does. `calculate_score`, not `process` or `handle_data`.
- If a function needs a comment to explain its logic, refactor the function instead of writing the comment.
- Exceptions (the only comments allowed): a public API docstring, a `TODO` with an owner, or a warning about a genuinely non-obvious constraint (e.g., a Tesseract quirk, an OpenCV coordinate-system gotcha). Nothing else.
- Never leave commented-out code. Delete it. Git history keeps it.
- No `null`/`None` returns and no `null`/`None` arguments where avoidable. Return an empty list/dict, or raise, instead of returning `None` to signal failure.
- One job per function. Aim under ~20 lines. 0–2 arguments ideal, 3 is the max. No flag arguments — split into two functions.

### Python (backend)

- Type-hint every function signature. FastAPI route handlers use Pydantic models for request/response bodies, not raw dicts.
- Business logic (grading, template matching, OCR) lives in `backend/app/services/` and `backend/app/grading/`, not in route handlers. Route handlers call services; they do not contain grading logic.
- Raise typed exceptions with a message that states what failed and why, not just that it failed.

### TypeScript (frontend)

- No `any`. If a type is genuinely unknown, use `unknown` and narrow it.
- Functional components only. Named exports for anything shared across files.
- Keep components focused: a component that both fetches data and renders a complex table should be split into a data-fetching hook and a presentational component.

## File and directory layout

```
autogradequiz/
├── AGENTS.md                        this file
├── CLAUDE.md                        pointer to this file, do not duplicate rules there
├── README.md
├── AutoGradeQuiz_Documentation.md   full design: API shape, pipeline, template schema
├── backend/
│   ├── pyproject.toml
│   └── app/                         planned: api/, db/, grading/, models/, services/
└── frontend/
    ├── src/app/                     Next.js app router pages
    └── src-tauri/                   Tauri desktop shell, Rust
```

- Tests live next to the file they test (`foo.py` → `test_foo.py`, `foo.tsx` → `foo.test.tsx`).
- Do not create a new top-level folder without asking first.
- Formatting, line length, and import order are enforced by the linter (ESLint on the frontend; add a Python formatter before backend code lands). Do not restate those rules here — run the linter instead of guessing the style.

## When unsure

Ask before inventing a project convention that isn't stated above or in `AutoGradeQuiz_Documentation.md`.
