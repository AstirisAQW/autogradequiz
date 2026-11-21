import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  addFailedPaper,
  addPaper,
  deleteBatch,
  deletePaper,
  deleteQuiz,
  deleteSection,
  deleteStudent,
  EXPORT_VERSION,
  exportBatchCsv,
  exportWorkspace,
  generateUniqueStudentCode,
  getClassDetail,
  getPaperImageUrl,
  getPaperSnapshot,
  getQuizWorkspace,
  getReviewQueue,
  getRoster,
  getStudentDetail,
  importWorkspace,
  listClassSummaries,
  listQuizzes,
  replacePaperResult,
  restorePaperSnapshot,
  saveBatch,
  saveQuiz,
  saveSection,
  saveStudent,
  submitReview,
  type StatelessGradeResult,
} from "./workspace/index.ts";
import { DB_NAME } from "./workspace/schema.ts";
import { parseAndValidateWorkspaceExport } from "./workspace/serialize.ts";
import { closeDb, getDb } from "./workspace/store.ts";

function makeGradeResult(
  overrides: Partial<StatelessGradeResult> = {},
): StatelessGradeResult {
  return {
    answers: ["A", "A", "C", "D"],
    flags: {},
    confidence: [0.9, 0.4, 0.9, 0.9],
    score: 100,
    needs_review: false,
    name_text: "Ada Lovelace",
    date_text: "2026-11-17",
    section_text: "10-Einstein",
    ...overrides,
  };
}

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

test("saveQuiz validates answerKey/points and rescores papers on key change while keeping corrections", async () => {
  await assert.rejects(
    () =>
      saveQuiz({
        name: "Bad Quiz",
        templateId: "20q_a4",
        questionCount: 4,
        answerKey: ["A", "B", "C", "D"],
        points: [1, 2],
      }),
    /Expected 4 point values, got 2\./,
  );

  await assert.rejects(
    () =>
      saveQuiz({
        name: "Bad Choice",
        templateId: "20q_a4",
        questionCount: 2,
        answerKey: ["A", "Z"],
      }),
    /Answer choices must be in/,
  );

  const quiz = await saveQuiz({
    name: "Quiz 1",
    templateId: "20q_a4",
    questionCount: 4,
    answerKey: ["b+a", "B", "C", "D"],
  });
  assert.deepEqual(quiz.answerKey, ["A+B", "B", "C", "D"]);

  const batch = await saveBatch({ quizId: quiz.id });
  const paper = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "A", "C", "D"],
      flags: { "2": "ambiguous" },
      score: 75,
      needs_review: true,
    }),
    new Blob(["jpeg-bytes"], { type: "image/jpeg" }),
  );

  const reviewed = await submitReview(paper.id, { corrections: { 2: "B" } });
  assert.equal(reviewed.score, 100);
  assert.equal(reviewed.needsReview, false);

  await saveQuiz({
    id: quiz.id,
    name: "Quiz 1",
    templateId: quiz.templateId,
    questionCount: 4,
    answerKey: ["D", "B", "C", "D"],
  });

  const ws = await getQuizWorkspace(quiz.id, batch.id);
  assert.ok(ws);
  assert.equal(ws.papers[0].score, 75);
  assert.deepEqual(ws.papers[0].corrections, { 2: "B" });
  assert.equal(ws.papers[0].needsReview, false);
});

test("saveQuiz skips failed papers and leaves scores untouched when key is unchanged", async () => {
  const quiz = await saveQuiz({
    name: "Stable Quiz",
    templateId: "20q_a4",
    questionCount: 4,
    answerKey: ["A", "B", "C", "D"],
  });
  const batch = await saveBatch({ quizId: quiz.id });

  const donePaper = await addPaper(
    batch.id,
    makeGradeResult({ answers: ["A", "B", "C", "D"], score: 42 }),
    new Blob(["done-img"], { type: "image/jpeg" }),
  );
  const failedPaper = await addFailedPaper(batch.id, "Corners not found");

  await saveQuiz({
    id: quiz.id,
    name: "Stable Quiz Renamed",
    templateId: quiz.templateId,
    questionCount: 4,
    answerKey: ["A", "B", "C", "D"],
  });
  let ws = await getQuizWorkspace(quiz.id, batch.id);
  assert.equal(
    ws?.papers.find((p) => p.id === donePaper.id)?.score,
    42,
  );

  await saveQuiz({
    id: quiz.id,
    name: "Stable Quiz Renamed",
    templateId: quiz.templateId,
    questionCount: 4,
    answerKey: ["E", "B", "C", "D"],
  });
  ws = await getQuizWorkspace(quiz.id, batch.id);
  const afterDone = ws?.papers.find((p) => p.id === donePaper.id);
  const afterFailed = ws?.papers.find((p) => p.id === failedPaper.id);
  assert.equal(afterDone?.score, 75);
  assert.equal(afterFailed?.status, "failed");
  assert.equal(afterFailed?.score, 0);
  assert.equal(afterFailed?.error, "Corners not found");
});

test("stale preferredBatchId falls back to latest batch using strictly increasing createdAt", async () => {
  const quiz = await saveQuiz({
    name: "Fallback Quiz",
    templateId: "20q_a4",
    questionCount: 2,
    answerKey: ["A", "B"],
  });
  const b1 = await saveBatch({ quizId: quiz.id });
  const b2 = await saveBatch({ quizId: quiz.id });
  assert.ok(b2.createdAt > b1.createdAt);

  const ws = await getQuizWorkspace(quiz.id, "non-existent-batch-id");
  assert.ok(ws);
  assert.equal(ws.activeBatch?.id, b2.id);

  await deleteBatch(b2.id);
  const wsAfterDelete = await getQuizWorkspace(quiz.id, b2.id);
  assert.ok(wsAfterDelete);
  assert.equal(wsAfterDelete.activeBatch?.id, b1.id);
});

test("deletePaper, deleteBatch, and deleteQuiz remove aligned images", async () => {
  const quiz = await saveQuiz({
    name: "Cascade Quiz",
    templateId: "20q_a4",
    questionCount: 2,
    answerKey: ["A", "B"],
  });
  const b1 = await saveBatch({ quizId: quiz.id });
  const b2 = await saveBatch({ quizId: quiz.id });

  const p0 = await addPaper(
    b1.id,
    makeGradeResult({ answers: ["A", "B"], score: 100 }),
    new Blob(["img0"], { type: "image/jpeg" }),
  );
  const p1 = await addPaper(
    b1.id,
    makeGradeResult({ answers: ["A", "B"], score: 100 }),
    new Blob(["img1"], { type: "image/jpeg" }),
  );
  const p2 = await addPaper(
    b2.id,
    makeGradeResult({ answers: ["A", "B"], score: 100 }),
    new Blob(["img2"], { type: "image/jpeg" }),
  );

  await deletePaper(p0.id);
  const db = await getDb();
  assert.equal(await db.get("papers", p0.id), undefined);
  assert.equal(await db.get("paperImages", p0.id), undefined);
  assert.equal(await getPaperImageUrl(p0.id), null);

  await deleteBatch(b1.id);
  assert.equal(await db.get("papers", p1.id), undefined);
  assert.equal(await db.get("paperImages", p1.id), undefined);
  assert.ok(await db.get("papers", p2.id));

  await deleteQuiz(quiz.id);
  assert.equal(await db.get("quizzes", quiz.id), undefined);
  assert.equal(await db.get("batches", b2.id), undefined);
  assert.equal(await db.get("papers", p2.id), undefined);
  assert.equal(await db.get("paperImages", p2.id), undefined);
});

test("submitReview validates question range and choices, and replacePaperResult preserves corrections and identity", async () => {
  const quiz = await saveQuiz({
    name: "Regrade Quiz",
    templateId: "20q_a4",
    questionCount: 4,
    answerKey: ["A", "B", "C", "D"],
  });
  const batch = await saveBatch({ quizId: quiz.id });

  const failed = await addFailedPaper(
    batch.id,
    "Blurry image",
    new Blob(["raw"], { type: "image/jpeg" }),
  );
  await assert.rejects(
    () => submitReview(failed.id, { corrections: { 1: "A" } }),
    /Cannot review paper/,
  );

  const paper = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "A", "C", "D"],
      flags: { "2": "ambiguous" },
      score: 75,
      needs_review: true,
      name_text: "OCR Name",
      date_text: "",
      section_text: "10-A",
    }),
    new Blob(["v1"], { type: "image/jpeg" }),
  );

  // Out of range question numbers (0 and 5)
  await assert.rejects(
    () => submitReview(paper.id, { corrections: { 0: "A" } }),
    /Question number 0 out of range\./,
  );
  await assert.rejects(
    () => submitReview(paper.id, { corrections: { 5: "A" } }),
    /Question number 5 out of range\./,
  );
  // Invalid choices
  await assert.rejects(
    () => submitReview(paper.id, { corrections: { 2: "F" } }),
    /Invalid correction choice "F"\./,
  );
  await assert.rejects(
    () => submitReview(paper.id, { corrections: { 2: "A+B" } }),
    /Invalid correction choice "A\+B"\./,
  );

  assert.equal((await getReviewQueue()).length, 1);
  // Blank "" is allowed and clears the flag
  const blankCleared = await submitReview(paper.id, { corrections: { 2: "" } });
  assert.equal(blankCleared.needsReview, false);
  assert.equal((await getReviewQueue()).length, 0);
  assert.equal(blankCleared.score, 75);

  const stu = await saveStudent({
    studentCode: "S-1",
    firstName: "Ada",
    lastName: "Lovelace",
  });
  await submitReview(paper.id, {
    corrections: { 2: "B" },
    identity: { nameText: "Hand Edited", studentId: stu.id },
  });

  const replaced = await replacePaperResult(
    paper.id,
    makeGradeResult({
      answers: ["E", "A", "C", "D"],
      flags: { "2": "ambiguous" },
      score: 50,
      needs_review: true,
      name_text: "New OCR Name",
      date_text: "2026-12-01",
      section_text: "10-B",
    }),
    new Blob(["v2"], { type: "image/jpeg" }),
  );

  assert.equal(replaced.status, "done");
  assert.equal(replaced.studentId, stu.id);
  assert.equal(replaced.nameText, "Hand Edited");
  assert.equal(replaced.dateText, "2026-12-01");
  assert.equal(replaced.sectionText, "10-A");
  assert.deepEqual(replaced.corrections, { 2: "B" });
  assert.equal(replaced.score, 75);
  assert.equal(replaced.needsReview, false);
});

test("sections and students: uniqueness, student link/unlink name behavior, and delete effects", async () => {
  const sec1 = await saveSection({ name: "10-Curie", term: "Fall 2026" });
  assert.equal(sec1.studentCount, 0);
  await assert.rejects(
    () => saveSection({ name: "10-Curie" }),
    /Section '10-Curie' already exists\./,
  );
  await assert.rejects(
    () => saveSection({ name: "10-curie" }),
    /Section '10-curie' already exists\./,
  );

  const stu = await saveStudent({
    studentCode: "1042",
    firstName: "Ada",
    lastName: "Lovelace",
    sectionIds: [sec1.id],
  });
  await assert.rejects(
    () =>
      saveStudent({
        studentCode: "1042",
        firstName: "Other",
        lastName: "Person",
      }),
    /Student code '1042' already exists\./,
  );
  await assert.rejects(
    () =>
      saveStudent({
        studentCode: "10-42",
        firstName: "Other",
        lastName: "Person",
      }),
    /Student code '10-42' already exists\./,
  );

  let roster = await getRoster();
  assert.equal(roster.sections[0].studentCount, 1);

  const quiz = await saveQuiz({
    name: "Roster Quiz",
    templateId: "20q_a4",
    questionCount: 2,
    answerKey: ["A", "B"],
  });
  const batch = await saveBatch({ quizId: quiz.id, sectionId: sec1.id });
  const paper = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "B"],
      score: 100,
      needs_review: false,
      name_text: "",
    }),
    new Blob(["p"], { type: "image/jpeg" }),
  );

  // Linking student when paper.nameText is empty populates "Last, First"
  const linked = await submitReview(paper.id, {
    identity: { studentId: stu.id },
  });
  assert.equal(linked.studentId, stu.id);
  assert.equal(linked.nameText, "Lovelace, Ada");

  // Linking student when OCR already filled nameText keeps the OCR nameText
  const ocrNamedPaper = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "B"],
      score: 100,
      needs_review: false,
      name_text: "OCR Existing Name",
    }),
    new Blob(["p2"], { type: "image/jpeg" }),
  );
  const linkedWithExistingOcr = await submitReview(ocrNamedPaper.id, {
    identity: { studentId: stu.id },
  });
  assert.equal(linkedWithExistingOcr.studentId, stu.id);
  assert.equal(linkedWithExistingOcr.nameText, "OCR Existing Name");

  // Unlinking sets studentId to null and keeps the current nameText
  const unlinked = await submitReview(paper.id, {
    identity: { studentId: null },
  });
  assert.equal(unlinked.studentId, null);
  assert.equal(unlinked.nameText, "Lovelace, Ada");

  // Relink, then deleteStudent -> paper.studentId becomes null, paper.nameText & score stay
  await submitReview(paper.id, { identity: { studentId: stu.id } });
  await deleteStudent(stu.id);
  let ws = await getQuizWorkspace(quiz.id, batch.id);
  assert.equal(ws?.papers[0].studentId, null);
  assert.equal(ws?.papers[0].nameText, "Lovelace, Ada");
  assert.equal(ws?.papers[0].score, 100);

  // deleteSection -> batch.sectionId becomes null, papers keep their grade
  await deleteSection(sec1.id);
  ws = await getQuizWorkspace(quiz.id, batch.id);
  assert.equal(ws?.activeBatch?.sectionId, null);
  assert.equal(ws?.papers[0].score, 100);
  roster = await getRoster();
  assert.equal(roster.sections.length, 0);
});

test("exportBatchCsv matches backend column order, UTF-8 BOM, float score, quoting, and formula escaping", async () => {
  const quiz = await saveQuiz({
    name: "CSV Quiz",
    templateId: "20q_a4",
    questionCount: 3,
    answerKey: ["A", "B", "C"],
  });
  const batch = await saveBatch({ quizId: quiz.id });

  const p1 = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "D", "C"],
      flags: { "2": "ambiguous" },
      confidence: [0.9, 0.3, 0.9],
      score: 66.67,
      needs_review: true,
      name_text: "=SUM(A1:A2)",
      date_text: "+2026-11-17",
      section_text: "@Sec",
    }),
    new Blob(["img"], { type: "image/jpeg" }),
  );
  await submitReview(p1.id, { corrections: { 2: "B" } });

  await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "E", "E"],
      flags: {},
      confidence: [0.9, 0.9, 0.9],
      score: 5.0,
      needs_review: false,
      name_text: "Doe, Jane",
      date_text: "2026-11-17",
      section_text: "10-A",
    }),
    new Blob(["img2"], { type: "image/jpeg" }),
  );

  await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "B", "C"],
      flags: {},
      confidence: [0.9, 0.9, 0.9],
      score: 100.0,
      needs_review: false,
      name_text: 'Ada "Countess" Lovelace',
      date_text: "2026-11-17",
      section_text: "10-A",
    }),
    new Blob(["img3"], { type: "image/jpeg" }),
  );

  await addFailedPaper(batch.id, "Unreadable");

  const csvBlob = await exportBatchCsv(batch.id);
  const rawBytes = new Uint8Array(await csvBlob.arrayBuffer());
  // Starts with UTF-8 BOM (0xEF, 0xBB, 0xBF)
  assert.deepEqual(
    Array.from(rawBytes.slice(0, 3)),
    [0xef, 0xbb, 0xbf],
  );

  const text = (await csvBlob.text()).replace(/^\uFEFF/, "");
  const lines = text.trimEnd().split(/\r?\n/);

  assert.equal(lines[0], "name,date,section,score,needs_review,q1,q2,q3");
  assert.equal(
    lines[1],
    "'=SUM(A1:A2),'+2026-11-17,'@Sec,100.0,False,A,B,C",
  );
  assert.equal(
    lines[2],
    '"Doe, Jane",2026-11-17,10-A,5.0,False,A,E,E',
  );
  assert.equal(
    lines[3],
    '"Ada ""Countess"" Lovelace",2026-11-17,10-A,100.0,False,A,B,C',
  );
  assert.equal(lines[4], ",,,0.0,False,,,");
});

test("exportWorkspace and importWorkspace round-trip with and without images, and failed import leaves data intact", async () => {
  const sec = await saveSection({ name: "10-Bohr", term: "2026" });
  const stu = await saveStudent({
    studentCode: "2001",
    firstName: "Niels",
    lastName: "Bohr",
    sectionIds: [sec.id],
  });
  const quiz = await saveQuiz({
    name: "Export Quiz",
    templateId: "20q_a4",
    questionCount: 2,
    answerKey: ["A", "B"],
    points: [2, 1],
  });
  const batch = await saveBatch({ quizId: quiz.id, sectionId: sec.id });
  const imgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const paper = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "C"],
      flags: { "2": "ambiguous" },
      confidence: [0.9, 0.2],
      score: 66.67,
      needs_review: true,
    }),
    new Blob([imgBytes], { type: "image/jpeg" }),
  );
  await submitReview(paper.id, {
    corrections: { 2: "B" },
    identity: { studentId: stu.id },
  });

  const withImagesBlob = await exportWorkspace({ includeImages: true });
  const withoutImagesBlob = await exportWorkspace({ includeImages: false });
  const basePayload = JSON.parse(await withImagesBlob.text());

  // Verify every rejection case leaves existing data intact
  const invalidPayloads: [string, RegExp][] = [
    ["{not-json", /Invalid JSON/],
    ["[]", /must be a JSON object/],
    [
      JSON.stringify({ ...basePayload, exportVersion: EXPORT_VERSION + 1 }),
      /Unsupported exportVersion/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        quizzes: [...basePayload.quizzes, basePayload.quizzes[0]],
      }),
      /Duplicate quiz id/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        papers: [{ ...basePayload.papers[0], batchId: "missing-batch" }],
      }),
      /references missing batch/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        batches: [{ ...basePayload.batches[0], quizId: "missing-quiz" }],
      }),
      /references missing quiz/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        quizzes: [{ ...basePayload.quizzes[0], answerKey: ["A", "Z"] }],
      }),
      /Answer choices must be in/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        papers: [
          { ...basePayload.papers[0], corrections: { 99: "A" } },
        ],
      }),
      /Question number 99 out of range/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        papers: [
          { ...basePayload.papers[0], flags: { "1": "bad-reason" } },
        ],
      }),
      /Invalid flag/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        papers: [{ ...basePayload.papers[0], answers: "not-an-array" }],
      }),
      /answers must be an array/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        papers: [{ ...basePayload.papers[0], answers: ["A"] }],
      }),
      /answers length \(1\) does not match quiz question count \(2\)/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        papers: [{ ...basePayload.papers[0], answers: ["A", "Z"] }],
      }),
      /Answer choices must be in/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        papers: [{ ...basePayload.papers[0], score: "100" }],
      }),
      /score must be a finite number/,
    ],
    [
      JSON.stringify({
        ...basePayload,
        images: { [paper.id]: "!!!not-base64!!!" },
      }),
      /Invalid base64/,
    ],
  ];

  for (const [badJson, regex] of invalidPayloads) {
    assert.throws(() => parseAndValidateWorkspaceExport(badJson), regex);
    await assert.rejects(() => importWorkspace(badJson), regex);
  }

  // Existing workspace is still intact after all failed imports
  assert.equal((await listQuizzes()).length, 1);
  assert.ok(await getPaperImageUrl(paper.id));

  // Round-trip without images (and tamper with score in JSON to prove rescore() recomputes it)
  const tamperedWithoutImages = JSON.stringify({
    ...JSON.parse(await withoutImagesBlob.text()),
    papers: [{ ...basePayload.papers[0], score: 12.5, needsReview: true }],
  });
  await importWorkspace(tamperedWithoutImages);
  assert.equal((await listQuizzes())[0].name, "Export Quiz");
  assert.equal(await getPaperImageUrl(paper.id), null);
  const recomputedWs = await getQuizWorkspace(quiz.id, batch.id);
  assert.equal(recomputedWs?.papers[0].score, 100);
  assert.equal(recomputedWs?.papers[0].needsReview, false);

  // Round-trip with images restores the JPEG blob
  await importWorkspace(withImagesBlob);
  const restoredWs = await getQuizWorkspace(quiz.id, batch.id);
  assert.equal(restoredWs?.papers[0].score, 100);
  assert.equal(restoredWs?.papers[0].studentId, stu.id);
  const db = await getDb();
  const imgRec = await db.get("paperImages", paper.id);
  assert.ok(imgRec);
  assert.deepEqual(
    new Uint8Array(await imgRec.blob.arrayBuffer()),
    imgBytes,
  );
});

test("student_id_text auto-links on addPaper and retroactively on saveStudent, and paper snapshots restore after delete", async () => {
  const quiz = await saveQuiz({
    name: "AutoLink Quiz",
    templateId: "20q_a4",
    questionCount: 2,
    answerKey: ["A", "B"],
    points: [2, 3],
  });
  const batch = await saveBatch({ quizId: quiz.id });

  // 1. Upload paper before student exists -> unlinked, stores studentIdText
  const p1 = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "C"],
      flags: { "2": "ambiguous" },
      confidence: [0.95, 0.2],
      score: 40,
      needs_review: true,
      name_text: "",
      student_id_text: "0123456789",
    }),
    new Blob(["img1"], { type: "image/jpeg" }),
  );
  assert.equal(p1.studentId, null);
  assert.equal(p1.studentIdText, "0123456789");

  // 2. Adding matching student retroactively links p1 and fills nameText
  const stu = await saveStudent({
    studentCode: "0123456789",
    firstName: "Juan",
    lastName: "Dela Cruz",
  });
  const queue = await getReviewQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].studentId, stu.id);
  assert.equal(queue[0].nameText, "Dela Cruz, Juan");
  assert.equal(queue[0].earnedPoints, 2);
  assert.equal(queue[0].totalPoints, 5);

  // 3. Uploading paper when student already exists auto-links immediately
  const p2 = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "B"],
      flags: {},
      confidence: [0.95, 0.95],
      score: 100,
      needs_review: false,
      name_text: "",
      student_id_text: "0123-456-789",
    }),
    new Blob(["img2"], { type: "image/jpeg" }),
  );
  assert.equal(p2.studentId, stu.id);
  assert.equal(p2.nameText, "Dela Cruz, Juan");

  // 4. Snapshot and restore after deletePaper
  const snap = await getPaperSnapshot(p2.id);
  assert.ok(snap);
  await deletePaper(p2.id);
  assert.equal(await getPaperImageUrl(p2.id), null);
  await restorePaperSnapshot(snap);
  assert.ok(await getPaperImageUrl(p2.id));
});

test("Feature C: addPaper and submitReview auto-create and sync sections and students", async () => {
  const quiz = await saveQuiz({
    name: "AutoSync Quiz",
    templateId: "20q_a4",
    questionCount: 2,
    answerKey: ["A", "B"],
  });
  const batch = await saveBatch({ quizId: quiz.id });

  // 1. New student + section from scanned sheet creates Section + Student and links paper & batch
  const p1 = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["A", "B"],
      score: 100,
      needs_review: false,
      name_text: "Dela Cruz, Juan",
      student_id_text: "0123456789",
      section_text: "10-Rizal",
    }),
    new Blob(["scan1"], { type: "image/jpeg" }),
    { id: "custom-paper-id-1" },
  );
  assert.equal(p1.id, "custom-paper-id-1");
  assert.ok(p1.studentId !== null);

  let roster = await getRoster();
  assert.equal(roster.sections.length, 1);
  assert.equal(roster.sections[0].name, "10-Rizal");
  assert.equal(roster.students.length, 1);
  assert.equal(roster.students[0].firstName, "Juan");
  assert.equal(roster.students[0].lastName, "Dela Cruz");
  assert.equal(roster.students[0].studentCode, "0123456789");
  assert.deepEqual(roster.students[0].sectionIds, [roster.sections[0].id]);

  const ws = await getQuizWorkspace(quiz.id, batch.id);
  assert.equal(ws?.activeBatch?.sectionId, roster.sections[0].id);
  assert.equal(ws?.allPapers.length, 1);

  // 2. Second upload for same student ID with blank name/section fills from roster; new section enrolls
  const batch2 = await saveBatch({ quizId: quiz.id });
  const p2 = await addPaper(
    batch2.id,
    makeGradeResult({
      answers: ["A", "C"],
      flags: { "2": "ambiguous" },
      score: 50,
      needs_review: true,
      name_text: "",
      student_id_text: "0123456789",
      section_text: "",
    }),
    new Blob(["scan2"], { type: "image/jpeg" }),
  );
  assert.equal(p2.studentId, roster.students[0].id);
  assert.equal(p2.nameText, "Dela Cruz, Juan");
  assert.equal(p2.sectionText, "10-Rizal");

  // 3. Reviewing and saving new identity fields updates student & creates new section, while explicit unlink does not recreate
  await submitReview(p2.id, {
    identity: {
      nameText: "Dela Cruz, Juan M.",
      sectionText: "10-Mabini",
    },
  });
  roster = await getRoster();
  assert.equal(roster.sections.length, 2);
  assert.equal(roster.students[0].firstName, "Juan M.");
  assert.equal(roster.students[0].sectionIds.length, 2);

  // Explicit unlink leaves roster intact and only sets studentId to null
  const unlinked = await submitReview(p2.id, { identity: { studentId: null } });
  assert.equal(unlinked.studentId, null);
  roster = await getRoster();
  assert.equal(roster.students.length, 1);
});

test("ZipGrade features: Quiz metadata, key versions, partial rules, class/student details, and auto student codes", async () => {
  const sec = await saveSection({ name: "ClassTest" });
  const stu = await saveStudent({
    studentCode: generateUniqueStudentCode([]),
    firstName: "Juan",
    lastName: "DelaCruz",
    sectionIds: [sec.id],
  });
  assert.match(stu.studentCode, /^\d{5}$/);
  assert.notEqual(generateUniqueStudentCode([stu]), stu.studentCode);

  const quiz = await saveQuiz({
    name: "Midterm Exam",
    templateId: "20q_a4",
    date: "2026-11-20",
    folder: "Biology",
    sectionIds: [sec.id],
    tags: ["Unit 1", "Cells"],
    questionCount: 2,
    answerKey: ["A", "B"],
    points: [2, 1],
    questionRules: [
      {
        alternateAnswers: [{ choice: "C", points: 1 }],
        incorrectPoints: -0.5,
        tags: ["Cells"],
      },
      { tags: ["Lab"] },
    ],
    keyVersions: {
      B: {
        answerKey: ["E", "D"],
        points: [2, 1],
        questionRules: [{ incorrectPoints: -0.5, tags: ["Cells"] }, { tags: ["Lab"] }],
      },
    },
  });

  const batch = await saveBatch({ quizId: quiz.id, sectionId: sec.id });
  const p = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["E", "D"],
      flags: { "2": "ambiguous" },
      score: 66.7,
      needs_review: true,
      key_version: "B",
      key_version_detected: "B",
      name_text: "DelaCruz, Juan",
      section_text: "ClassTest",
      student_id_text: stu.studentCode,
    }),
    new Blob(["kv-b"], { type: "image/jpeg" }),
  );
  assert.equal(p.keyVersion, "B");
  assert.equal(p.detectedKeyVersion, "B");

  const queue = await getReviewQueue();
  assert.deepEqual(queue[0].answerKey, ["E", "D"]);
  assert.deepEqual(queue[0].availableKeyVersions, ["A", "B"]);

  // Resolve Q2 as D under Key B -> 3/3 = 100%, then switch paper to Key A (E wrong -0.5, D wrong 0 => -0.5/3)
  const resolved = await submitReview(p.id, { corrections: { 2: "D" } });
  assert.equal(resolved.score, 100);
  const switched = await submitReview(p.id, { keyVersion: "A" });
  assert.equal(switched.keyVersion, "A");
  assert.ok(switched.score < 0);

  const classSummaries = await listClassSummaries();
  assert.equal(classSummaries[0].quizCount, 1);
  assert.equal(classSummaries[0].studentCount, 1);

  const classDetail = await getClassDetail(sec.id);
  assert.equal(classDetail?.students.length, 1);
  assert.equal(classDetail?.quizzes.length, 1);

  const studentDetail = await getStudentDetail(stu.id);
  assert.equal(studentDetail?.sections[0].name, "ClassTest");
  assert.equal(studentDetail?.gradedPapers.length, 1);

  // Round-trip preserve metadata
  const exported = await exportWorkspace({ includeImages: false });
  await deleteSection(sec.id);
  await importWorkspace(await exported.text());
  const roundTripped = (await listQuizzes())[0];
  assert.equal(roundTripped.folder, "Biology");
  assert.equal(roundTripped.date, "2026-11-20");
  assert.ok(roundTripped.keyVersions?.B);
});

test("keyVersionFlagged requires review until confirmed and Key B rules stay isolated across import", async () => {
  const quiz = await saveQuiz({
    name: "MultiKey Quiz",
    templateId: "20q_a4",
    questionCount: 2,
    answerKey: ["A", "A"],
    points: [2, 2],
    questionRules: [{ alternateAnswers: [{ choice: "B", points: 1 }] }, {}],
    keyVersions: {
      B: { answerKey: ["C", "C"], points: [2, 2] },
    },
  });
  const batch = await saveBatch({ quizId: quiz.id });

  // Detected undefined Key "C" on A+B quiz triggers keyVersionFlagged + needsReview
  const flaggedPaper = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["C", "C"],
      flags: {},
      score: 0,
      needs_review: false,
      key_version: "A",
      key_version_detected: "C",
      key_version_flagged: true,
    }),
    new Blob(["c"], { type: "image/jpeg" }),
  );
  assert.equal(flaggedPaper.keyVersionFlagged, true);
  assert.equal(flaggedPaper.needsReview, true);

  const queue = await getReviewQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].keyVersionFlagged, true);

  // Confirming Key B resolves keyVersionFlagged and scores 4/4 = 100%
  const confirmed = await submitReview(flaggedPaper.id, { keyVersion: "B" });
  assert.equal(confirmed.keyVersionFlagged, undefined);
  assert.equal(confirmed.needsReview, false);
  assert.equal(confirmed.score, 100);

  // Key B answering B (which only gives partial credit on Key A) gets 0/4 even after importWorkspace
  const keyBPaper = await addPaper(
    batch.id,
    makeGradeResult({
      answers: ["B", "D"],
      flags: {},
      score: 0,
      needs_review: false,
      key_version: "B",
      key_version_detected: "B",
    }),
    new Blob(["b"], { type: "image/jpeg" }),
  );
  const blob = await exportWorkspace({ includeImages: false });
  // onlyIfEmpty returns false when workspace already has data
  assert.equal(
    await importWorkspace(await blob.text(), { onlyIfEmpty: true }),
    false,
  );
  // Full import keeps Key B isolated from Key A partial rule
  assert.equal(await importWorkspace(await blob.text()), true);
  const reloaded = (await getQuizWorkspace(quiz.id))!;
  const afterImport = reloaded.allPapers.find((p) => p.id === keyBPaper.id)!;
  assert.equal(afterImport.score, 0);
});
