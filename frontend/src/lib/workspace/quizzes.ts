import { validateAnswerKeyAndPoints } from "../answerKey.ts";
import { rescore } from "../scoring.ts";
import {
  markWorkspaceSaved,
  nextCreatedAt,
  sortByCreatedAsc,
  summarizeQuizzesWithCounts,
} from "./helpers.ts";
import { getAvailableKeyVersions, resolveQuizKeyForVersion } from "./keyVersion.ts";
import type {
  Batch,
  KeyVersionData,
  KeyVersionId,
  Paper,
  QuestionRule,
  Quiz,
  QuizSummary,
  QuizWorkspace,
} from "./schema.ts";
import { validateKeyVersions, validateQuestionRules } from "./serialize.ts";
import { getDb } from "./store.ts";

export async function listQuizzes(): Promise<Quiz[]> {
  const db = await getDb();
  const quizzes = await db.getAll("quizzes");
  return [...quizzes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listQuizSummaries(): Promise<QuizSummary[]> {
  const db = await getDb();
  const tx = db.transaction(["quizzes", "batches", "papers"], "readonly");
  const [quizzes, batches, papers] = await Promise.all([
    tx.objectStore("quizzes").getAll(),
    tx.objectStore("batches").getAll(),
    tx.objectStore("papers").getAll(),
  ]);
  await tx.done;

  return summarizeQuizzesWithCounts(quizzes, batches, papers).summaries;
}

export async function getQuizWorkspace(
  quizId: string,
  preferredBatchId?: string | null,
): Promise<QuizWorkspace | null> {
  const db = await getDb();
  const quiz = await db.get("quizzes", quizId);
  if (!quiz) return null;

  const batches = sortByCreatedAsc(
    await db.getAllFromIndex("batches", "by-quiz", quizId),
  );
  const activeBatch =
    (preferredBatchId
      ? batches.find((b) => b.id === preferredBatchId)
      : undefined) ??
    batches[batches.length - 1] ??
    null;

  const batchPaperCounts: Record<string, number> = {};
  let activePapers: Paper[] = [];
  const allQuizPapers: Paper[] = [];
  const paperIndex = db.transaction("papers", "readonly").store.index("by-batch");
  for (const b of batches) {
    const list = await paperIndex.getAll(b.id);
    batchPaperCounts[b.id] = list.length;
    allQuizPapers.push(...list);
    if (activeBatch && b.id === activeBatch.id) {
      activePapers = sortByCreatedAsc(list);
    }
  }

  return {
    quiz,
    batches,
    activeBatch,
    papers: activePapers,
    allPapers: sortByCreatedAsc(allQuizPapers),
    batchPaperCounts,
  };
}

function normalizedQuizScoringSnapshot(quiz: Quiz): string {
  const questionCount = quiz.answerKey.length;
  const pts = quiz.points ?? Array<number>(questionCount).fill(1);
  return JSON.stringify({
    answerKey: quiz.answerKey,
    points: pts,
    questionRules: quiz.questionRules ?? null,
    keyVersions: quiz.keyVersions ?? null,
  });
}

export async function saveQuiz(input: {
  id?: string;
  name: string;
  templateId: string;
  questionCount: number;
  answerKey: string[];
  points?: number[];
  date?: string;
  folder?: string;
  sectionIds?: string[];
  tags?: string[];
  questionRules?: QuestionRule[];
  keyVersions?: Partial<Record<KeyVersionId, KeyVersionData>>;
}): Promise<Quiz> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Quiz name cannot be empty.");
  }
  const validated = validateAnswerKeyAndPoints(
    input.questionCount,
    input.answerKey,
    input.points,
  );
  const validatedRules =
    input.questionRules !== undefined
      ? validateQuestionRules(input.questionCount, input.questionRules)
      : undefined;
  let cleanedKeyVersions: Partial<Record<KeyVersionId, KeyVersionData>> | undefined;
  if (input.keyVersions !== undefined) {
    const parsed = validateKeyVersions(input.questionCount, input.keyVersions);
    if (parsed) {
      const rest: Partial<Record<KeyVersionId, KeyVersionData>> = {};
      for (const ver of ["B", "C", "D"] as const) {
        if (parsed[ver]) rest[ver] = parsed[ver];
      }
      cleanedKeyVersions = Object.keys(rest).length > 0 ? rest : undefined;
    }
  }

  const db = await getDb();
  const existing = input.id ? await db.get("quizzes", input.id) : undefined;
  const resolvedTags =
    input.tags !== undefined
      ? Array.from(new Set(input.tags.map((t) => t.trim()).filter(Boolean)))
      : existing?.tags;
  const resolvedSectionIds =
    input.sectionIds !== undefined
      ? Array.from(new Set(input.sectionIds))
      : existing?.sectionIds;
  const resolvedFolder =
    input.folder !== undefined ? input.folder.trim() : existing?.folder;
  const resolvedDate =
    input.date !== undefined ? input.date.trim() : existing?.date;

  const quiz: Quiz = {
    id: existing?.id ?? input.id ?? crypto.randomUUID(),
    name: trimmedName,
    templateId: existing?.templateId ?? input.templateId,
    ...(resolvedDate ? { date: resolvedDate } : {}),
    ...(resolvedFolder ? { folder: resolvedFolder } : {}),
    ...(resolvedSectionIds?.length ? { sectionIds: resolvedSectionIds } : {}),
    ...(resolvedTags?.length ? { tags: resolvedTags } : {}),
    answerKey: validated.answerKey,
    points: input.points !== undefined ? validated.points : existing?.points,
    ...(input.questionRules !== undefined
      ? validatedRules
        ? { questionRules: validatedRules }
        : {}
      : existing?.questionRules
        ? { questionRules: existing.questionRules }
        : {}),
    ...(input.keyVersions !== undefined
      ? cleanedKeyVersions
        ? { keyVersions: cleanedKeyVersions }
        : {}
      : existing?.keyVersions
        ? { keyVersions: existing.keyVersions }
        : {}),
    createdAt: existing?.createdAt ?? nextCreatedAt(),
  };

  const keyOrPointsChanged =
    existing !== undefined &&
    normalizedQuizScoringSnapshot(existing) !==
      normalizedQuizScoringSnapshot(quiz);

  const tx = db.transaction(["quizzes", "batches", "papers"], "readwrite");
  await tx.objectStore("quizzes").put(quiz);

  if (keyOrPointsChanged) {
    const multiKey = getAvailableKeyVersions(quiz).length > 1;
    const batches = await tx
      .objectStore("batches")
      .index("by-quiz")
      .getAll(quiz.id);
    const paperStore = tx.objectStore("papers");
    for (const batch of batches) {
      const papers = await paperStore.index("by-batch").getAll(batch.id);
      for (const paper of papers) {
        if (paper.status !== "done") continue;
        const resolved = resolveQuizKeyForVersion(quiz, paper.keyVersion);
        const kvFlagged = multiKey && Boolean(paper.keyVersionFlagged);
        const { score, needsReview } = rescore({
          answerKey: resolved.answerKey,
          points: resolved.points,
          questionRules: resolved.questionRules,
          keyVersionFlagged: kvFlagged,
          answers: paper.answers,
          flags: paper.flags,
          corrections: paper.corrections,
        });
        const nextPaper: Paper = {
          ...paper,
          ...(paper.keyVersion !== undefined
            ? { keyVersion: resolved.version }
            : {}),
          score,
          needsReview,
        };
        if (kvFlagged) {
          nextPaper.keyVersionFlagged = true;
        } else {
          delete nextPaper.keyVersionFlagged;
        }
        await paperStore.put(nextPaper);
      }
    }
  }

  await tx.done;
  markWorkspaceSaved();
  return quiz;
}

export async function deleteQuiz(quizId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ["quizzes", "batches", "papers", "paperImages"],
    "readwrite",
  );
  const batches = await tx
    .objectStore("batches")
    .index("by-quiz")
    .getAll(quizId);

  const paperStore = tx.objectStore("papers");
  const imageStore = tx.objectStore("paperImages");
  const batchStore = tx.objectStore("batches");

  for (const batch of batches) {
    const papers = await paperStore.index("by-batch").getAll(batch.id);
    for (const paper of papers) {
      await imageStore.delete(paper.id);
      await paperStore.delete(paper.id);
    }
    await batchStore.delete(batch.id);
  }

  await tx.objectStore("quizzes").delete(quizId);
  await tx.done;
  markWorkspaceSaved();
}

export async function saveBatch(input: {
  id?: string;
  quizId: string;
  sectionId?: string | null;
}): Promise<Batch> {
  const db = await getDb();
  const tx = db.transaction(["quizzes", "sections", "batches"], "readwrite");
  const quiz = await tx.objectStore("quizzes").get(input.quizId);
  if (!quiz) {
    throw new Error(`Quiz ${input.quizId} not found.`);
  }
  const existing = input.id
    ? await tx.objectStore("batches").get(input.id)
    : undefined;
  const nextSectionId =
    input.sectionId !== undefined
      ? input.sectionId
      : (existing?.sectionId ?? null);
  if (nextSectionId !== null) {
    const sec = await tx.objectStore("sections").get(nextSectionId);
    if (!sec) {
      throw new Error(`Section ${nextSectionId} not found.`);
    }
  }
  const batch: Batch = {
    id: existing?.id ?? input.id ?? crypto.randomUUID(),
    quizId: input.quizId,
    sectionId: nextSectionId,
    createdAt: existing?.createdAt ?? nextCreatedAt(),
  };
  await tx.objectStore("batches").put(batch);
  await tx.done;
  markWorkspaceSaved();
  return batch;
}

export async function deleteBatch(batchId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["batches", "papers", "paperImages"], "readwrite");
  const papers = await tx
    .objectStore("papers")
    .index("by-batch")
    .getAll(batchId);
  const paperStore = tx.objectStore("papers");
  const imageStore = tx.objectStore("paperImages");

  for (const paper of papers) {
    await imageStore.delete(paper.id);
    await paperStore.delete(paper.id);
  }
  await tx.objectStore("batches").delete(batchId);
  await tx.done;
  markWorkspaceSaved();
}
