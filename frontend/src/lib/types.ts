export const TEMPLATE_QUESTION_COUNTS = {
  "20q_a4": 20,
  "50q_a4": 50,
  "100q_a4": 100,
} as const;

export type TemplateId = keyof typeof TEMPLATE_QUESTION_COUNTS;

export const ANSWER_CHOICES = ["A", "B", "C", "D", "E"] as const;

export type AnswerChoice = (typeof ANSWER_CHOICES)[number];
export type CorrectionValue = AnswerChoice | "";
export type ScanJobStatus = "pending" | "done" | "failed";

export interface TestRecord {
  id: number;
  name: string;
  template_id: TemplateId;
  answer_key: string[];
  question_count: number;
  created_at: string;
}

export interface BatchRecord {
  id: number;
  test_id: number;
  status: string;
  created_at: string;
}

export interface ScanJobRecord {
  id: number;
  batch_id: number;
  raw_image_path: string;
  status: ScanJobStatus;
  created_at: string;
}

export interface ScanResultRecord {
  id: number;
  scan_job_id: number;
  name_text: string;
  date_text: string;
  section_text: string;
  score: number;
  answers_json: string;
  flags_json: string;
  needs_review: boolean;
  processed_image_path: string;
  error_message: string;
  created_at: string;
  status: string;
}

export interface ScanFlags {
  ambiguous: number[];
  multiple: number[];
}

export interface ParsedScanResult {
  answers: string[];
  flags: ScanFlags;
}

export function parseScanResult(
  result: Pick<ScanResultRecord, "answers_json" | "flags_json">,
): ParsedScanResult {
  let answers: string[] = [];
  let flags: ScanFlags = { ambiguous: [], multiple: [] };

  try {
    const parsed = JSON.parse(result.answers_json);
    if (Array.isArray(parsed)) {
      answers = parsed.map((item) => String(item));
    }
  } catch {
    answers = [];
  }

  try {
    const parsed = JSON.parse(result.flags_json);
    if (parsed && typeof parsed === "object") {
      flags = {
        ambiguous: Array.isArray(parsed.ambiguous)
          ? parsed.ambiguous.map(Number)
          : [],
        multiple: Array.isArray(parsed.multiple)
          ? parsed.multiple.map(Number)
          : [],
      };
    }
  } catch {
    flags = { ambiguous: [], multiple: [] };
  }

  return { answers, flags };
}
