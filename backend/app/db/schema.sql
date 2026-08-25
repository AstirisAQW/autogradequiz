CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template_id TEXT NOT NULL,
    answer_key_json TEXT NOT NULL,
    question_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER NOT NULL REFERENCES tests(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scan_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    raw_image_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scan_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_job_id INTEGER NOT NULL UNIQUE REFERENCES scan_jobs(id),
    name_text TEXT NOT NULL DEFAULT '',
    date_text TEXT NOT NULL DEFAULT '',
    section_text TEXT NOT NULL DEFAULT '',
    score REAL NOT NULL DEFAULT 0.0,
    answers_json TEXT NOT NULL DEFAULT '[]',
    flags_json TEXT NOT NULL DEFAULT '{}',
    needs_review INTEGER NOT NULL DEFAULT 0,
    processed_image_path TEXT NOT NULL DEFAULT '',
    -- Reserved for a later phase: no grading-failure pipeline exists yet to populate this,
    -- so it always holds its default. See NewScanResult / ScanResultRecord in db/records.py.
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_test_id ON batches(test_id);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_batch_id ON scan_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scan_results_needs_review ON scan_results(needs_review);