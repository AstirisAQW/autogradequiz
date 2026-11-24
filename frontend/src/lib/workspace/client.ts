import { API_BASE_URL, ApiError, request, requestBlob } from "../api.ts";
import { scorePaper } from "../scoring.ts";
import {
  getActiveFolder,
  notifyWorkspaceChanged,
  requireActiveFolder,
  setActiveFolder,
} from "./activeFolder.ts";
import { resolveQuizKeyForVersion } from "./keyVersion.ts";
import type {
  ClassDetail,
  ClassSummary,
  ClassWithCount,
  FolderSummary,
  KeyVersionData,
  KeyVersionId,
  Paper,
  QuestionRule,
  Quiz,
  QuizSummary,
  QuizWorkspace,
  ReviewQueueItem,
  Roster,
  Student,
  StudentDetail,
} from "./schema.ts";

function folderPath(folderName?: string): string {
  const target = folderName ?? requireActiveFolder();
  return `/workspace/folders/${encodeURIComponent(target)}`;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function requestOrNull<T>(path: string): Promise<T | null> {
  try {
    return await request<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

const INVALID_FOLDER_CHARS = /[\\/:*?"<>|]/;

export function validateFolderName(
  raw: string,
  folders: Pick<FolderSummary, "name">[],
  currentNameToIgnore?: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Folder name is required";
  if (INVALID_FOLDER_CHARS.test(trimmed)) {
    return 'Folder name cannot contain \\ / : * ? " < > |';
  }
  const conflict = folders.some(
    (f) =>
      f.name.toLowerCase() === trimmed.toLowerCase() &&
      f.name !== currentNameToIgnore,
  );
  if (conflict) return `A folder named "${trimmed}" already exists`;
  return null;
}


export function listFolders(): Promise<FolderSummary[]> {
  return request<FolderSummary[]>("/workspace/folders");
}

export async function createFolder(
  name: string,
  copyRosterFrom?: string,
): Promise<FolderSummary> {
  const created = await request<FolderSummary>(
    "/workspace/folders",
    jsonInit("POST", {
      name,
      ...(copyRosterFrom ? { copyRosterFrom } : {}),
    }),
  );
  notifyWorkspaceChanged();
  return created;
}

export async function renameFolder(
  oldName: string,
  newName: string,
): Promise<FolderSummary> {
  const updated = await request<FolderSummary>(
    folderPath(oldName),
    jsonInit("PATCH", { name: newName }),
  );
  if (getActiveFolder() === oldName) {
    setActiveFolder(updated.name);
  }
  notifyWorkspaceChanged();
  return updated;
}

export async function deleteFolder(name: string): Promise<void> {
  await request<void>(folderPath(name), { method: "DELETE" });
  if (getActiveFolder() === name) {
    setActiveFolder(null);
  }
  notifyWorkspaceChanged();
}


export function getRoster(): Promise<Roster> {
  return request<Roster>(`${folderPath()}/roster`);
}

export function listClassSummaries(): Promise<ClassSummary[]> {
  return request<ClassSummary[]>(`${folderPath()}/classes`);
}

export function getClassDetail(classId: string): Promise<ClassDetail | null> {
  return requestOrNull<ClassDetail>(
    `${folderPath()}/classes/${encodeURIComponent(classId)}`,
  );
}

export async function saveClass(input: {
  id?: string;
  name: string;
  term?: string;
}): Promise<ClassWithCount> {
  const body = {
    name: input.name,
    ...(input.term !== undefined ? { term: input.term } : {}),
  };
  const saved = input.id
    ? await request<ClassWithCount>(
        `${folderPath()}/classes/${encodeURIComponent(input.id)}`,
        jsonInit("PUT", body),
      )
    : await request<ClassWithCount>(
        `${folderPath()}/classes`,
        jsonInit("POST", body),
      );
  notifyWorkspaceChanged();
  return saved;
}

export async function deleteClass(classId: string): Promise<void> {
  await request<void>(
    `${folderPath()}/classes/${encodeURIComponent(classId)}`,
    { method: "DELETE" },
  );
  notifyWorkspaceChanged();
}

export function getStudentDetail(
  studentId: string,
): Promise<StudentDetail | null> {
  return requestOrNull<StudentDetail>(
    `${folderPath()}/students/${encodeURIComponent(studentId)}`,
  );
}

export async function saveStudent(input: {
  id?: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  externalRef?: string;
  classIds?: string[];
}): Promise<Student> {
  const body = {
    studentCode: input.studentCode,
    firstName: input.firstName,
    lastName: input.lastName,
    ...(input.externalRef !== undefined
      ? { externalRef: input.externalRef }
      : {}),
    ...(input.classIds !== undefined ? { classIds: input.classIds } : {}),
  };
  const saved = input.id
    ? await request<Student>(
        `${folderPath()}/students/${encodeURIComponent(input.id)}`,
        jsonInit("PUT", body),
      )
    : await request<Student>(
        `${folderPath()}/students`,
        jsonInit("POST", body),
      );
  notifyWorkspaceChanged();
  return saved;
}

export async function importStudents(
  students: Array<{
    studentCode?: string;
    firstName: string;
    lastName: string;
    externalRef?: string;
    className?: string;
  }>,
): Promise<{ imported: number; skipped: number; students: Student[] }> {
  const result = await request<{
    imported: number;
    skipped: number;
    students: Student[];
  }>(`${folderPath()}/students/import`, jsonInit("POST", { students }));
  if (result.imported > 0) {
    notifyWorkspaceChanged();
  }
  return result;
}

export async function deleteStudent(studentId: string): Promise<void> {
  await request<void>(
    `${folderPath()}/students/${encodeURIComponent(studentId)}`,
    { method: "DELETE" },
  );
  notifyWorkspaceChanged();
}

export function generateUniqueStudentCode(
  existingStudents: Pick<Student, "studentCode">[],
): string {
  const normalizeCode = (code: string) =>
    code.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const used = new Set(
    existingStudents.map((s) => normalizeCode(s.studentCode)),
  );
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


export function listQuizSummaries(): Promise<QuizSummary[]> {
  return request<QuizSummary[]>(`${folderPath()}/quizzes`);
}

export function getQuizWorkspace(
  quizId: string,
): Promise<QuizWorkspace | null> {
  return requestOrNull<QuizWorkspace>(
    `${folderPath()}/quizzes/${encodeURIComponent(quizId)}`,
  );
}

export async function saveQuiz(input: {
  id?: string;
  name: string;
  templateId: string;
  answerKey: string[];
  points?: number[];
  date?: string;
  classIds?: string[];
  tags?: string[];
  questionRules?: QuestionRule[];
  keyVersions?: Partial<Record<KeyVersionId, KeyVersionData>>;
}): Promise<Quiz> {
  const body = {
    name: input.name,
    templateId: input.templateId,
    answerKey: input.answerKey,
    ...(input.points !== undefined ? { points: input.points } : {}),
    ...(input.date !== undefined ? { date: input.date } : {}),
    ...(input.classIds !== undefined ? { classIds: input.classIds } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.questionRules !== undefined
      ? { questionRules: input.questionRules }
      : {}),
    ...(input.keyVersions !== undefined
      ? { keyVersions: input.keyVersions }
      : {}),
  };
  const saved = input.id
    ? await request<Quiz>(
        `${folderPath()}/quizzes/${encodeURIComponent(input.id)}`,
        jsonInit("PUT", body),
      )
    : await request<Quiz>(
        `${folderPath()}/quizzes`,
        jsonInit("POST", body),
      );
  notifyWorkspaceChanged();
  return saved;
}

export async function deleteQuiz(quizId: string): Promise<void> {
  await request<void>(
    `${folderPath()}/quizzes/${encodeURIComponent(quizId)}`,
    { method: "DELETE" },
  );
  notifyWorkspaceChanged();
}

export function exportQuizCsv(quizId: string): Promise<Blob> {
  return requestBlob(
    `${folderPath()}/quizzes/${encodeURIComponent(quizId)}/export.csv`,
  );
}


export async function gradeQuizPaper(
  quizId: string,
  file: File,
  paperId?: string,
  options?: { notify?: boolean },
): Promise<Paper> {
  const formData = new FormData();
  formData.append("file", file);
  if (paperId) {
    formData.append("paper_id", paperId);
  }
  const paper = await request<Paper>(
    `${folderPath()}/quizzes/${encodeURIComponent(quizId)}/grade`,
    {
      method: "POST",
      body: formData,
    },
  );
  if (options?.notify !== false) {
    notifyWorkspaceChanged();
  }
  return paper;
}

export function getReviewQueue(): Promise<ReviewQueueItem[]> {
  return request<ReviewQueueItem[]>(`${folderPath()}/review`);
}

export async function submitReview(
  quizId: string,
  paperId: string,
  update: {
    corrections?: Record<number, string>;
    keyVersion?: KeyVersionId;
    identity?: {
      nameText?: string;
      dateText?: string;
      classText?: string;
      studentIdText?: string;
      studentId?: string | null;
    };
  },
): Promise<Paper> {
  const updated = await request<Paper>(
    `${folderPath()}/quizzes/${encodeURIComponent(quizId)}/papers/${encodeURIComponent(paperId)}`,
    jsonInit("PATCH", update),
  );
  notifyWorkspaceChanged();
  return updated;
}

export async function deletePaper(
  quizId: string,
  paperId: string,
): Promise<void> {
  await request<void>(
    `${folderPath()}/quizzes/${encodeURIComponent(quizId)}/papers/${encodeURIComponent(paperId)}`,
    { method: "DELETE" },
  );
  notifyWorkspaceChanged();
}

export function getPaperImageUrl(
  quizId: string,
  paperId: string,
  kind: "aligned" | "raw" = "aligned",
  cacheKey?: string | number,
): string {
  const active = getActiveFolder();
  if (!active) return "";
  const base = `${API_BASE_URL}${folderPath(active)}/quizzes/${encodeURIComponent(quizId)}/papers/${encodeURIComponent(paperId)}/image/${kind}`;
  return cacheKey !== undefined
    ? `${base}?v=${encodeURIComponent(String(cacheKey))}`
    : base;
}

export function computePaperPoints(
  quiz: Quiz | undefined,
  paper: Paper,
): { earnedPoints: number; totalPoints: number } {
  const resolved = quiz
    ? resolveQuizKeyForVersion(quiz, paper.keyVersion)
    : undefined;
  const activeKey = resolved?.answerKey ?? quiz?.answerKey;
  const activePoints = resolved?.points ?? quiz?.points;
  const activeRules = resolved?.questionRules ?? quiz?.questionRules;

  if (!quiz || !activeKey || paper.answers.length !== activeKey.length) {
    const totalDefault = activeKey
      ? scorePaper({
          answerKey: activeKey,
          points: activePoints,
          questionRules: activeRules,
          answers: Array<string>(activeKey.length).fill(""),
          flags: {},
          corrections: {},
        }).totalPoints
      : paper.answers.length;
    return { earnedPoints: 0, totalPoints: totalDefault };
  }
  const { earnedPoints, totalPoints } = scorePaper({
    answerKey: activeKey,
    points: activePoints,
    questionRules: activeRules,
    answers: paper.answers,
    flags: paper.flags,
    corrections: paper.corrections,
  });
  return { earnedPoints, totalPoints };
}
