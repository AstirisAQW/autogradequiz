import { rescore } from "../scoring.ts";
import {
  ensureSectionInTx,
  findStudentByCode,
  hasMinAlnum,
  markWorkspaceSaved,
  nextCreatedAt,
  parseFullName,
  sortByCreatedAsc,
} from "./helpers.ts";
import { getAvailableKeyVersions, resolveQuizKeyForVersion } from "./keyVersion.ts";
import type {
  KeyVersionId,
  Paper,
  Quiz,
  ReviewQueueItem,
  StatelessGradeResult,
  Student,
} from "./schema.ts";
import { validateCorrections } from "./serialize.ts";
import { getDb } from "./store.ts";

function isKeyVersionFlaggedForQuiz(
  quiz: Quiz | undefined,
  gradeResult: StatelessGradeResult,
  detectedKeyVer: string,
): boolean {
  if (!quiz) return false;
  const available = getAvailableKeyVersions(quiz);
  if (available.length <= 1) return false;
  if (gradeResult.key_version_flagged) return true;
  if (
    detectedKeyVer &&
    !available.includes(detectedKeyVer as KeyVersionId)
  ) {
    return true;
  }
  return false;
}

export async function addPaper(
  batchId: string,
  gradeResult: StatelessGradeResult,
  imageBlob: Blob,
  options?: { id?: string },
): Promise<Paper> {
  const db = await getDb();
  const tx = db.transaction(
    ["papers", "paperImages", "students", "sections", "batches", "quizzes"],
    "readwrite",
  );
  const batchStore = tx.objectStore("batches");
  const studentStore = tx.objectStore("students");
  const sectionStore = tx.objectStore("sections");

  const batch = await batchStore.get(batchId);
  if (!batch) {
    throw new Error(`Batch ${batchId} not found.`);
  }
  const quiz = await tx.objectStore("quizzes").get(batch.quizId);
  const detectedKeyVer = (gradeResult.key_version_detected ?? "")
    .trim()
    .toUpperCase();
  const activeKeyVer = quiz
    ? resolveQuizKeyForVersion(
        quiz,
        gradeResult.key_version ?? (detectedKeyVer || "A"),
      ).version
    : "A";
  const storeKv =
    gradeResult.key_version !== undefined || detectedKeyVer !== ""
      ? activeKeyVer
      : undefined;
  const kvFlagged = isKeyVersionFlaggedForQuiz(
    quiz,
    gradeResult,
    detectedKeyVer,
  );

  const [allStudents, allSections] = await Promise.all([
    studentStore.getAll(),
    sectionStore.getAll(),
  ]);

  let matchedStudentId: string | null = null;
  let resolvedNameText = gradeResult.name_text;
  let resolvedSectionText = gradeResult.section_text;
  const scannedCode = (gradeResult.student_id_text ?? "").trim();

  if (hasMinAlnum(scannedCode, 2)) {
    const matched = findStudentByCode(allStudents, scannedCode);
    if (matched) {
      matchedStudentId = matched.id;
      if (!resolvedNameText.trim()) {
        resolvedNameText = `${matched.lastName}, ${matched.firstName}`;
      }
      const syncedSection = await ensureSectionInTx(
        resolvedSectionText,
        allSections,
        sectionStore,
      );
      if (syncedSection) {
        if (!matched.sectionIds.includes(syncedSection.id)) {
          await studentStore.put({
            ...matched,
            sectionIds: [...matched.sectionIds, syncedSection.id],
          });
        }
      } else if (
        !resolvedSectionText.trim() &&
        matched.sectionIds.length > 0
      ) {
        const firstSection = allSections.find(
          (s) => s.id === matched.sectionIds[0],
        );
        if (firstSection) {
          resolvedSectionText = firstSection.name;
        }
      }
      const batchSectionTarget =
        syncedSection?.id ?? matched.sectionIds[0] ?? null;
      if (batch.sectionId === null && batchSectionTarget) {
        await batchStore.put({ ...batch, sectionId: batchSectionTarget });
      }
    } else {
      const parsedName = parseFullName(resolvedNameText);
      if (parsedName) {
        const syncedSection = await ensureSectionInTx(
          resolvedSectionText,
          allSections,
          sectionStore,
        );
        const createdStudent: Student = {
          id: crypto.randomUUID(),
          studentCode: scannedCode,
          firstName: parsedName.firstName,
          lastName: parsedName.lastName,
          externalRef: "",
          sectionIds: syncedSection ? [syncedSection.id] : [],
          createdAt: nextCreatedAt(),
        };
        await studentStore.put(createdStudent);
        matchedStudentId = createdStudent.id;
        if (batch.sectionId === null && syncedSection) {
          await batchStore.put({ ...batch, sectionId: syncedSection.id });
        }
      }
    }
  }

  const paper: Paper = {
    id: options?.id ?? crypto.randomUUID(),
    batchId,
    status: "done",
    answers: [...gradeResult.answers],
    flags: { ...gradeResult.flags },
    confidence: [...gradeResult.confidence],
    ...(storeKv !== undefined ? { keyVersion: storeKv } : {}),
    ...(detectedKeyVer ? { detectedKeyVersion: detectedKeyVer } : {}),
    ...(kvFlagged ? { keyVersionFlagged: true } : {}),
    nameText: resolvedNameText,
    dateText: gradeResult.date_text,
    sectionText: resolvedSectionText,
    studentIdText: scannedCode,
    studentId: matchedStudentId,
    corrections: {},
    score: gradeResult.score,
    needsReview: Boolean(gradeResult.needs_review) || kvFlagged,
    createdAt: nextCreatedAt(),
  };

  await tx.objectStore("papers").put(paper);
  await tx
    .objectStore("paperImages")
    .put({ paperId: paper.id, blob: imageBlob });
  await tx.done;
  markWorkspaceSaved();
  return paper;
}

export async function addFailedPaper(
  batchId: string,
  error: string,
  imageBlob?: Blob | null,
): Promise<Paper> {
  const db = await getDb();
  const batch = await db.get("batches", batchId);
  if (!batch) {
    throw new Error(`Batch ${batchId} not found.`);
  }
  const paper: Paper = {
    id: crypto.randomUUID(),
    batchId,
    status: "failed",
    error,
    answers: [],
    flags: {},
    confidence: [],
    nameText: "",
    dateText: "",
    sectionText: "",
    studentId: null,
    corrections: {},
    score: 0,
    needsReview: false,
    createdAt: nextCreatedAt(),
  };

  const tx = db.transaction(["papers", "paperImages"], "readwrite");
  await tx.objectStore("papers").put(paper);
  if (imageBlob) {
    await tx
      .objectStore("paperImages")
      .put({ paperId: paper.id, blob: imageBlob });
  }
  await tx.done;
  markWorkspaceSaved();
  return paper;
}

export async function replacePaperResult(
  paperId: string,
  gradeResult: StatelessGradeResult,
  imageBlob: Blob,
): Promise<Paper> {
  const db = await getDb();
  const existing = await db.get("papers", paperId);
  if (!existing) {
    throw new Error(`Paper ${paperId} not found.`);
  }
  const batch = await db.get("batches", existing.batchId);
  if (!batch) {
    throw new Error(`Batch ${existing.batchId} not found.`);
  }
  const quiz = await db.get("quizzes", batch.quizId);
  if (!quiz) {
    throw new Error(`Quiz ${batch.quizId} not found.`);
  }

  const resolved = resolveQuizKeyForVersion(
    quiz,
    gradeResult.key_version ?? existing.keyVersion ?? "A",
  );
  const detectedKv = (gradeResult.key_version_detected ?? "")
    .trim()
    .toUpperCase();
  const kvFlagged = isKeyVersionFlaggedForQuiz(quiz, gradeResult, detectedKv);
  const { score, needsReview } = rescore({
    answerKey: resolved.answerKey,
    points: resolved.points,
    questionRules: resolved.questionRules,
    keyVersionFlagged: kvFlagged,
    answers: gradeResult.answers,
    flags: gradeResult.flags,
    corrections: existing.corrections,
  });

  const updated: Paper = {
    ...existing,
    status: "done",
    error: undefined,
    answers: [...gradeResult.answers],
    flags: { ...gradeResult.flags },
    confidence: [...gradeResult.confidence],
    ...(gradeResult.key_version !== undefined ||
    existing.keyVersion !== undefined
      ? { keyVersion: resolved.version }
      : {}),
    ...(detectedKv ? { detectedKeyVersion: detectedKv } : {}),
    studentId: existing.studentId,
    nameText: existing.nameText || gradeResult.name_text,
    dateText: existing.dateText || gradeResult.date_text,
    sectionText: existing.sectionText || gradeResult.section_text,
    studentIdText:
      existing.studentIdText || (gradeResult.student_id_text ?? "").trim(),
    corrections: { ...existing.corrections },
    score,
    needsReview,
  };
  if (kvFlagged) {
    updated.keyVersionFlagged = true;
  } else {
    delete updated.keyVersionFlagged;
  }

  const tx = db.transaction(["papers", "paperImages"], "readwrite");
  await tx.objectStore("papers").put(updated);
  await tx
    .objectStore("paperImages")
    .put({ paperId: updated.id, blob: imageBlob });
  await tx.done;
  markWorkspaceSaved();
  return updated;
}

export async function deletePaper(paperId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["papers", "paperImages"], "readwrite");
  await tx.objectStore("paperImages").delete(paperId);
  await tx.objectStore("papers").delete(paperId);
  await tx.done;
  markWorkspaceSaved();
}

export async function getPaperSnapshot(
  paperId: string,
): Promise<{ paper: Paper; imageBlob: Blob | null } | null> {
  const db = await getDb();
  const tx = db.transaction(["papers", "paperImages"], "readonly");
  const [paper, imgRecord] = await Promise.all([
    tx.objectStore("papers").get(paperId),
    tx.objectStore("paperImages").get(paperId),
  ]);
  await tx.done;
  if (!paper) return null;
  return { paper, imageBlob: imgRecord?.blob ?? null };
}

export async function restorePaperSnapshot(snapshot: {
  paper: Paper;
  imageBlob: Blob | null;
}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["papers", "paperImages"], "readwrite");
  await tx.objectStore("papers").put(snapshot.paper);
  if (snapshot.imageBlob) {
    await tx
      .objectStore("paperImages")
      .put({ paperId: snapshot.paper.id, blob: snapshot.imageBlob });
  }
  await tx.done;
  markWorkspaceSaved();
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

  const totalDefault = activeKey
    ? activeKey.reduce((sum, _, idx) => {
        const w = activePoints ? Number(activePoints[idx] ?? 1) : 1;
        const altMax = Math.max(
          0,
          ...(activeRules?.[idx]?.alternateAnswers ?? []).map((a) =>
            Number(a.points),
          ),
        );
        return sum + Math.max(w, altMax, 0);
      }, 0)
    : paper.answers.length;

  if (
    !quiz ||
    !activeKey ||
    paper.status !== "done" ||
    paper.answers.length !== activeKey.length
  ) {
    return { earnedPoints: 0, totalPoints: totalDefault };
  }
  const { earnedPoints, totalPoints } = rescore({
    answerKey: activeKey,
    points: activePoints,
    questionRules: activeRules,
    answers: paper.answers,
    flags: paper.flags,
    corrections: paper.corrections,
  });
  return { earnedPoints, totalPoints };
}

export async function getReviewQueue(): Promise<ReviewQueueItem[]> {
  const db = await getDb();
  const [papers, batches, quizzes] = await Promise.all([
    db.getAll("papers"),
    db.getAll("batches"),
    db.getAll("quizzes"),
  ]);
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const quizById = new Map(quizzes.map((q) => [q.id, q]));

  const flagged = sortByCreatedAsc(papers.filter((p) => p.needsReview));
  return flagged.map((paper) => {
    const batch = batchById.get(paper.batchId);
    const quiz = batch ? quizById.get(batch.quizId) : undefined;
    const resolved = quiz
      ? resolveQuizKeyForVersion(quiz, paper.keyVersion)
      : undefined;
    const { earnedPoints, totalPoints } = computePaperPoints(quiz, paper);
    return {
      ...paper,
      quizId: quiz?.id ?? "",
      quizName: quiz?.name ?? "",
      answerKey: resolved?.answerKey ?? [],
      ...(resolved?.questionRules
        ? { questionRules: resolved.questionRules }
        : {}),
      ...(quiz
        ? { availableKeyVersions: getAvailableKeyVersions(quiz) }
        : {}),
      earnedPoints,
      totalPoints,
    };
  });
}

export async function submitReview(
  paperId: string,
  update: {
    corrections?: Record<number, string>;
    keyVersion?: KeyVersionId;
    identity?: {
      nameText?: string;
      dateText?: string;
      sectionText?: string;
      studentIdText?: string;
      studentId?: string | null;
    };
  },
): Promise<Paper> {
  const db = await getDb();
  const tx = db.transaction(
    ["papers", "batches", "quizzes", "students", "sections"],
    "readwrite",
  );
  const paper = await tx.objectStore("papers").get(paperId);
  if (!paper) {
    throw new Error(`Paper ${paperId} not found.`);
  }
  if (paper.status !== "done") {
    throw new Error(
      `Cannot review paper ${paperId} with status "${paper.status}".`,
    );
  }
  if (paper.answers.length === 0) {
    throw new Error(`Paper ${paperId} has no graded answers to correct.`);
  }
  const batchStore = tx.objectStore("batches");
  const batch = await batchStore.get(paper.batchId);
  if (!batch) {
    throw new Error(`Batch ${paper.batchId} not found.`);
  }
  const quiz = await tx.objectStore("quizzes").get(batch.quizId);
  if (!quiz) {
    throw new Error(`Quiz ${batch.quizId} not found.`);
  }

  if (update.corrections) {
    validateCorrections(quiz.answerKey.length, update.corrections);
  }

  const nextCorrections = update.corrections
    ? { ...paper.corrections, ...update.corrections }
    : paper.corrections;

  const studentStore = tx.objectStore("students");
  const sectionStore = tx.objectStore("sections");
  const [allStudents, allSections] = await Promise.all([
    studentStore.getAll(),
    sectionStore.getAll(),
  ]);

  const nextIdentity = update.identity ?? {};
  let nextStudentId =
    nextIdentity.studentId !== undefined
      ? nextIdentity.studentId
      : paper.studentId;

  let resolvedStudentIdText =
    nextIdentity.studentIdText !== undefined
      ? nextIdentity.studentIdText.trim()
      : (paper.studentIdText ?? "");

  let resolvedNameText =
    nextIdentity.nameText !== undefined
      ? nextIdentity.nameText
      : paper.nameText;

  const resolvedSectionText =
    nextIdentity.sectionText !== undefined
      ? nextIdentity.sectionText
      : paper.sectionText;

  const hasTextIdentityEdits =
    nextIdentity.nameText !== undefined ||
    nextIdentity.sectionText !== undefined ||
    nextIdentity.studentIdText !== undefined;

  if (nextStudentId === null && nextIdentity.studentId === undefined) {
    if (hasMinAlnum(resolvedStudentIdText, 2)) {
      const matched = findStudentByCode(allStudents, resolvedStudentIdText);
      if (matched) {
        nextStudentId = matched.id;
      } else if (hasTextIdentityEdits) {
        const parsedName = parseFullName(resolvedNameText);
        if (parsedName) {
          const syncedSection = await ensureSectionInTx(
            resolvedSectionText,
            allSections,
            sectionStore,
          );
          const createdStudent: Student = {
            id: crypto.randomUUID(),
            studentCode: resolvedStudentIdText,
            firstName: parsedName.firstName,
            lastName: parsedName.lastName,
            externalRef: "",
            sectionIds: syncedSection ? [syncedSection.id] : [],
            createdAt: nextCreatedAt(),
          };
          await studentStore.put(createdStudent);
          nextStudentId = createdStudent.id;
          if (batch.sectionId === null && syncedSection) {
            await batchStore.put({ ...batch, sectionId: syncedSection.id });
          }
        }
      }
    }
  }

  if (nextStudentId !== null) {
    const student =
      (await studentStore.get(nextStudentId)) ??
      allStudents.find((s) => s.id === nextStudentId);
    if (!student) {
      throw new Error(`Student ${nextStudentId} not found.`);
    }
    if (nextIdentity.nameText === undefined && !paper.nameText) {
      resolvedNameText = `${student.lastName}, ${student.firstName}`;
    }
    if (!resolvedStudentIdText) {
      resolvedStudentIdText = student.studentCode;
    }

    if (hasTextIdentityEdits) {
      let dirty = false;
      const updatedStudent: Student = { ...student };

      if (nextIdentity.nameText !== undefined) {
        const parsedName = parseFullName(resolvedNameText);
        if (
          parsedName &&
          (parsedName.firstName !== student.firstName ||
            parsedName.lastName !== student.lastName)
        ) {
          updatedStudent.firstName = parsedName.firstName;
          updatedStudent.lastName = parsedName.lastName;
          dirty = true;
        }
      }

      if (
        nextIdentity.studentIdText !== undefined &&
        hasMinAlnum(resolvedStudentIdText, 2) &&
        resolvedStudentIdText !== student.studentCode &&
        !allStudents.some(
          (s) => s.id !== student.id && s.studentCode === resolvedStudentIdText,
        )
      ) {
        updatedStudent.studentCode = resolvedStudentIdText;
        dirty = true;
      }

      if (
        nextIdentity.sectionText !== undefined &&
        hasMinAlnum(resolvedSectionText, 2)
      ) {
        const syncedSection = await ensureSectionInTx(
          resolvedSectionText,
          allSections,
          sectionStore,
        );
        if (syncedSection) {
          if (!updatedStudent.sectionIds.includes(syncedSection.id)) {
            updatedStudent.sectionIds = [
              ...updatedStudent.sectionIds,
              syncedSection.id,
            ];
            dirty = true;
          }
          if (batch.sectionId === null) {
            await batchStore.put({ ...batch, sectionId: syncedSection.id });
          }
        }
      }

      if (dirty) {
        await studentStore.put(updatedStudent);
      }
    }
  }

  const activeKeyData = resolveQuizKeyForVersion(
    quiz,
    update.keyVersion ?? paper.keyVersion ?? "A",
  );
  const multiKey = getAvailableKeyVersions(quiz).length > 1;
  const nextKvFlagged =
    update.keyVersion !== undefined
      ? false
      : multiKey && Boolean(paper.keyVersionFlagged);

  const { score, needsReview } = rescore({
    answerKey: activeKeyData.answerKey,
    points: activeKeyData.points,
    questionRules: activeKeyData.questionRules,
    keyVersionFlagged: nextKvFlagged,
    answers: paper.answers,
    flags: paper.flags,
    corrections: nextCorrections,
  });

  const updated: Paper = {
    ...paper,
    ...(update.keyVersion !== undefined || paper.keyVersion !== undefined
      ? { keyVersion: activeKeyData.version }
      : {}),
    nameText: resolvedNameText,
    dateText:
      nextIdentity.dateText !== undefined
        ? nextIdentity.dateText
        : paper.dateText,
    sectionText: resolvedSectionText,
    studentIdText: resolvedStudentIdText,
    studentId: nextStudentId,
    corrections: nextCorrections,
    score,
    needsReview,
  };
  if (nextKvFlagged) {
    updated.keyVersionFlagged = true;
  } else {
    delete updated.keyVersionFlagged;
  }

  await tx.objectStore("papers").put(updated);
  await tx.done;
  markWorkspaceSaved();
  return updated;
}

export async function getPaperImageUrl(
  paperId: string,
): Promise<string | null> {
  const db = await getDb();
  const record = await db.get("paperImages", paperId);
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}
