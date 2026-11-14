"use client";

import { useEffect, useState } from "react";
import { BatchResultsTable } from "@/components/BatchResultsTable";
import { BatchUploadGrader } from "@/components/BatchUploadGrader";
import { ApiError, createBatch, createTest, getHealth } from "@/lib/api";
import {
  TEMPLATE_QUESTION_COUNTS,
  type BatchRecord,
  type TemplateId,
  type TestRecord,
} from "@/lib/types";

const SESSION_KEY = "autogradequiz.session";

interface StoredSession {
  test: TestRecord | null;
  batch: BatchRecord | null;
}

function readSession(): StoredSession {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return { test: null, batch: null };
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    return {
      test: parsed.test ?? null,
      batch: parsed.batch ?? null,
    };
  } catch {
    return { test: null, batch: null };
  }
}

function writeSession(session: StoredSession): void {
  try {
    if (!session.test && !session.batch) {
      window.localStorage.removeItem(SESSION_KEY);
      return;
    }
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota or private-mode errors.
  }
}

function parseAnswerKey(raw: string): {
  letters: string[];
  invalidChars: string[];
} {
  const cleaned = raw.replace(/[\s,]+/g, "").toUpperCase();
  const invalidChars = Array.from(new Set(cleaned.replace(/[A-E]/g, "")));
  const letters = invalidChars.length === 0 ? cleaned.split("") : [];
  return { letters, invalidChars };
}

export default function Home() {
  const [backendStatus, setBackendStatus] = useState<
    "checking" | "ok" | "offline"
  >("checking");
  const [testName, setTestName] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>("20q_a4");
  const [rawAnswerKey, setRawAnswerKey] = useState("");
  const [activeTest, setActiveTest] = useState<TestRecord | null>(null);
  const [activeBatch, setActiveBatch] = useState<BatchRecord | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [submittingTest, setSubmittingTest] = useState(false);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [resultsVersion, setResultsVersion] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const saved = readSession();
      setActiveTest(saved.test);
      setActiveBatch(saved.batch);
      setSessionReady(true);
    });

    getHealth()
      .then(() => {
        if (!cancelled) setBackendStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setBackendStatus("offline");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const expectedCount = TEMPLATE_QUESTION_COUNTS[templateId];
  const { letters, invalidChars } = parseAnswerKey(rawAnswerKey);
  const cleanedLength = rawAnswerKey.replace(/[\s,]+/g, "").length;
  const canCreateTest =
    !submittingTest &&
    testName.trim().length > 0 &&
    invalidChars.length === 0 &&
    letters.length === expectedCount;

  async function handleCreateTest(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreateTest) return;
    setErrorMessage(null);
    setSubmittingTest(true);
    try {
      const created = await createTest({
        name: testName.trim(),
        template_id: templateId,
        answer_key: letters,
      });
      setActiveTest(created);
      setActiveBatch(null);
      writeSession({ test: created, batch: null });
    } catch (err) {
      setErrorMessage(
        err instanceof ApiError ? err.detail : "Could not create test.",
      );
    } finally {
      setSubmittingTest(false);
    }
  }

  async function handleCreateBatch() {
    if (!activeTest || submittingBatch) return;
    setErrorMessage(null);
    setSubmittingBatch(true);
    try {
      const created = await createBatch(activeTest.id);
      setActiveBatch(created);
      writeSession({ test: activeTest, batch: created });
    } catch (err) {
      setErrorMessage(
        err instanceof ApiError ? err.detail : "Could not create batch.",
      );
    } finally {
      setSubmittingBatch(false);
    }
  }

  function handleStartOver() {
    setActiveTest(null);
    setActiveBatch(null);
    setErrorMessage(null);
    writeSession({ test: null, batch: null });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Grade a batch</h1>
        {backendStatus === "checking" && (
          <span className="rounded-full bg-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700">
            Checking backend...
          </span>
        )}
        {backendStatus === "ok" && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
            Backend connected
          </span>
        )}
        {backendStatus === "offline" && (
          <span className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900">
            Backend not reachable. Start it with uvicorn app.main:app --reload
            in the backend folder.
          </span>
        )}
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold">1. Create a test</h2>
        <form onSubmit={handleCreateTest} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="test-name"
                className="block text-sm font-medium text-zinc-700"
              >
                Test name
              </label>
              <input
                id="test-name"
                type="text"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="Chapter 4 Quiz"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="template-id"
                className="block text-sm font-medium text-zinc-700"
              >
                Sheet template
              </label>
              <select
                id="template-id"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value as TemplateId)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              >
                <option value="20q_a4">20q_a4 (20 questions)</option>
                <option value="50q_a4">50q_a4 (50 questions)</option>
                <option value="100q_a4">100q_a4 (100 questions)</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="answer-key"
                className="block text-sm font-medium text-zinc-700"
              >
                Answer key (letters A to E; spaces and commas ignored)
              </label>
              <span
                className={`text-xs font-medium ${
                  cleanedLength === expectedCount && invalidChars.length === 0
                    ? "text-emerald-700"
                    : "text-zinc-600"
                }`}
              >
                {cleanedLength} / {expectedCount}
              </span>
            </div>
            <input
              id="answer-key"
              type="text"
              value={rawAnswerKey}
              onChange={(e) => setRawAnswerKey(e.target.value)}
              placeholder="ABCDE ABCDE ..."
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm uppercase text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none"
            />
            {invalidChars.length > 0 && (
              <p className="mt-1 text-xs text-red-600">
                Invalid character(s): {invalidChars.join(", ")}. Only letters A
                to E are allowed.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canCreateTest}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
          >
            {submittingTest ? "Creating..." : "Create test"}
          </button>
        </form>

        {errorMessage && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        )}
      </section>

      {sessionReady && activeTest && (
        <section className="rounded-lg border border-zinc-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 text-sm">
              <h2 className="text-base font-semibold">2. Active test & batch</h2>
              <p className="text-zinc-700">
                Test <span className="font-mono font-semibold">#{activeTest.id}</span>{" "}
                — {activeTest.name} ({activeTest.template_id})
              </p>
              <p className="text-zinc-700">
                Batch:{" "}
                {activeBatch ? (
                  <span className="font-mono font-semibold">
                    #{activeBatch.id}
                  </span>
                ) : (
                  <span className="text-zinc-500">none yet</span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCreateBatch}
                disabled={submittingBatch}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
              >
                {submittingBatch ? "Creating batch..." : "Create batch"}
              </button>
              <button
                type="button"
                onClick={handleStartOver}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Start over
              </button>
            </div>
          </div>
        </section>
      )}

      {sessionReady &&
        (activeBatch ? (
          <>
            <BatchUploadGrader
              key={activeBatch.id}
              batchId={activeBatch.id}
              onRunFinished={() => setResultsVersion((v) => v + 1)}
            />
            <BatchResultsTable
              batchId={activeBatch.id}
              refreshTrigger={resultsVersion}
            />
          </>
        ) : (
          <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-600">
            Create a batch first.
          </section>
        ))}
    </div>
  );
}
