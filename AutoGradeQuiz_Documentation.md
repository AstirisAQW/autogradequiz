# AutoGradeQuiz — Design Documentation

AutoGradeQuiz is a local, offline bubble-sheet grading app. The app grades multiple-choice test papers from uploaded photo or scan images. The app does not use a camera. The app does not accept multi-page PDF uploads. The app does not use a bubble-coded student ID field.

---

## 1. Project scope

### 1.1 What the app does

The app is a desktop tool. A user uploads photo or scan images of graded bubble sheets. The app reads each sheet and produces a score.

### 1.2 What the app excludes, and why

| Excluded feature                | Reason                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Live camera capture             | Camera capture adds device permissions, live preview, and glare handling. None of this affects grading logic.                 |
| Multi-page PDF upload           | PDF libraries have mixed licenses. PDF pages also raise a data question: does one page equal one student.                     |
| A bubble-coded student ID grid  | Student identity comes from OCR of the Name field. A second bubble grid adds a second scoring subsystem for no clear benefit. |
| Dynamic, user-defined templates | The app supports three fixed templates. A dynamic template system needs general template-detection logic.                     |

These exclusions keep the pipeline simple. One image goes in. One graded result comes out.

---

## 2. Tech stack

| Layer              | Choice                            | License           | Role                                                             |
| ------------------ | --------------------------------- | ----------------- | ---------------------------------------------------------------- |
| Frontend           | Next.js, TypeScript, Tailwind CSS | MIT               | Upload UI, dashboards, review queue                              |
| Desktop shell      | Tauri                             | MIT or Apache 2.0 | Packages the web frontend as a native local app                  |
| Image processing   | OpenCV, through Python            | Apache 2.0        | Fiducial detection, perspective correction, bubble analysis      |
| OCR                | Tesseract, through `pytesseract`  | Apache 2.0        | Reads the Name, Date, and Section fields                         |
| Backend            | FastAPI                           | MIT               | The local REST API between the frontend and the grading pipeline |
| Structured storage | SQLite                            | Public domain     | Tests, batches, scan jobs, scores                                |
| File storage       | The local filesystem              | —                 | Raw images, processed images, template files                     |
| Ingestion          | Direct image upload, JPEG or PNG  | —                 | One image file per test paper                                    |

Every component uses a permissive license. No dependency in this stack has a copyleft obligation.

### 2.1 Why two processes, not one

Next.js cannot run Python directly. OpenCV.js is a browser-only alternative. It gives less control over pixel-level bubble analysis than native OpenCV. The project runs Next.js and FastAPI as two local processes. The two processes talk over `localhost` through a REST API. Both processes stay local. Neither process needs internet access at runtime.

### 2.2 Storage: a hybrid design

SQLite stores anything the app needs to query, filter, or total. This includes test metadata, batch status, scores, and file paths. The filesystem stores anything that is naturally a file. This includes raw scan images, processed images, and template files. SQLite never stores an image as a blob. It stores the path to that image instead.

Only the FastAPI process writes to SQLite. The frontend only reads. This rule avoids SQLite lock contention between two separate writers.

---

## 3. REST API design

Status: not yet built. This section describes the planned shape.

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

---

## 4. End-to-end pipeline

Status: template generation is done. The grading steps below are not yet built.

```
1. Upload
   The frontend sends a batch of images to the backend.
   The backend assigns the batch to a test.

2. Queue
   Each image becomes a scan job in SQLite with status pending.
   A background worker picks up pending jobs.

3. Preprocess
   Convert the image to grayscale.
   Detect the four corner fiducial marks.
   If the marks are not found, mark the job needs_review and stop.
   Correct the perspective and the skew.

4. Verify mid-page markers
   For the 50-question and 100-question templates, check the mid-page markers.
   If a marker is too far from its expected position, flag the scan for review.

5. Map the grid
   Read the template for this test.
   Map each bubble position onto the corrected image.

6. Classify each bubble
   Measure the fill ratio inside each bubble.
   Classify the result as filled, blank, ambiguous, or multiple.

7. Read the text fields
   Run Tesseract on the Name, Date, and Section fields as whole regions.
   Tesseract reads full words, not single characters.

8. Score
   Compare each filled bubble against the answer key.
   Compute the raw score.
   Track blank answers and wrong answers as separate counts.

9. Store and show
   Save the scan result to SQLite and the filesystem.
   Show the batch summary and the review queue in the frontend.

10. Manual review
    A person resolves any flagged scan.
    The correction updates the score.
```

---

## 5. Template design

### 5.1 Paper size

All three templates use full A4 paper. An early design used smaller paper for the 20-question template. A review of real ZipGrade templates showed a better rule: keep bubble size constant and add columns as question count grows. Small paper makes bubbles small. Small bubbles are harder to detect. Full A4 avoids this.

| Template      | Layout                              |
| ------------- | ----------------------------------- |
| 20 questions  | Two columns                         |
| 50 questions  | Five column blocks, some stacked    |
| 100 questions | Ten column blocks, stacked in pairs |

### 5.2 Fiducial marks

The 20-question template uses four corner marks only. Question density is low. Error from a single global perspective correction stays small.

The 50-question and 100-question templates add mid-page marks between column blocks. A dense page can bow or skew locally. A single global correction can miss that local error. The mid-page marks let the pipeline check for local misalignment. A scan with a misaligned mid-marker goes to manual review instead of a silent misread.

### 5.3 Student information fields

The layout places Name in the top left, Date in the top right, and Section below Name. All three fields use whole-field OCR. An earlier design drew a divider line for each expected character. Tesseract reads full words from one field directly. The dividers added visual clutter with no accuracy benefit. The current design removed them.

### 5.4 Single source of truth

Each template starts as a `TemplateSpec` in millimeters. One function converts a `TemplateSpec` into two outputs: the `template.json` file for the grading pipeline and the `sheet.png` file for printing. Both outputs use the same numbers. The two files cannot drift out of sync.

### 5.5 `template.json` shape

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

All coordinates use fractions of the page from 0.0 to 1.0. A fraction stays correct if the scan resolution changes. A raw pixel value does not.

---

## 6. Bubble classification design

Status: not yet built. This section describes the planned design.

### 6.1 The fill-ratio method

An old design measured the average pixel intensity in a rectangle around each bubble. That method mixes two signals: how dark a mark is and how much of the bubble it covers. The planned design measures fill ratio instead:

```
fill_ratio = count of dark pixels inside a circular mask / total pixel count inside that mask
```

The mask matches the true bubble shape. The mask also extends a small margin past the printed circle. Real pencil or pen marks often bleed past the printed line.

### 6.2 Classification bands

| Fill ratio                                       | Result                                            |
| ------------------------------------------------ | ------------------------------------------------- |
| Near 0 percent                                   | Blank                                             |
| A low-to-mid band                                | Ambiguous, most often an incomplete or light fill |
| High, and clearly the only high value in the row | Filled                                            |
| Two or more bubbles both land in the high band   | Multiple                                          |

An incomplete fill, a light pencil mark, or a non-circular mark like an X or a checkmark all land between fully blank and fully filled. The fill-ratio method puts these marks in the ambiguous band. It does not force a guess. A person reviews ambiguous results in the manual review queue.

### 6.3 Blank and wrong stay separate

A scoring report tracks three counts per question: correct, wrong, and blank. A teacher reading a class report needs to see that twelve students left question seven blank. They should not see one merged count of twelve wrong answers. The distinction has the same score impact but a different classroom meaning.

---

## 7. Accuracy testing

Status: not yet built. This section describes the planned approach.

### 7.1 Synthetic test sheets

A generator uses the same bubble coordinates the renderer knows. It draws marks onto a rendered sheet at known positions. Each generated sheet has its own known-correct answer key.

The generator makes different fill defects on purpose:

1. A perfect, fully dark fill.
2. An incomplete fill at a reduced radius.
3. A faint, gray fill.
4. An off-center fill.
5. A non-circular mark, such as an X or a scribble.
6. A stray mark away from any bubble.
7. No mark at all, for the blank case.
8. Two marks in one row, for the multiple case.

The generator also adds scan and photo defects: slight rotation, blur, brightness change, and JPEG compression noise.

### 7.2 The test harness

The harness runs every synthetic sheet through the grading pipeline. It compares the result against the known ground truth. The harness reports:

1. Precision and recall for each of the four bubble classes.
2. A confusion matrix for the four classes.
3. End-to-end score accuracy against the expected score.

### 7.3 Real-sheet calibration

Synthetic defects cover known error types. Real paper, real pencil marks, and real camera sensors have errors that a synthetic generator will not predict. The plan is to use fifteen to twenty hand-filled, hand-scored real sheets. These will be scanned or photographed. This will calibrate the classification thresholds against real data before the thresholds ship as defaults.

---

## 8. Data model

### 8.1 SQLite tables

| Table          | Key columns                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `tests`        | id, name, template_id, answer_key_json, question_count                                             |
| `batches`      | id, test_id, status                                                                                |
| `scan_jobs`    | id, batch_id, raw_image_path, status                                                               |
| `scan_results` | id, scan_job_id, name_text, date_text, section_text, score, answers_json, flags_json, needs_review |

### 8.2 Filesystem layout

```
backend/data/
├── autograde.db
└── templates/
    ├── 20q_a4/{template.json, sheet.png}
    ├── 50q_a4/{template.json, sheet.png}
    └── 100q_a4/{template.json, sheet.png}
```

---

## 9. Status summary

**Done:**

1. Tech stack and licensing review.
2. The two-process local architecture.
3. The hybrid storage design.
4. The SQLite schema and repository layer, with tests.
5. The three template specs, generated from one shared source.
6. `template.json` and `sheet.png` generation, verified by rendering and visual review.

**Not done, in planned order:**

1. The grading pipeline: preprocessing, fiducial detection, grid mapping, bubble classification, OCR, and scoring.
2. The fill-ratio bubble classifier.
3. Whole-field OCR for the Name, Date, and Section fields.
4. The synthetic accuracy-testing harness.
5. Real-sheet threshold calibration.
6. The REST API layer.
7. The frontend upload UI, dashboard, and review queue.
