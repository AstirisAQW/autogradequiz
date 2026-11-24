import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  ApiError,
  getErrorMessage,
  getHealth,
  scanKeyFromImage,
  templatePdfUrl,
} from "../src/lib/api.ts";

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

test("scanKeyFromImage posts FormData and templatePdfUrl points to backend templates", async () => {
  let capturedUrl = "";
  let capturedBody: FormData | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = init?.body as FormData;
    return new Response(
      JSON.stringify({
        template_id: "20q_a4",
        answer_key: ["A", "B"],
        flagged_questions: [],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const file = new File(["img"], "key.jpg", { type: "image/jpeg" });
  const res = await scanKeyFromImage("20q_a4", file);
  assert.deepEqual(res.answer_key, ["A", "B"]);
  assert.ok(capturedUrl.endsWith("/scan-key?template_id=20q_a4"));
  assert.ok(capturedBody !== null);
  assert.ok((capturedBody as FormData).get("file") !== null);
  assert.ok(templatePdfUrl("20q_a4").endsWith("/workspace/templates/20q_a4"));
});

test("getErrorMessage extracts Error/ApiError messages and falls back when empty", () => {
  assert.equal(getErrorMessage(new ApiError(422, "Bad key"), "Fallback"), "Bad key");
  assert.equal(getErrorMessage(new Error("Boom"), "Fallback"), "Boom");
  assert.equal(getErrorMessage(new Error(""), "Fallback"), "Fallback");
  assert.equal(getErrorMessage(null, "Fallback"), "Fallback");
});
