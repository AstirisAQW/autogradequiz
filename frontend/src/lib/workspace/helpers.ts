import type {
  Batch,
  Paper,
  Quiz,
  QuizSummary,
  Section,
  Student,
  WorkspaceSaveStatus,
} from "./schema.ts";

let lastTimestampMs = 0;

const LS_LAST_SAVED = "autograde.lastSavedAt";
const LS_LAST_EXPORTED = "autograde.lastExportedAt";
const LS_CHANGES_SINCE_BACKUP = "autograde.changesSinceBackup";

export function markWorkspaceSaved(): void {
  if (typeof window === "undefined") return;
  try {
    const nowIso = new Date().toISOString();
    window.localStorage.setItem(LS_LAST_SAVED, nowIso);
    const prev = Number(
      window.localStorage.getItem(LS_CHANGES_SINCE_BACKUP) ?? "0",
    );
    window.localStorage.setItem(
      LS_CHANGES_SINCE_BACKUP,
      String(Number.isFinite(prev) ? prev + 1 : 1),
    );
    window.dispatchEvent(new Event("autograde:workspace-saved"));
  } catch {
    // Ignore storage errors
  }
}

export function markWorkspaceExported(): void {
  if (typeof window === "undefined") return;
  try {
    const nowIso = new Date().toISOString();
    window.localStorage.setItem(LS_LAST_EXPORTED, nowIso);
    window.localStorage.setItem(LS_CHANGES_SINCE_BACKUP, "0");
    window.dispatchEvent(new Event("autograde:workspace-saved"));
  } catch {
    // Ignore storage errors
  }
}

export function getWorkspaceSaveStatus(): WorkspaceSaveStatus {
  if (typeof window === "undefined") {
    return {
      lastSavedAt: null,
      lastExportedAt: null,
      changesSinceBackup: 0,
      isBackupStale: true,
    };
  }
  try {
    const lastSavedAt = window.localStorage.getItem(LS_LAST_SAVED);
    const lastExportedAt = window.localStorage.getItem(LS_LAST_EXPORTED);
    const rawCount = Number(
      window.localStorage.getItem(LS_CHANGES_SINCE_BACKUP) ?? "0",
    );
    const isBackupStale =
      !lastExportedAt ||
      Date.now() - new Date(lastExportedAt).getTime() > 24 * 60 * 60 * 1000;
    return {
      lastSavedAt,
      lastExportedAt,
      changesSinceBackup: Number.isFinite(rawCount) ? rawCount : 0,
      isBackupStale,
    };
  } catch {
    return {
      lastSavedAt: null,
      lastExportedAt: null,
      changesSinceBackup: 0,
      isBackupStale: true,
    };
  }
}

export function nextCreatedAt(): string {
  const now = Date.now();
  lastTimestampMs = now > lastTimestampMs ? now : lastTimestampMs + 1;
  return new Date(lastTimestampMs).toISOString();
}

export function sortByCreatedAsc<T extends { createdAt: string; id: string }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export function generateUniqueStudentCode(
  existingStudents: Pick<Student, "studentCode">[],
): string {
  const used = new Set(existingStudents.map((s) => s.studentCode.trim()));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = String(10000 + Math.floor(Math.random() * 90000));
    if (!used.has(candidate)) return candidate;
  }
  for (let code = 10000; code <= 99999; code += 1) {
    const candidate = String(code);
    if (!used.has(candidate)) return candidate;
  }
  return String(Date.now()).slice(-6);
}

export function normalizeCodeForMatch(val: string | undefined): string {
  return (val ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function codesMatch(
  scannedText: string | undefined,
  studentCode: string,
): boolean {
  const a = normalizeCodeForMatch(scannedText);
  const b = normalizeCodeForMatch(studentCode);
  return Boolean(a && b && a === b);
}

export function findStudentByCode(
  students: Student[],
  scannedText: string | undefined,
): Student | undefined {
  if (!normalizeCodeForMatch(scannedText)) return undefined;
  return students.find((s) => codesMatch(scannedText, s.studentCode));
}

export function hasMinAlnum(value: string | undefined, min = 2): boolean {
  return ((value ?? "").match(/[a-zA-Z0-9]/g)?.length ?? 0) >= min;
}

export function parseFullName(
  rawName: string,
): { firstName: string; lastName: string } | null {
  const normalized = (rawName ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  const commaIdx = normalized.indexOf(",");
  if (commaIdx !== -1) {
    const lastName = normalized.slice(0, commaIdx).trim();
    const firstName = normalized.slice(commaIdx + 1).trim();
    return firstName && lastName ? { firstName, lastName } : null;
  }
  const parts = normalized.split(" ");
  if (parts.length < 2) return null;
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return firstName && lastName ? { firstName, lastName } : null;
}

export async function ensureSectionInTx(
  sectionName: string | undefined,
  allSections: Section[],
  sectionStore: { put(value: Section): Promise<unknown> },
): Promise<Section | null> {
  const trimmed = (sectionName ?? "").trim();
  if (!hasMinAlnum(trimmed, 2)) return null;
  const existing = allSections.find(
    (s) => s.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (existing) return existing;
  const created: Section = {
    id: crypto.randomUUID(),
    name: trimmed,
    term: "",
    createdAt: nextCreatedAt(),
  };
  await sectionStore.put(created);
  allSections.push(created);
  return created;
}

export function summarizeQuizzesWithCounts(
  quizzes: Quiz[],
  batches: Batch[],
  papers: Paper[],
): {
  summaries: QuizSummary[];
  batchesByQuiz: Map<string, Batch[]>;
} {
  const batchQuizMap = new Map<string, string>();
  const batchesByQuiz = new Map<string, Batch[]>();
  for (const b of batches) {
    batchQuizMap.set(b.id, b.quizId);
    const list = batchesByQuiz.get(b.quizId) ?? [];
    list.push(b);
    batchesByQuiz.set(b.quizId, list);
  }

  const paperCounts = new Map<string, number>();
  const reviewCounts = new Map<string, number>();
  for (const p of papers) {
    const qId = batchQuizMap.get(p.batchId);
    if (!qId) continue;
    paperCounts.set(qId, (paperCounts.get(qId) ?? 0) + 1);
    if (p.needsReview) {
      reviewCounts.set(qId, (reviewCounts.get(qId) ?? 0) + 1);
    }
  }

  const summaries = [...quizzes]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((q) => ({
      ...q,
      batchCount: batchesByQuiz.get(q.id)?.length ?? 0,
      paperCount: paperCounts.get(q.id) ?? 0,
      needsReviewCount: reviewCounts.get(q.id) ?? 0,
    }));

  return { summaries, batchesByQuiz };
}

export function associatedSectionIdsForQuiz(
  quiz: Quiz,
  quizBatches: Batch[],
): Set<string> {
  const ids = new Set<string>(quiz.sectionIds ?? []);
  for (const b of quizBatches) {
    if (b.sectionId) ids.add(b.sectionId);
  }
  return ids;
}
