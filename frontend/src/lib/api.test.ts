import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { ApiError, getHealth, gradeSheet } from "./api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("ApiError parses string detail, Pydantic list detail, and network errors", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: "Template not found" }), {
      status: 422,
    })) as typeof fetch;

  await assert.rejects(
    () => getHealth(),
    (err: unknown) =>
      err instanceof ApiError &&
      err.status === 422 &&
      err.detail === "Template not found",
  );

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: [{ msg: "field required" }] }), {
      status: 422,
    })) as typeof fetch;

  await assert.rejects(
    () => getHealth(),
    (err: unknown) =>
      err instanceof ApiError &&
      err.status === 422 &&
      err.detail === "field required",
  );

  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  await assert.rejects(
    () => getHealth(),
    (err: unknown) =>
      err instanceof ApiError &&
      err.status === 0 &&
      err.detail.includes("Cannot reach backend"),
  );
});

test("gradeSheet posts FormData with answer_key metadata, versions, and workspace fields", async () => {
  let capturedBody: FormData | null = null;
  let capturedUrl = "";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = init?.body as FormData;
    return new Response(
      JSON.stringify({
        answers: ["A", "B"],
        flags: {},
        confidence: [0.9, 0.9],
        score: 100,
        needs_review: false,
        name_text: "",
        date_text: "",
        section_text: "",
        aligned_image_jpeg_base64: "",
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const file = new File(["img"], "sheet.jpg", { type: "image/jpeg" });
  const res = await gradeSheet({
    file,
    templateId: "20q_a4",
    answerKey: ["A", "B"],
    points: [2, 1],
    questionRules: [{ tags: ["Algebra"] }, { incorrectPoints: -0.5 }],
    keyVersions: { B: { answerKey: ["C", "D"], points: [2, 1] } },
    saveToWorkspace: true,
    quizId: "q1",
    quizName: "Math Quiz",
    paperId: "p1",
  });

  assert.equal(res.score, 100);
  assert.ok(capturedUrl.endsWith("/grade"));
  assert.ok(capturedBody !== null);
  const fd = capturedBody as FormData;
  assert.equal(fd.get("template_id"), "20q_a4");
  assert.equal(fd.get("save_to_workspace"), "true");
  assert.equal(fd.get("quiz_id"), "q1");
  assert.equal(fd.get("quiz_name"), "Math Quiz");
  assert.equal(fd.get("paper_id"), "p1");
  const parsedKey = JSON.parse(String(fd.get("answer_key")));
  assert.deepEqual(parsedKey.answer_key, ["A", "B"]);
  assert.deepEqual(parsedKey.points, [2, 1]);
  assert.deepEqual(parsedKey.question_rules, [
    { tags: ["Algebra"] },
    { incorrectPoints: -0.5 },
  ]);
  assert.deepEqual(parsedKey.key_versions.B.answerKey, ["C", "D"]);
});
