export const DB_NAME = "autogradequiz-workspace";
export const SCHEMA_VERSION = 1;

export type FlagReason = "ambiguous" | "multiple";
export type PaperStatus = "done" | "failed";
export type KeyVersionId = "A" | "B" | "C" | "D";

export const KEY_VERSION_IDS: readonly KeyVersionId[] = ["A", "B", "C", "D"];

export interface AlternateAnswerRule {
  choice: string;
  points: number;
}

export interface QuestionRule {
  alternateAnswers?: AlternateAnswerRule[];
  incorrectPoints?: number;
  tags?: string[];
}

export interface KeyVersionData {
  answerKey: string[];
  points?: number[];
  questionRules?: QuestionRule[];
}

export interface Quiz {
  id: string;
  name: string;
  templateId: string;
  date?: string;
  folder?: string;
  sectionIds?: string[];
  tags?: string[];
  answerKey: string[];
  points?: number[];
  questionRules?: QuestionRule[];
  keyVersions?: Partial<Record<KeyVersionId, KeyVersionData>>;
  createdAt: string;
}

export interface Batch {
  id: string;
  quizId: string;
  sectionId: string | null;
  createdAt: string;
}

export interface Paper {
  id: string;
  batchId: string;
  status: PaperStatus;
  error?: string;
  answers: string[];
  flags: Record<string, FlagReason>;
  confidence: number[];
  keyVersion?: KeyVersionId;
  detectedKeyVersion?: string;
  keyVersionFlagged?: boolean;
  nameText: string;
  dateText: string;
  sectionText: string;
  studentIdText?: string;
  studentId: string | null;
  corrections: Record<number, string>;
  score: number;
  needsReview: boolean;
  createdAt: string;
}

export interface PaperImage {
  paperId: string;
  blob: Blob;
}

export interface Section {
  id: string;
  name: string;
  term: string;
  createdAt: string;
}

export interface SectionWithCount extends Section {
  studentCount: number;
}

export interface Student {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  externalRef: string;
  sectionIds: string[];
  createdAt: string;
}

export interface Roster {
  sections: SectionWithCount[];
  students: Student[];
}

/** Response shape returned by stateless POST /grade. */
export interface StatelessGradeResult {
  answers: string[];
  flags: Record<string, FlagReason>;
  confidence: number[];
  score: number;
  needs_review: boolean;
  key_version?: string;
  key_version_detected?: string;
  key_version_flagged?: boolean;
  name_text: string;
  date_text: string;
  section_text: string;
  student_id_text?: string;
}

export interface QuizWorkspace {
  quiz: Quiz;
  batches: Batch[];
  activeBatch: Batch | null;
  papers: Paper[];
  allPapers: Paper[];
  batchPaperCounts: Record<string, number>;
}

export interface QuizSummary extends Quiz {
  batchCount: number;
  paperCount: number;
  needsReviewCount: number;
}

export interface ReviewQueueItem extends Paper {
  quizId: string;
  quizName: string;
  answerKey: string[];
  questionRules?: QuestionRule[];
  availableKeyVersions?: KeyVersionId[];
  earnedPoints: number;
  totalPoints: number;
}

export interface ClassSummary extends SectionWithCount {
  quizCount: number;
}

export interface ClassDetail {
  section: SectionWithCount;
  students: Student[];
  quizzes: QuizSummary[];
}

export interface StudentGradedPaperItem {
  paper: Paper;
  quiz: Quiz;
  earnedPoints: number;
  totalPoints: number;
}

export interface StudentDetail {
  student: Student;
  sections: Section[];
  gradedPapers: StudentGradedPaperItem[];
}

export interface WorkspaceSaveStatus {
  lastSavedAt: string | null;
  lastExportedAt: string | null;
  changesSinceBackup: number;
  isBackupStale: boolean;
}
