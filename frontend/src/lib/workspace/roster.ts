import {
  codesMatch,
  markWorkspaceSaved,
  nextCreatedAt,
} from "./helpers.ts";
import type {
  Quiz,
  Roster,
  Section,
  SectionWithCount,
  Student,
} from "./schema.ts";
import { getDb } from "./store.ts";

export async function saveSection(input: {
  id?: string;
  name: string;
  term?: string;
}): Promise<SectionWithCount> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Section name cannot be empty.");
  }

  const db = await getDb();
  const tx = db.transaction(["sections", "students"], "readwrite");
  const sectionStore = tx.objectStore("sections");
  const allSections = await sectionStore.getAll();
  const existing = input.id ? await sectionStore.get(input.id) : undefined;
  const targetId = existing?.id ?? input.id ?? crypto.randomUUID();

  if (
    allSections.some(
      (s) =>
        s.id !== targetId &&
        s.name.trim().toLowerCase() === trimmedName.toLowerCase(),
    )
  ) {
    throw new Error(`Section '${trimmedName}' already exists.`);
  }

  const section: Section = {
    id: targetId,
    name: trimmedName,
    term:
      input.term !== undefined ? input.term.trim() : (existing?.term ?? ""),
    createdAt: existing?.createdAt ?? nextCreatedAt(),
  };
  await sectionStore.put(section);

  const allStudents = await tx.objectStore("students").getAll();
  const studentCount = allStudents.filter((stu) =>
    stu.sectionIds.includes(section.id),
  ).length;
  await tx.done;
  markWorkspaceSaved();

  return { ...section, studentCount };
}

export async function deleteSection(sectionId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ["sections", "students", "batches", "quizzes"],
    "readwrite",
  );
  const sectionStore = tx.objectStore("sections");
  const existing = await sectionStore.get(sectionId);
  if (!existing) {
    throw new Error(`Section ${sectionId} not found.`);
  }

  await sectionStore.delete(sectionId);

  const studentStore = tx.objectStore("students");
  const allStudents = await studentStore.getAll();
  for (const stu of allStudents) {
    if (stu.sectionIds.includes(sectionId)) {
      await studentStore.put({
        ...stu,
        sectionIds: stu.sectionIds.filter((id) => id !== sectionId),
      });
    }
  }

  const batchStore = tx.objectStore("batches");
  const allBatches = await batchStore.getAll();
  for (const batch of allBatches) {
    if (batch.sectionId === sectionId) {
      await batchStore.put({ ...batch, sectionId: null });
    }
  }

  const quizStore = tx.objectStore("quizzes");
  const allQuizzes = await quizStore.getAll();
  for (const quiz of allQuizzes) {
    if (quiz.sectionIds?.includes(sectionId)) {
      const remaining = quiz.sectionIds.filter((id) => id !== sectionId);
      const nextQuiz: Quiz = { ...quiz };
      if (remaining.length > 0) {
        nextQuiz.sectionIds = remaining;
      } else {
        delete nextQuiz.sectionIds;
      }
      await quizStore.put(nextQuiz);
    }
  }

  await tx.done;
  markWorkspaceSaved();
}

export async function saveStudent(input: {
  id?: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  externalRef?: string;
  sectionIds?: string[];
}): Promise<Student> {
  const code = input.studentCode.trim();
  const first = input.firstName.trim();
  const last = input.lastName.trim();
  if (!code || !first || !last) {
    throw new Error("student_code, first_name, and last_name are required.");
  }

  const db = await getDb();
  const tx = db.transaction(["students", "sections", "papers"], "readwrite");
  const studentStore = tx.objectStore("students");
  const sectionStore = tx.objectStore("sections");
  const paperStore = tx.objectStore("papers");
  const allStudents = await studentStore.getAll();
  const existing = input.id ? await studentStore.get(input.id) : undefined;
  const targetId = existing?.id ?? input.id ?? crypto.randomUUID();

  if (allStudents.some((s) => s.id !== targetId && codesMatch(s.studentCode, code))) {
    throw new Error(`Student code '${code}' already exists.`);
  }

  const rawSectionIds =
    input.sectionIds !== undefined
      ? input.sectionIds
      : (existing?.sectionIds ?? []);
  const uniqueSectionIds = Array.from(new Set(rawSectionIds));
  for (const secId of uniqueSectionIds) {
    const sec = await sectionStore.get(secId);
    if (!sec) {
      throw new Error(`Section ${secId} not found.`);
    }
  }

  const student: Student = {
    id: targetId,
    studentCode: code,
    firstName: first,
    lastName: last,
    externalRef:
      input.externalRef !== undefined
        ? input.externalRef.trim()
        : (existing?.externalRef ?? ""),
    sectionIds: uniqueSectionIds,
    createdAt: existing?.createdAt ?? nextCreatedAt(),
  };
  await studentStore.put(student);

  // Auto-link any existing unlinked papers whose scanned studentIdText matches this student's code
  const allPapers = await paperStore.getAll();
  for (const paper of allPapers) {
    if (
      paper.studentId === null &&
      codesMatch(paper.studentIdText, student.studentCode)
    ) {
      await paperStore.put({
        ...paper,
        studentId: student.id,
        nameText: paper.nameText || `${student.lastName}, ${student.firstName}`,
      });
    }
  }

  await tx.done;
  markWorkspaceSaved();
  return student;
}

export async function deleteStudent(studentId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["students", "papers"], "readwrite");
  const studentStore = tx.objectStore("students");
  const existing = await studentStore.get(studentId);
  if (!existing) {
    throw new Error(`Student ${studentId} not found.`);
  }

  await studentStore.delete(studentId);

  const paperStore = tx.objectStore("papers");
  const allPapers = await paperStore.getAll();
  for (const paper of allPapers) {
    if (paper.studentId === studentId) {
      await paperStore.put({ ...paper, studentId: null });
    }
  }

  await tx.done;
  markWorkspaceSaved();
}

export async function getRoster(): Promise<Roster> {
  const db = await getDb();
  const [sections, students] = await Promise.all([
    db.getAll("sections"),
    db.getAll("students"),
  ]);

  const counts = new Map<string, number>();
  for (const stu of students) {
    for (const secId of stu.sectionIds) {
      counts.set(secId, (counts.get(secId) ?? 0) + 1);
    }
  }

  const sectionsWithCount: SectionWithCount[] = [...sections]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((sec) => ({
      ...sec,
      studentCount: counts.get(sec.id) ?? 0,
    }));

  const sortedStudents = [...students].sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName),
  );

  return { sections: sectionsWithCount, students: sortedStudents };
}
