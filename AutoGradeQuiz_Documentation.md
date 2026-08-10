# AutoQuizGrading — Project Documentation

A fully local, offline bubble-sheet grading application (ZipGrade clone). No cloud dependency, no camera capture, no PDF handling, no bubble-coded ID field.

---

## 1. Project scope

**What it is:** A desktop app that grades multiple-choice bubble sheets from uploaded photo/scan images of test papers, entirely on the user's own machine.

**What it deliberately excludes, and why:**

| Excluded feature               | Reason                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live camera capture            | Removes device permissions, live preview, autofocus, glare/motion-blur handling — none of it touches grading logic, all of it adds engineering time  |
| Multi-page PDF upload          | Removes a licensing question (PyMuPDF is AGPL; Poppler-based tools are GPL-adjacent) and a data-modeling question (does one PDF page = one student?) |
| Bubble-coded student ID grid   | Student identity is captured via OCR (Name field) only, not a second bubble grid — avoids a second scoring subsystem                                 |
| Dynamic/user-defined templates | Three fixed templates only (20/50/100 questions) — avoids building general template-detection logic                                                  |

These exclusions are what keep the pipeline linear: **one image in → one graded result out**, with no branching logic for capture method, file type, or template variability beyond a simple 3-way lookup.

---

## 2. Tech stack

| Layer              | Choice                              | License          | Role                                                                                      |
| ------------------ | ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| Frontend           | Next.js + TypeScript + Tailwind CSS | MIT              | Upload UI, dashboards, review queue                                                       |
| Desktop shell      | Tauri                               | MIT / Apache 2.0 | Packages the web frontend as a native local app; lighter than Electron                    |
| Image processing   | OpenCV (Python)                     | Apache 2.0       | Fiducial detection, perspective correction, bubble-grid mapping, pixel-intensity analysis |
| OCR                | Tesseract (via `pytesseract`)       | Apache 2.0       | Per-cell character recognition for Name / Date / Section fields                           |
| Backend            | FastAPI                             | MIT              | Local REST API bridging Next.js and the Python/OpenCV pipeline                            |
| Structured storage | SQLite                              | Public domain    | Tests, batches, scan jobs, scan results, scores                                           |
| File storage       | Local filesystem                    | —                | Raw images, processed images, per-scan JSON results                                       |
| Ingestion          | Direct image upload (JPEG/PNG)      | —                | Single image file per test paper                                                          |

**Licensing note:** every component is permissively licensed (MIT / Apache 2.0 / public domain). No copyleft dependencies anywhere in the stack — safe to distribute or sell without obligation to release source.

### Why two processes (Next.js + Python), not one

Next.js has no first-class runtime for Python, and the browser-only alternative (OpenCV.js via WASM) is a materially weaker tool for fine-grained pixel-level bubble analysis than native OpenCV. Running them as two local processes that talk over `localhost` REST isn't overhead — it lets each half use the runtime it's actually good at. Both processes stay entirely local; nothing here requires internet access at runtime.

### Storage: hybrid, not pure SQLite or pure folders

- **SQLite** holds anything that needs querying, filtering, or aggregation: test metadata, batch status, per-student scores, file paths.
- **Filesystem folders** hold anything naturally file-shaped: raw scan images, processed/corrected images, per-scan raw result JSON.
- SQLite stores _paths_ into the folder structure, not image blobs.
- **Single-writer pattern recommended**: only the FastAPI/Python service writes to SQLite; Next.js only reads. This avoids SQLite's known dual-writer lock contention issues rather than needing to solve them.

---

## 3. REST API design

Resource-oriented (nouns, not verbs), JSON responses, standard HTTP verbs. This is the contract between Next.js and the Python/FastAPI backend.

```
POST   /tests                      create a test (template_id + answer key)
GET    /tests                      list tests
GET    /tests/{id}                 get one test's details

POST   /tests/{id}/batches         upload a batch of scanned images
GET    /tests/{id}/batches/{bid}   get batch status/summary

GET    /batches/{bid}/scans        list scans in a batch, with status
GET    /scans/{sid}                get one scan's result (bubbles, OCR, score)
PATCH  /scans/{sid}                manual correction (fix an ambiguous mark)

GET    /scans/{sid}/image          serve the processed image file
```

"RESTful-ish" is the right amount of rigor here — resource-shaped URLs, correct verbs, JSON bodies — without needing to chase full REST purity (statelessness, HATEOAS, etc.).

---

## 4. End-to-end pipeline

```
1. Upload
   Next.js UI → single or batch image upload (JPEG/PNG only)
   → assign batch to a Test (which has: template_id, answer key, roster)

2. Queue
   Each image becomes a job row in SQLite (status: pending)
   FastAPI worker picks up jobs

3. Preprocess (OpenCV)
   Grayscale → adaptive threshold
   Detect corner fiducial marks (+ mid-page fiducials for 50q/100q templates)
   If marks not found / low confidence → mark job "needs_review", stop
   Perspective correction + deskew

4. Template match
   Confirm detected layout matches the test's registered template_id
   (No dynamic detection — a simple 3-way lookup: 20q / 50q / 100q)

5. Grid mapping + bubble analysis
   Map bubble coordinates from template.json onto the corrected image
   Per-bubble mean pixel intensity → classify: filled / blank / ambiguous / multiple
   Aggregate per-question result

6. OCR (Name / Date / Section)
   Per-character-cell OCR via Tesseract, char-whitelisted
   (letters-only whitelist for Name/Section, digits+separators for Date)

7. Score
   Compare bubble results against the answer key
   Compute raw score; flag any ambiguous questions used in scoring

8. Store + surface
   Write scan result, per-question breakdown, flags to SQLite + filesystem
   Next.js dashboard: batch summary, per-student drill-down, review queue

9. Manual review (UI)
   Human resolves ambiguous marks / uncertain OCR
   Corrections written back via PATCH /scans/{id}; score recalculated
```

---

## 5. Template design

### 5.1 Sizing decision (corrected from an earlier assumption)

Initial instinct was to shrink paper size as question count grows (e.g. quarter-A4 for a 20-question sheet, for easy print-and-cut). Reviewing real ZipGrade templates overturned this: **ZipGrade keeps the page size constant (full-page) across all question counts and adds columns instead of shrinking bubbles.** This is because bubble size and row spacing directly determine detection reliability — shrinking them to fit more questions on a smaller page trades reliability for print convenience, which is the wrong trade for this application.

**Decision: all three templates use full A4.** Only column count changes:

| Template      | Layout              |
| ------------- | ------------------- |
| 20 questions  | 2 columns × 10 rows |
| 50 questions  | 3 column-groups     |
| 100 questions | 4 column-groups     |

### 5.2 Fiducial marks

- **20-question template**: 4 corner marks only. Low question density means low accumulated distortion risk — a single global perspective transform is sufficient.
- **50 and 100-question templates**: 4 corner marks **plus additional marks between column blocks** (confirmed against real ZipGrade samples). A single global 4-corner transform assumes the whole page is one flat, evenly-distorted plane — true for a small area, less true across a dense multi-column page where paper bow, lens distortion, and skew error accumulate with distance from the reference corners. Mid-page fiducials let the algorithm locally re-anchor per column-group instead of trusting one global warp across the entire sheet.

### 5.3 Student information fields

Per final layout: **Name (top-left), Date (top-right), Section (below Name)**.

All three are **OCR text regions**, not bubble grids (no bubble-coded ID field was added). This matters structurally: they reuse the exact same per-cell Tesseract logic already needed for the Name field — no new subsystem, just three more coordinate regions in the template and three more result columns in the database. Adding these fields was assessed to add near-zero architectural complexity for exactly this reason.

### 5.4 `template.json` schema

One shared schema, three filled-in instances — this keeps the grading code path identical regardless of which template is loaded (no `if template_id == "100q"` branching).

```json
{
  "template_id": "50q_a4",
  "page": { "width_mm": 210, "height_mm": 297, "dpi": 300 },
  "fiducials": {
    "corners": [
      { "id": "top_left", "x": 0, "y": 0 },
      { "id": "top_right", "x": 0, "y": 0 },
      { "id": "bottom_left", "x": 0, "y": 0 },
      { "id": "bottom_right", "x": 0, "y": 0 }
    ],
    "mid_markers": [
      { "id": "col2_top", "x": 0, "y": 0 },
      { "id": "col3_top", "x": 0, "y": 0 }
    ]
  },
  "text_fields": [
    { "id": "name", "x": 0, "y": 0, "width": 0, "height": 0, "cell_count": 15 },
    { "id": "date", "x": 0, "y": 0, "width": 0, "height": 0, "cell_count": 8 },
    {
      "id": "section",
      "x": 0,
      "y": 0,
      "width": 0,
      "height": 0,
      "cell_count": 6
    }
  ],
  "answer_grid": {
    "question_count": 50,
    "choices": ["A", "B", "C", "D", "E"],
    "columns": [
      { "origin_x": 0, "origin_y": 0, "question_start": 1, "question_end": 17 },
      {
        "origin_x": 0,
        "origin_y": 0,
        "question_start": 18,
        "question_end": 34
      },
      { "origin_x": 0, "origin_y": 0, "question_start": 35, "question_end": 50 }
    ],
    "row_spacing": 0,
    "choice_spacing": 0,
    "bubble_radius": 0
  }
}
```

**Design notes:**

- `mid_markers` is an array — empty for the 20q template, populated for 50q/100q. Grading code always checks `fiducials.corners` first, then optionally validates against `mid_markers` if present.
- `columns` is an array with explicit `question_start`/`question_end` rather than an assumed fixed count-per-column, so the same grid-mapping function handles 2, 3, or 4 columns without hardcoding.
- Coordinates should be stored in millimeters or template-relative fractions (0.0–1.0), not raw pixels — pixel coordinates only make sense at one fixed scan DPI, while mm/fractional coordinates survive a change in scan resolution unchanged.
- **Generate, don't hand-write** — a single Python function taking `(question_count, columns)` should compute both the fiducial/grid positions _and_ the printable template PNG from one shared source of truth, so the two artifacts structurally cannot drift out of sync.

---

## 6. Bubble classification logic

Ported and extended from the reference algorithm (Sully Chen's `Automatic-Grading-OpenCV-Python`, MIT licensed), which established the core technique: crop each bubble region, take its mean pixel intensity, and compare the darkest against the second-darkest to catch double-marks.

```python
from enum import Enum

class BubbleResult(Enum):
    FILLED = "filled"
    BLANK = "blank"
    AMBIGUOUS = "ambiguous"
    MULTIPLE = "multiple"

BLANK_THRESHOLD = 200      # mean intensity above this = essentially white, no mark
DOUBLE_MARK_EPSILON = 10   # minimum gap needed to trust a single darkest bubble

def classify_bubbles(means: list[float], choices: list[str]) -> tuple[BubbleResult, str | None]:
    """
    means: mean pixel intensity per bubble, same order as choices
    Returns (classification, selected_choice_or_None)
    """
    sorted_idx = sorted(range(len(means)), key=lambda i: means[i])
    darkest_idx, second_idx = sorted_idx[0], sorted_idx[1]
    darkest_val, second_val = means[darkest_idx], means[second_idx]

    if darkest_val > BLANK_THRESHOLD:
        return BubbleResult.BLANK, None

    if second_val - darkest_val < DOUBLE_MARK_EPSILON:
        return BubbleResult.MULTIPLE, None

    if darkest_val > BLANK_THRESHOLD * 0.7:  # tune against real scans
        return BubbleResult.AMBIGUOUS, choices[darkest_idx]

    return BubbleResult.FILLED, choices[darkest_idx]
```

**What changed from the reference implementation:**

- Returns a typed `BubbleResult` enum plus the selected choice separately, instead of encoding "ambiguous" as a sentinel character (`'?'`) inside the answer list — keeps the database schema clean (`choice: "C", status: "ambiguous"` rather than parsing a sentinel back out downstream).
- Adds a dedicated **`AMBIGUOUS`** band for a single darkest bubble that isn't confidently dark (e.g. a faint pencil mark) — the original only distinguished blank / filled / double-marked, with no concept of "unconfident single mark." This is what meaningfully populates the manual review queue.
- `BLANK_THRESHOLD` and `DOUBLE_MARK_EPSILON` are calibration parameters, not final constants — the original values were tuned to one specific camera/lighting setup. These need re-tuning against real printed-and-scanned AutoQuizGrading sheets before being trusted.

---

## 7. Data model (shape)

**SQLite tables (conceptual):**

| Table          | Key columns                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `tests`        | id, name, template_id, answer_key_ref                                                                        |
| `batches`      | id, test_id, status                                                                                          |
| `scan_jobs`    | id, batch_id, status (pending / processing / needs_review / done)                                            |
| `scan_results` | id, job_id, name_text, date_text, section_text, score, per_question_answers (JSON or child rows), image_path |

**Filesystem layout (conceptual):**

```
/data/tests/{test}/batches/{batch}/
  raw/*.jpg
  processed/*.jpg
  {scan_id}_result.json
```

---

## 8. Status summary

**Settled / locked in:**

- Full tech stack and licensing (all permissive)
- Two-process local architecture (Next.js + FastAPI/Python)
- Hybrid storage (SQLite + filesystem), single-writer pattern
- REST API resource shape
- Ingestion: static image upload only, no camera, no PDF
- Three fixed templates (20 / 50 / 100 questions), full A4 sizing
- Fiducial strategy (corner-only for 20q; corner + mid-page for 50q/100q)
- Student fields: Name / Date / Section, all OCR text regions, no bubble-coded ID
- `template.json` schema (shared shape across all three templates)
- Bubble classification logic design (`filled | blank | ambiguous | multiple`)

**Open — next concrete steps:**

1. **Generate the three `template.json` files** with real pixel/mm coordinates, including mid-page fiducial positions for 50q/100q.
2. **Build a calibration script** — scan a batch of real printed-and-filled sheets, log raw bubble means, use the distribution to set real `BLANK_THRESHOLD` / `AMBIGUOUS` / `DOUBLE_MARK_EPSILON` values instead of guessed defaults.
3. **Port the full grading pipeline to Python 3**, generalizing Sully Chen's hardcoded template constants into the `template.json` structure above.
4. **Wire the classification function into the grid-mapping loop** and test end-to-end against one real scanned sheet per template.
