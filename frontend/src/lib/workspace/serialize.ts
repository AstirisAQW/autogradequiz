import {
  normalizeAnswerKeyEntry,
  validateAnswerKeyAndPoints,
} from "../answerKey.ts";
import { rescore } from "../scoring.ts";
import {
  getAvailableKeyVersions,
  resolveQuizKeyForVersion,
} from "./keyVersion.ts";
import {
  type Batch,
  type FlagReason,
  KEY_VERSION_IDS,
  type KeyVersionData,
  type KeyVersionId,
  type Paper,
  type QuestionRule,
  type Quiz,
  type Section,
  type Student,
} from "./schema.ts";

export const EXPORT_VERSION = 1;

const ANSWER_CHOICES = ["A", "B", "C", "D", "E"] as const;
const BASE64_REGEX =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface WorkspaceExportPayload {
  exportVersion: number;
  quizzes: Quiz[];
  batches: Batch[];
  papers: Paper[];
  sections: Section[];
  students: Student[];
  images?: Record<string, string>;
}

export function validateCorrections(
  questionCount: number,
  corrections: Record<number, string>,
): void {
  for (const [key, choice] of Object.entries(corrections)) {
    const qNum = Number(key);
    if (!Number.isInteger(qNum) || qNum < 1 || qNum > questionCount) {
      throw new Error(`Question number ${key} out of range.`);
    }
    if (
      typeof choice !== "string" ||
      (choice !== "" &&
        !ANSWER_CHOICES.includes(choice as (typeof ANSWER_CHOICES)[number]))
    ) {
      throw new Error(`Invalid correction choice ${JSON.stringify(choice)}.`);
    }
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof b64 !== "string" || b64.length === 0 || !BASE64_REGEX.test(b64)) {
    throw new Error("Invalid base64 image string.");
  }
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new Error("Invalid base64 image string.");
  }
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function serializeWorkspace(data: {
  quizzes: Quiz[];
  batches: Batch[];
  papers: Paper[];
  sections: Section[];
  students: Student[];
  images?: Record<string, string>;
}): string {
  const payload: WorkspaceExportPayload = {
    exportVersion: EXPORT_VERSION,
    quizzes: data.quizzes,
    batches: data.batches,
    papers: data.papers,
    sections: data.sections,
    students: data.students,
    ...(data.images !== undefined ? { images: data.images } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

function assertUniqueStrings(values: string[], label: string): Set<string> {
  const seen = new Set<string>();
  for (const val of values) {
    if (typeof val !== "string" || !val.trim()) {
      throw new Error(`Invalid or empty ${label}.`);
    }
    if (seen.has(val)) {
      throw new Error(`Duplicate ${label}: "${val}".`);
    }
    seen.add(val);
  }
  return seen;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function validateQuestionRules(
  questionCount: number,
  rawRules: unknown,
): QuestionRule[] | undefined {
  if (rawRules === undefined) return undefined;
  if (!Array.isArray(rawRules) || rawRules.length !== questionCount) {
    throw new Error(`Expected ${questionCount} question rule entries.`);
  }
  return rawRules.map((entry, idx) => {
    if (!isPlainObject(entry)) {
      throw new Error(`Invalid question rule at index ${idx}.`);
    }
    let alternateAnswers: QuestionRule["alternateAnswers"];
    if (entry.alternateAnswers !== undefined) {
      if (!Array.isArray(entry.alternateAnswers)) {
        throw new Error(`alternateAnswers at question ${idx + 1} must be a list.`);
      }
      alternateAnswers = entry.alternateAnswers.map((alt) => {
        if (
          !isPlainObject(alt) ||
          typeof alt.choice !== "string" ||
          typeof alt.points !== "number" ||
          !Number.isFinite(alt.points) ||
          alt.points < 0
        ) {
          throw new Error(
            `Invalid alternate answer at question ${idx + 1}.`,
          );
        }
        return {
          choice: normalizeAnswerKeyEntry(alt.choice),
          points: alt.points,
        };
      });
    }
    let incorrectPoints: number | undefined;
    if (entry.incorrectPoints !== undefined) {
      if (
        typeof entry.incorrectPoints !== "number" ||
        !Number.isFinite(entry.incorrectPoints)
      ) {
        throw new Error(
          `incorrectPoints at question ${idx + 1} must be a finite number.`,
        );
      }
      incorrectPoints = entry.incorrectPoints;
    }
    let tags: string[] | undefined;
    if (entry.tags !== undefined) {
      if (
        !Array.isArray(entry.tags) ||
        entry.tags.some((t) => typeof t !== "string")
      ) {
        throw new Error(`tags at question ${idx + 1} must be strings.`);
      }
      tags = Array.from(
        new Set(entry.tags.map((t) => t.trim()).filter(Boolean)),
      );
    }
    return {
      ...(alternateAnswers?.length ? { alternateAnswers } : {}),
      ...(incorrectPoints !== undefined ? { incorrectPoints } : {}),
      ...(tags?.length ? { tags } : {}),
    };
  });
}

export function validateKeyVersions(
  questionCount: number,
  rawVersions: unknown,
): Partial<Record<KeyVersionId, KeyVersionData>> | undefined {
  if (rawVersions === undefined) return undefined;
  if (!isPlainObject(rawVersions)) {
    throw new Error("keyVersions must be an object.");
  }
  const normalized: Partial<Record<KeyVersionId, KeyVersionData>> = {};
  for (const [rawKey, rawVal] of Object.entries(rawVersions)) {
    const ver = rawKey.trim().toUpperCase() as KeyVersionId;
    if (!KEY_VERSION_IDS.includes(ver)) {
      throw new Error(`Invalid key version "${rawKey}".`);
    }
    if (!isPlainObject(rawVal) || !Array.isArray(rawVal.answerKey)) {
      throw new Error(`Key version "${ver}" must contain answerKey.`);
    }
    const validated = validateAnswerKeyAndPoints(
      questionCount,
      rawVal.answerKey as string[],
      rawVal.points as number[] | undefined,
    );
    const rules = validateQuestionRules(questionCount, rawVal.questionRules);
    normalized[ver] = {
      answerKey: validated.answerKey,
      ...(rawVal.points !== undefined ? { points: validated.points } : {}),
      ...(rules !== undefined ? { questionRules: rules } : {}),
    };
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function parseAndValidateWorkspaceExport(
  rawJson: string,
): WorkspaceExportPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Invalid JSON in workspace import.");
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Workspace import must be a JSON object.");
  }

  const version = parsed.exportVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("Invalid or missing exportVersion.");
  }
  if (version > EXPORT_VERSION) {
    throw new Error(
      `Unsupported exportVersion ${version} (max supported: ${EXPORT_VERSION}).`,
    );
  }

  const { quizzes, batches, papers, sections, students, images } = parsed;
  if (
    !Array.isArray(quizzes) ||
    !Array.isArray(batches) ||
    !Array.isArray(papers) ||
    !Array.isArray(sections) ||
    !Array.isArray(students)
  ) {
    throw new Error(
      "Workspace import must contain quizzes, batches, papers, sections, and students arrays.",
    );
  }
  if (images !== undefined && !isPlainObject(images)) {
    throw new Error("images must be an object mapping paperId to base64.");
  }

  const sectionIds = assertUniqueStrings(
    sections.map((s) => (isPlainObject(s) ? String(s.id ?? "") : "")),
    "section id",
  );
  assertUniqueStrings(
    sections.map((s) =>
      isPlainObject(s) && typeof s.name === "string" ? s.name.trim() : "",
    ),
    "section name",
  );

  const studentIds = assertUniqueStrings(
    students.map((s) => (isPlainObject(s) ? String(s.id ?? "") : "")),
    "student id",
  );
  assertUniqueStrings(
    students.map((s) =>
      isPlainObject(s) && typeof s.studentCode === "string"
        ? s.studentCode.trim()
        : "",
    ),
    "student code",
  );
  for (const stu of students) {
    if (
      !isPlainObject(stu) ||
      typeof stu.firstName !== "string" ||
      !stu.firstName.trim() ||
      typeof stu.lastName !== "string" ||
      !stu.lastName.trim() ||
      !Array.isArray(stu.sectionIds)
    ) {
      throw new Error("Invalid student record in import.");
    }
    for (const secId of stu.sectionIds) {
      if (typeof secId !== "string" || !sectionIds.has(secId)) {
        throw new Error(
          `Student "${stu.id}" references missing section "${String(secId)}".`,
        );
      }
    }
  }

  const quizIds = assertUniqueStrings(
    quizzes.map((q) => (isPlainObject(q) ? String(q.id ?? "") : "")),
    "quiz id",
  );
  const quizById = new Map<string, Quiz>();
  for (const rawQuiz of quizzes) {
    if (
      !isPlainObject(rawQuiz) ||
      typeof rawQuiz.name !== "string" ||
      !rawQuiz.name.trim() ||
      typeof rawQuiz.templateId !== "string" ||
      !Array.isArray(rawQuiz.answerKey)
    ) {
      throw new Error("Invalid quiz record in import.");
    }
    const validatedQuiz = validateAnswerKeyAndPoints(
      rawQuiz.answerKey.length,
      rawQuiz.answerKey as string[],
      rawQuiz.points as number[] | undefined,
    );
    if (
      rawQuiz.sectionIds !== undefined &&
      (!Array.isArray(rawQuiz.sectionIds) ||
        rawQuiz.sectionIds.some(
          (id) => typeof id !== "string" || !sectionIds.has(id),
        ))
    ) {
      throw new Error(
        `Quiz "${String(rawQuiz.id)}" contains an invalid section reference.`,
      );
    }
    const normalizedRules = validateQuestionRules(
      validatedQuiz.answerKey.length,
      rawQuiz.questionRules,
    );
    const normalizedVersions = validateKeyVersions(
      validatedQuiz.answerKey.length,
      rawQuiz.keyVersions,
    );
    const normalizedQuiz: Quiz = {
      ...(rawQuiz as unknown as Quiz),
      answerKey: validatedQuiz.answerKey,
      points:
        rawQuiz.points !== undefined ? validatedQuiz.points : undefined,
      ...(typeof rawQuiz.date === "string" ? { date: rawQuiz.date } : {}),
      ...(typeof rawQuiz.folder === "string" ? { folder: rawQuiz.folder } : {}),
      ...(Array.isArray(rawQuiz.sectionIds)
        ? { sectionIds: rawQuiz.sectionIds as string[] }
        : {}),
      ...(Array.isArray(rawQuiz.tags)
        ? {
            tags: Array.from(
              new Set(
                rawQuiz.tags
                  .filter((t): t is string => typeof t === "string")
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ),
          }
        : {}),
      ...(normalizedRules !== undefined
        ? { questionRules: normalizedRules }
        : {}),
      ...(normalizedVersions !== undefined
        ? { keyVersions: normalizedVersions }
        : {}),
    };
    quizById.set(rawQuiz.id as string, normalizedQuiz);
  }

  assertUniqueStrings(
    batches.map((b) => (isPlainObject(b) ? String(b.id ?? "") : "")),
    "batch id",
  );
  const batchById = new Map<string, Batch>();
  for (const rawBatch of batches) {
    if (!isPlainObject(rawBatch) || typeof rawBatch.quizId !== "string") {
      throw new Error("Invalid batch record in import.");
    }
    if (!quizIds.has(rawBatch.quizId)) {
      throw new Error(
        `Batch "${String(rawBatch.id)}" references missing quiz "${rawBatch.quizId}".`,
      );
    }
    if (
      rawBatch.sectionId !== null &&
      rawBatch.sectionId !== undefined &&
      (typeof rawBatch.sectionId !== "string" ||
        !sectionIds.has(rawBatch.sectionId))
    ) {
      throw new Error(
        `Batch "${String(rawBatch.id)}" references missing section "${String(rawBatch.sectionId)}".`,
      );
    }
    batchById.set(rawBatch.id as string, rawBatch as unknown as Batch);
  }

  const paperIds = assertUniqueStrings(
    papers.map((p) => (isPlainObject(p) ? String(p.id ?? "") : "")),
    "paper id",
  );
  const validatedPapers: Paper[] = [];
  for (const rawPaper of papers) {
    if (!isPlainObject(rawPaper) || typeof rawPaper.batchId !== "string") {
      throw new Error("Invalid paper record in import.");
    }
    const batch = batchById.get(rawPaper.batchId);
    if (!batch) {
      throw new Error(
        `Paper "${String(rawPaper.id)}" references missing batch "${rawPaper.batchId}".`,
      );
    }
    const quiz = quizById.get(batch.quizId)!;
    if (rawPaper.status !== "done" && rawPaper.status !== "failed") {
      throw new Error(`Invalid paper status "${String(rawPaper.status)}".`);
    }
    if (
      typeof rawPaper.score !== "number" ||
      !Number.isFinite(rawPaper.score)
    ) {
      throw new Error(
        `Paper "${String(rawPaper.id)}" score must be a finite number.`,
      );
    }
    if (
      typeof rawPaper.nameText !== "string" ||
      typeof rawPaper.dateText !== "string" ||
      typeof rawPaper.sectionText !== "string" ||
      (rawPaper.studentIdText !== undefined &&
        typeof rawPaper.studentIdText !== "string") ||
      (rawPaper.keyVersionFlagged !== undefined &&
        typeof rawPaper.keyVersionFlagged !== "boolean") ||
      typeof rawPaper.createdAt !== "string" ||
      (rawPaper.error !== undefined && typeof rawPaper.error !== "string")
    ) {
      throw new Error(
        `Paper "${String(rawPaper.id)}" has invalid text or timestamp fields.`,
      );
    }
    if (!Array.isArray(rawPaper.answers)) {
      throw new Error(
        `Paper "${String(rawPaper.id)}" answers must be an array.`,
      );
    }
    const questionCount = quiz.answerKey.length;
    if (rawPaper.status === "done") {
      if (rawPaper.answers.length !== questionCount) {
        throw new Error(
          `Paper "${String(rawPaper.id)}" answers length (${rawPaper.answers.length}) does not match quiz question count (${questionCount}).`,
        );
      }
    } else if (
      rawPaper.answers.length !== 0 &&
      rawPaper.answers.length !== questionCount
    ) {
      throw new Error(
        `Failed paper "${String(rawPaper.id)}" answers must be empty or match quiz question count.`,
      );
    }
    const normalizedAnswers = rawPaper.answers.map((ans) => {
      if (typeof ans !== "string") {
        throw new Error(
          `Paper "${String(rawPaper.id)}" contains a non-string answer.`,
        );
      }
      const trimmed = ans.trim();
      return trimmed === "" ? "" : normalizeAnswerKeyEntry(trimmed);
    });

    if (
      !Array.isArray(rawPaper.confidence) ||
      rawPaper.confidence.some(
        (c) => typeof c !== "number" || !Number.isFinite(c),
      )
    ) {
      throw new Error(
        `Paper "${String(rawPaper.id)}" confidence must be an array of numbers.`,
      );
    }
    if (
      rawPaper.studentId !== null &&
      rawPaper.studentId !== undefined &&
      (typeof rawPaper.studentId !== "string" ||
        !studentIds.has(rawPaper.studentId))
    ) {
      throw new Error(
        `Paper "${String(rawPaper.id)}" references missing student "${String(rawPaper.studentId)}".`,
      );
    }
    if (!isPlainObject(rawPaper.flags) || !isPlainObject(rawPaper.corrections)) {
      throw new Error("Paper flags and corrections must be objects.");
    }
    for (const [fKey, reason] of Object.entries(rawPaper.flags)) {
      const qNum = Number(fKey);
      if (
        !Number.isInteger(qNum) ||
        qNum < 1 ||
        qNum > questionCount ||
        (reason !== ("ambiguous" as FlagReason) &&
          reason !== ("multiple" as FlagReason))
      ) {
        throw new Error(
          `Invalid flag "${fKey}: ${String(reason)}" on paper "${String(rawPaper.id)}".`,
        );
      }
    }
    validateCorrections(
      questionCount,
      rawPaper.corrections as Record<number, string>,
    );

    const basePaper = rawPaper as unknown as Paper;
    const rawKv =
      typeof rawPaper.keyVersion === "string"
        ? (rawPaper.keyVersion.trim().toUpperCase() as KeyVersionId)
        : undefined;
    const resolvedKv: KeyVersionId | undefined =
      rawKv && KEY_VERSION_IDS.includes(rawKv)
        ? rawKv === "A" || quiz.keyVersions?.[rawKv]
          ? rawKv
          : "A"
        : undefined;
    const resolved = resolveQuizKeyForVersion(quiz, resolvedKv);
    const multiKey = getAvailableKeyVersions(quiz).length > 1;
    const kvFlagged = multiKey && Boolean(basePaper.keyVersionFlagged);

    if (basePaper.status === "done") {
      const recomputed = rescore({
        answerKey: resolved.answerKey,
        points: resolved.points,
        questionRules: resolved.questionRules,
        keyVersionFlagged: kvFlagged,
        answers: normalizedAnswers,
        flags: basePaper.flags,
        corrections: basePaper.corrections,
      });
      const nextPaper: Paper = {
        ...basePaper,
        ...(resolvedKv !== undefined ? { keyVersion: resolved.version } : {}),
        answers: normalizedAnswers,
        score: recomputed.score,
        needsReview: recomputed.needsReview,
      };
      if (kvFlagged) {
        nextPaper.keyVersionFlagged = true;
      } else {
        delete nextPaper.keyVersionFlagged;
      }
      validatedPapers.push(nextPaper);
    } else {
      const nextFailed: Paper = {
        ...basePaper,
        ...(resolvedKv !== undefined ? { keyVersion: resolved.version } : {}),
        answers: normalizedAnswers,
        score: 0,
        needsReview: false,
      };
      delete nextFailed.keyVersionFlagged;
      validatedPapers.push(nextFailed);
    }
  }

  const validatedImages: Record<string, string> | undefined = images
    ? {}
    : undefined;
  if (images && validatedImages) {
    for (const [paperId, b64] of Object.entries(images)) {
      if (!paperIds.has(paperId)) {
        throw new Error(`Image references missing paper "${paperId}".`);
      }
      if (typeof b64 !== "string") {
        throw new Error(`Image for paper "${paperId}" must be a base64 string.`);
      }
      base64ToBytes(b64);
      validatedImages[paperId] = b64;
    }
  }

  return {
    exportVersion: version,
    quizzes: Array.from(quizById.values()),
    batches: batches as Batch[],
    papers: validatedPapers,
    sections: sections as Section[],
    students: students as Student[],
    ...(validatedImages ? { images: validatedImages } : {}),
  };
}

export function escapeCsvCell(value: string): string {
  return value.startsWith("=") ||
    value.startsWith("+") ||
    value.startsWith("-") ||
    value.startsWith("@")
    ? `'${value}`
    : value;
}

function formatPythonFloat(num: number): string {
  return Number.isInteger(num) ? num.toFixed(1) : String(num);
}

function formatCsvRow(cells: (string | number | boolean)[]): string {
  return cells
    .map((cell) => {
      const str =
        typeof cell === "boolean"
          ? cell
            ? "True"
            : "False"
          : typeof cell === "number"
            ? formatPythonFloat(cell)
            : String(cell);
      if (
        str.includes(",") ||
        str.includes('"') ||
        str.includes("\n") ||
        str.includes("\r")
      ) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(",");
}

export function buildBatchCsv(quiz: Quiz, papers: Paper[]): string {
  const questionCount = quiz.answerKey.length;
  const header = [
    "name",
    "date",
    "section",
    "score",
    "needs_review",
    ...Array.from({ length: questionCount }, (_, i) => `q${i + 1}`),
  ];
  const lines = [formatCsvRow(header)];

  for (const paper of papers) {
    const answers = Array.from({ length: questionCount }, (_, idx) => {
      const qNum = idx + 1;
      if (paper.corrections[qNum] !== undefined) {
        return paper.corrections[qNum];
      }
      return idx < paper.answers.length ? paper.answers[idx] : "";
    });
    lines.push(
      formatCsvRow([
        escapeCsvCell(paper.nameText),
        escapeCsvCell(paper.dateText),
        escapeCsvCell(paper.sectionText),
        paper.score,
        paper.needsReview,
        ...answers.map(escapeCsvCell),
      ]),
    );
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
