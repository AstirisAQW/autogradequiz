import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import {
  createFolder,
  deleteFolder,
  deletePaper,
  generateUniqueStudentCode,
  getActiveFolder,
  getPaperImageUrl,
  getQuizWorkspace,
  gradeQuizPaper,
  importStudents,
  listFolders,
  renameFolder,
  requireActiveFolder,
  saveQuiz,
  setActiveFolder,
  submitReview,
  validateFolderName,
} from "../src/lib/workspace/index.ts";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  setActiveFolder(null);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setActiveFolder(null);
});

test("activeFolder starts empty and never auto-creates a default folder", () => {
  assert.equal(getActiveFolder(), null);
  assert.throws(
    () => requireActiveFolder(),
    /Select or create a workspace folder first\./,
  );
  setActiveFolder("  Midterm Grade 10  ");
  assert.equal(getActiveFolder(), "Midterm Grade 10");
  assert.equal(requireActiveFolder(), "Midterm Grade 10");
});

test("folder CRUD requests update activeFolder on rename and delete", async () => {
  const calls: { url: string; method: string; body?: string }[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, body });

    if (url.endsWith("/workspace/folders") && method === "GET") {
      return new Response("[]", { status: 200 });
    }
    if (url.endsWith("/workspace/folders") && method === "POST") {
      return new Response(
        JSON.stringify({
          name: "Midterm Grade 10",
          createdAt: "2026-11-22T00:00:00Z",
          lastModified: "2026-11-22T00:00:00Z",
          classCount: 0,
          studentCount: 0,
          quizCount: 0,
          paperCount: 0,
        }),
        { status: 201 },
      );
    }
    if (method === "PATCH") {
      return new Response(
        JSON.stringify({
          name: "Midterm 10",
          createdAt: "2026-11-22T00:00:00Z",
          lastModified: "2026-11-22T00:01:00Z",
          classCount: 0,
          studentCount: 0,
          quizCount: 0,
          paperCount: 0,
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  assert.deepEqual(await listFolders(), []);
  const created = await createFolder("Midterm Grade 10", "Finals Grade 11");
  assert.equal(created.name, "Midterm Grade 10");
  assert.match(calls[1].body ?? "", /"copyRosterFrom":"Finals Grade 11"/);

  setActiveFolder("Midterm Grade 10");
  await renameFolder("Midterm Grade 10", "Midterm 10");
  assert.equal(getActiveFolder(), "Midterm 10");

  await deleteFolder("Midterm 10");
  assert.equal(getActiveFolder(), null);
});

test("saveQuiz, gradeQuizPaper, submitReview, deletePaper, and getPaperImageUrl encode active folder", async () => {
  setActiveFolder("Midterm Grade 10");
  const requests: { url: string; method: string; body: BodyInit | null | undefined }[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body,
    });
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response(
      JSON.stringify({
        id: "id-1",
        quizId: "q-1",
        status: "done",
        answers: ["A"],
        flags: {},
        confidence: [0.95],
        nameText: "Ada",
        dateText: "",
        classText: "",
        studentId: null,
        corrections: {},
        score: 100,
        needsReview: false,
        createdAt: "2026-11-22T00:00:00Z",
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  await saveQuiz({
    name: "Bio 1",
    templateId: "20q_a4",
    answerKey: ["A"],
  });
  await saveQuiz({
    id: "q-1",
    name: "Bio 1",
    templateId: "20q_a4",
    answerKey: ["B"],
  });
  assert.ok(requests[0].url.endsWith("/workspace/folders/Midterm%20Grade%2010/quizzes"));
  assert.equal(requests[0].method, "POST");
  assert.ok(requests[1].url.endsWith("/workspace/folders/Midterm%20Grade%2010/quizzes/q-1"));
  assert.equal(requests[1].method, "PUT");

  const scanFile = new File(["jpg"], "scan.jpg", { type: "image/jpeg" });
  await gradeQuizPaper("q-1", scanFile, "p-99");
  assert.ok(
    requests[2].url.endsWith("/workspace/folders/Midterm%20Grade%2010/quizzes/q-1/grade"),
  );
  assert.equal((requests[2].body as FormData).get("paper_id"), "p-99");

  await submitReview("q-1", "p-99", { corrections: { 1: "B" } });
  assert.ok(
    requests[3].url.endsWith("/workspace/folders/Midterm%20Grade%2010/quizzes/q-1/papers/p-99"),
  );
  assert.equal(requests[3].method, "PATCH");

  await deletePaper("q-1", "p-99");
  assert.equal(requests[4].method, "DELETE");

  assert.ok(
    getPaperImageUrl("q-1", "p-99", "aligned", 42).endsWith(
      "/workspace/folders/Midterm%20Grade%2010/quizzes/q-1/papers/p-99/image/aligned?v=42",
    ),
  );
});

test("validateFolderName checks required, invalid chars, and case-insensitive collisions", () => {
  const existing = [{ name: "Midterm Grade 10" }];
  assert.equal(validateFolderName("  ", existing), "Folder name is required");
  assert.match(
    validateFolderName("Bad/Name", existing) ?? "",
    /cannot contain/,
  );
  assert.equal(
    validateFolderName("midterm grade 10", existing),
    'A folder named "midterm grade 10" already exists',
  );
  assert.equal(
    validateFolderName("Midterm Grade 10", existing, "Midterm Grade 10"),
    null,
  );
  assert.equal(validateFolderName("Finals", existing), null);
});

test("getQuizWorkspace returns null on 404 and rethrows 500 errors", async () => {
  setActiveFolder("Midterm Grade 10");
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: "Not found" }), {
      status: 404,
    })) as typeof fetch;
  assert.equal(await getQuizWorkspace("missing"), null);

  globalThis.fetch = (async () =>
    new Response("Server error", { status: 500 })) as typeof fetch;
  await assert.rejects(() => getQuizWorkspace("broken"), /The server had an error/);
});

test("importStudents posts bulk payload to /students/import once", async () => {
  setActiveFolder("Midterm Grade 10");
  let callUrl = "";
  let callBody = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    callUrl = String(input);
    callBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({ imported: 1, skipped: 0, students: [] }),
      { status: 201 },
    );
  }) as typeof fetch;

  const res = await importStudents([
    { firstName: "Ada", lastName: "Lovelace", studentCode: "1001" },
  ]);
  assert.equal(res.imported, 1);
  assert.ok(
    callUrl.endsWith("/workspace/folders/Midterm%20Grade%2010/students/import"),
  );
  assert.match(callBody, /"firstName":"Ada"/);
});

test("generateUniqueStudentCode normalizes punctuated existing student codes", () => {
  const origRandom = Math.random;
  try {
    let calls = 0;
    Math.random = () => {
      calls += 1;
      return calls === 1 ? 2345 / 90000 : 2346 / 90000;
    };
    const code = generateUniqueStudentCode([{ studentCode: "12-345" }]);
    assert.equal(code, "12346");
  } finally {
    Math.random = origRandom;
  }
});
