import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import {
  getDiskSyncStatus,
  hydrateWorkspaceFromDiskIfEmpty,
  refreshDiskStatus,
  resetDiskSyncForTests,
  runSyncQueue,
  scheduleDiskSync,
} from "./workspace/diskSync.ts";
import { listQuizzes, saveQuiz } from "./workspace/index.ts";
import { DB_NAME } from "./workspace/schema.ts";
import { serializeWorkspace } from "./workspace/serialize.ts";
import { closeDb } from "./workspace/store.ts";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

function installMockWindow() {
  const sessionMap = new Map<string, string>();
  const localMap = new Map<string, string>();
  const target = new EventTarget();
  const mockWin = {
    sessionStorage: {
      getItem: (k: string) => sessionMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        sessionMap.set(k, v);
      },
      removeItem: (k: string) => {
        sessionMap.delete(k);
      },
      clear: () => sessionMap.clear(),
    },
    localStorage: {
      getItem: (k: string) => localMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        localMap.set(k, v);
      },
      removeItem: (k: string) => {
        localMap.delete(k);
      },
      clear: () => localMap.clear(),
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  (globalThis as { window: unknown }).window = mockWin;
}

async function resetIndexedDb() {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await resetIndexedDb();
  resetDiskSyncForTests();
  installMockWindow();
});

afterEach(async () => {
  resetDiskSyncForTests();
  globalThis.fetch = originalFetch;
  (globalThis as { window: unknown }).window = originalWindow;
  await resetIndexedDb();
});

test("hydrateWorkspaceFromDiskIfEmpty aborts instead of wiping if a local write happens during fetch", async () => {
  const diskJson = serializeWorkspace({
    quizzes: [
      {
        id: "disk-q1",
        name: "Disk Quiz",
        templateId: "20q_a4",
        answerKey: Array(20).fill("A"),
        createdAt: "2026-11-18T00:00:00.000Z",
      },
    ],
    batches: [],
    papers: [],
    sections: [],
    students: [],
  });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/workspace/data")) {
      // Simulate user creating a quiz while startup fetch is in flight
      await saveQuiz({
        name: "Brand New Local Quiz",
        templateId: "20q_a4",
        questionCount: 20,
        answerKey: Array(20).fill("B"),
      });
      scheduleDiskSync();
      return new Response(diskJson, { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  const hydrated = await hydrateWorkspaceFromDiskIfEmpty();
  assert.equal(hydrated, false);
  const quizzes = await listQuizzes();
  assert.equal(quizzes.length, 1);
  assert.equal(quizzes[0].name, "Brand New Local Quiz");
});

test("refreshDiskStatus keeps dirty state and triggers re-sync after an offline PUT failure", async () => {
  await saveQuiz({
    name: "Offline Quiz",
    templateId: "20q_a4",
    questionCount: 20,
    answerKey: Array(20).fill("A"),
  });

  // Fail initial disk sync (backend offline)
  globalThis.fetch = (async () => {
    throw new TypeError("offline");
  }) as typeof fetch;

  scheduleDiskSync();
  await runSyncQueue();
  assert.equal(getDiskSyncStatus().state, "offline");

  // Backend comes back online; status endpoint sees older workspace.json on disk
  let putCalled = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/workspace/status")) {
      return new Response(
        JSON.stringify({
          workspace_dir: "/repo/workspace",
          has_workspace_json: true,
          scan_count: 0,
          template_files: [],
          last_modified: "2026-11-18T00:00:00.000Z",
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/workspace/data") && init?.method === "PUT") {
      putCalled += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          path: "/repo/workspace/workspace.json",
          saved_at: "2026-11-20T06:00:00.000Z",
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  const afterReconnect = await refreshDiskStatus();
  assert.equal(afterReconnect.state, "syncing");

  // Running the queued sync uploads the dirty local edits and moves to synced
  await runSyncQueue();
  assert.equal(putCalled >= 1, true);
  assert.equal(getDiskSyncStatus().state, "synced");
});
