import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  DB_NAME,
  SCHEMA_VERSION,
  type Batch,
  type Paper,
  type PaperImage,
  type Quiz,
  type Section,
  type Student,
} from "./schema.ts";

export interface WorkspaceDBSchema extends DBSchema {
  quizzes: {
    key: string;
    value: Quiz;
  };
  batches: {
    key: string;
    value: Batch;
    indexes: { "by-quiz": string };
  };
  papers: {
    key: string;
    value: Paper;
    indexes: { "by-batch": string };
  };
  paperImages: {
    key: string;
    value: PaperImage;
  };
  sections: {
    key: string;
    value: Section;
  };
  students: {
    key: string;
    value: Student;
  };
}

let dbPromise: Promise<IDBPDatabase<WorkspaceDBSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<WorkspaceDBSchema>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("Workspace storage is only available in the browser."),
    );
  }
  if (!dbPromise) {
    dbPromise = openDB<WorkspaceDBSchema>(DB_NAME, SCHEMA_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("quizzes")) {
          db.createObjectStore("quizzes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("batches")) {
          const batches = db.createObjectStore("batches", { keyPath: "id" });
          batches.createIndex("by-quiz", "quizId");
        }
        if (!db.objectStoreNames.contains("papers")) {
          const papers = db.createObjectStore("papers", { keyPath: "id" });
          papers.createIndex("by-batch", "batchId");
        }
        if (!db.objectStoreNames.contains("paperImages")) {
          db.createObjectStore("paperImages", { keyPath: "paperId" });
        }
        if (!db.objectStoreNames.contains("sections")) {
          db.createObjectStore("sections", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("students")) {
          db.createObjectStore("students", { keyPath: "id" });
        }
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function closeDb(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // Ignore close error if opening failed
    } finally {
      dbPromise = null;
    }
  }
}
