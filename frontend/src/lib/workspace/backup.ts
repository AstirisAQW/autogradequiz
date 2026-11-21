import { markWorkspaceExported, sortByCreatedAsc } from "./helpers.ts";
import {
  base64ToBytes,
  buildBatchCsv,
  bytesToBase64,
  parseAndValidateWorkspaceExport,
  serializeWorkspace,
} from "./serialize.ts";
import { getDb } from "./store.ts";

export async function exportWorkspaceJsonString(): Promise<string> {
  const db = await getDb();
  const tx = db.transaction(
    ["quizzes", "batches", "papers", "sections", "students"],
    "readonly",
  );
  const [quizzes, batches, papers, sections, students] = await Promise.all([
    tx.objectStore("quizzes").getAll(),
    tx.objectStore("batches").getAll(),
    tx.objectStore("papers").getAll(),
    tx.objectStore("sections").getAll(),
    tx.objectStore("students").getAll(),
  ]);
  await tx.done;

  return serializeWorkspace({
    quizzes,
    batches,
    papers,
    sections,
    students,
  });
}

export async function exportWorkspace(options?: {
  includeImages?: boolean;
}): Promise<Blob> {
  const includeImages = options?.includeImages ?? false;
  const db = await getDb();
  const tx = db.transaction(
    ["quizzes", "batches", "papers", "sections", "students", "paperImages"],
    "readonly",
  );
  const [quizzes, batches, papers, sections, students, paperImages] =
    await Promise.all([
      tx.objectStore("quizzes").getAll(),
      tx.objectStore("batches").getAll(),
      tx.objectStore("papers").getAll(),
      tx.objectStore("sections").getAll(),
      tx.objectStore("students").getAll(),
      includeImages
        ? tx.objectStore("paperImages").getAll()
        : Promise.resolve([]),
    ]);
  await tx.done;

  let images: Record<string, string> | undefined;
  if (includeImages) {
    images = {};
    for (const rec of paperImages) {
      const buf = await rec.blob.arrayBuffer();
      images[rec.paperId] = bytesToBase64(new Uint8Array(buf));
    }
  }

  const json = serializeWorkspace({
    quizzes,
    batches,
    papers,
    sections,
    students,
    images,
  });
  markWorkspaceExported();
  return new Blob([json], { type: "application/json" });
}

export async function importWorkspace(
  file: Blob | File | string,
  options?: { skipDiskSync?: boolean; onlyIfEmpty?: boolean },
): Promise<boolean> {
  const text = typeof file === "string" ? file : await file.text();
  const validated = parseAndValidateWorkspaceExport(text);

  const imageBlobs = new Map<string, Blob>();
  if (validated.images) {
    for (const [paperId, b64] of Object.entries(validated.images)) {
      const bytes = base64ToBytes(b64);
      imageBlobs.set(paperId, new Blob([bytes], { type: "image/jpeg" }));
    }
  }

  const db = await getDb();
  const tx = db.transaction(
    ["quizzes", "batches", "papers", "paperImages", "sections", "students"],
    "readwrite",
  );

  if (options?.onlyIfEmpty) {
    const [quizCount, secCount, stuCount] = await Promise.all([
      tx.objectStore("quizzes").count(),
      tx.objectStore("sections").count(),
      tx.objectStore("students").count(),
    ]);
    if (quizCount > 0 || secCount > 0 || stuCount > 0) {
      await tx.done;
      return false;
    }
  }

  await Promise.all([
    tx.objectStore("quizzes").clear(),
    tx.objectStore("batches").clear(),
    tx.objectStore("papers").clear(),
    tx.objectStore("paperImages").clear(),
    tx.objectStore("sections").clear(),
    tx.objectStore("students").clear(),
  ]);

  for (const sec of validated.sections) {
    await tx.objectStore("sections").put(sec);
  }
  for (const stu of validated.students) {
    await tx.objectStore("students").put(stu);
  }
  for (const quiz of validated.quizzes) {
    await tx.objectStore("quizzes").put(quiz);
  }
  for (const batch of validated.batches) {
    await tx.objectStore("batches").put(batch);
  }
  for (const paper of validated.papers) {
    await tx.objectStore("papers").put(paper);
  }
  for (const [paperId, blob] of imageBlobs) {
    await tx.objectStore("paperImages").put({ paperId, blob });
  }

  await tx.done;
  if (!options?.skipDiskSync) {
    markWorkspaceExported();
  }
  return true;
}

export async function exportBatchCsv(batchId: string): Promise<Blob> {
  const db = await getDb();
  const batch = await db.get("batches", batchId);
  if (!batch) {
    throw new Error(`Batch ${batchId} not found.`);
  }
  const quiz = await db.get("quizzes", batch.quizId);
  if (!quiz) {
    throw new Error(`Quiz ${batch.quizId} not found.`);
  }
  const papers = sortByCreatedAsc(
    await db.getAllFromIndex("papers", "by-batch", batchId),
  );
  const csv = buildBatchCsv(quiz, papers);
  return new Blob([csv], { type: "text/csv" });
}
