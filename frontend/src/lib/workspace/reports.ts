import {
  associatedSectionIdsForQuiz,
  summarizeQuizzesWithCounts,
} from "./helpers.ts";
import { computePaperPoints } from "./papers.ts";
import type {
  Batch,
  ClassDetail,
  ClassSummary,
  Section,
  StudentDetail,
  StudentGradedPaperItem,
} from "./schema.ts";
import { getDb } from "./store.ts";

export async function listClassSummaries(): Promise<ClassSummary[]> {
  const db = await getDb();
  const tx = db.transaction(
    ["sections", "students", "quizzes", "batches"],
    "readonly",
  );
  const [sections, students, quizzes, batches] = await Promise.all([
    tx.objectStore("sections").getAll(),
    tx.objectStore("students").getAll(),
    tx.objectStore("quizzes").getAll(),
    tx.objectStore("batches").getAll(),
  ]);
  await tx.done;

  const studentCounts = new Map<string, number>();
  for (const stu of students) {
    for (const secId of stu.sectionIds) {
      studentCounts.set(secId, (studentCounts.get(secId) ?? 0) + 1);
    }
  }

  const batchesByQuiz = new Map<string, Batch[]>();
  for (const b of batches) {
    const list = batchesByQuiz.get(b.quizId) ?? [];
    list.push(b);
    batchesByQuiz.set(b.quizId, list);
  }

  const quizCounts = new Map<string, number>();
  for (const q of quizzes) {
    for (const secId of associatedSectionIdsForQuiz(
      q,
      batchesByQuiz.get(q.id) ?? [],
    )) {
      quizCounts.set(secId, (quizCounts.get(secId) ?? 0) + 1);
    }
  }

  return [...sections]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((sec) => ({
      ...sec,
      studentCount: studentCounts.get(sec.id) ?? 0,
      quizCount: quizCounts.get(sec.id) ?? 0,
    }));
}

export async function getClassDetail(
  sectionId: string,
): Promise<ClassDetail | null> {
  const db = await getDb();
  const tx = db.transaction(
    ["sections", "students", "quizzes", "batches", "papers"],
    "readonly",
  );
  const [section, students, quizzes, batches, papers] = await Promise.all([
    tx.objectStore("sections").get(sectionId),
    tx.objectStore("students").getAll(),
    tx.objectStore("quizzes").getAll(),
    tx.objectStore("batches").getAll(),
    tx.objectStore("papers").getAll(),
  ]);
  await tx.done;

  if (!section) return null;

  const enrolledStudents = [...students]
    .filter((s) => s.sectionIds.includes(sectionId))
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    );

  const { summaries, batchesByQuiz } = summarizeQuizzesWithCounts(
    quizzes,
    batches,
    papers,
  );
  const classQuizzes = summaries.filter((q) =>
    associatedSectionIdsForQuiz(q, batchesByQuiz.get(q.id) ?? []).has(
      sectionId,
    ),
  );

  return {
    section: { ...section, studentCount: enrolledStudents.length },
    students: enrolledStudents,
    quizzes: classQuizzes,
  };
}

export async function getStudentDetail(
  studentId: string,
): Promise<StudentDetail | null> {
  const db = await getDb();
  const tx = db.transaction(
    ["students", "sections", "papers", "batches", "quizzes"],
    "readonly",
  );
  const [student, sections, papers, batches, quizzes] = await Promise.all([
    tx.objectStore("students").get(studentId),
    tx.objectStore("sections").getAll(),
    tx.objectStore("papers").getAll(),
    tx.objectStore("batches").getAll(),
    tx.objectStore("quizzes").getAll(),
  ]);
  await tx.done;

  if (!student) return null;

  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const enrolledSections = student.sectionIds
    .map((id) => sectionById.get(id))
    .filter((s): s is Section => s !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));

  const batchById = new Map(batches.map((b) => [b.id, b]));
  const quizById = new Map(quizzes.map((q) => [q.id, q]));

  const gradedPapers: StudentGradedPaperItem[] = [];
  for (const paper of papers) {
    if (paper.studentId !== student.id || paper.status !== "done") continue;
    const batch = batchById.get(paper.batchId);
    const quiz = batch ? quizById.get(batch.quizId) : undefined;
    if (!quiz) continue;
    const { earnedPoints, totalPoints } = computePaperPoints(quiz, paper);
    gradedPapers.push({ paper, quiz, earnedPoints, totalPoints });
  }

  gradedPapers.sort((a, b) =>
    (b.quiz.date || b.paper.createdAt).localeCompare(
      a.quiz.date || a.paper.createdAt,
    ),
  );

  return {
    student,
    sections: enrolledSections,
    gradedPapers,
  };
}
