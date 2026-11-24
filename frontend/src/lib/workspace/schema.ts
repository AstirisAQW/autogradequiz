export type FlagReason = "ambiguous" | "multiple";
export type PaperStatus = "done";
export type KeyVersionId = "A" | "B" | "C" | "D";

export const KEY_VERSION_IDS: readonly KeyVersionId[] = ["A", "B", "C", "D"];

export interface FolderSummary {
  name: string;
  createdAt: string;
  lastModified: string;
  classCount: number;
  studentCount: number;
  quizCount: number;
  paperCount: number;
  needsReviewCount?: number;
}

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
  classIds?: string[];
  tags?: string[];
  answerKey: string[];
  points?: number[];
  questionRules?: QuestionRule[];
  keyVersions?: Partial<Record<KeyVersionId, KeyVersionData>>;
  createdAt: string;
}

export interface PaperImagePaths {
  raw: string;
  aligned: string;
}

export interface Paper {
  id: string;
  quizId: string;
  status: PaperStatus;
  answers: string[];
  flags: Record<string, FlagReason>;
  confidence: number[];
  keyVersion?: KeyVersionId;
  detectedKeyVersion?: string;
  keyVersionFlagged?: boolean;
  nameText: string;
  dateText: string;
  classText: string;
  studentIdText?: string;
  studentId: string | null;
  corrections: Record<number, string>;
  score: number;
  needsReview: boolean;
  imagePaths?: PaperImagePaths;
  createdAt: string;
}

export interface ClassRecord {
  id: string;
  name: string;
  term: string;
  createdAt: string;
}

export interface ClassWithCount extends ClassRecord {
  studentCount: number;
}

export interface Student {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  externalRef: string;
  classIds: string[];
  createdAt: string;
}

export interface Roster {
  classes: ClassWithCount[];
  students: Student[];
}

export interface QuizWorkspace {
  quiz: Quiz;
  papers: Paper[];
}

export interface QuizSummary extends Quiz {
  paperCount: number;
  needsReviewCount: number;
}

export interface ReviewQueueItem extends Paper {
  quizName: string;
  answerKey: string[];
  points?: number[];
  questionRules?: QuestionRule[];
  availableKeyVersions?: KeyVersionId[];
  earnedPoints: number;
  totalPoints: number;
}

export interface ClassSummary extends ClassWithCount {
  quizCount: number;
}

export interface ClassDetail {
  class: ClassWithCount;
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
  classes: ClassRecord[];
  gradedPapers: StudentGradedPaperItem[];
}
