import type { TemplateId } from "./types.ts";
import {
  base64ToBytes,
  type KeyVersionData,
  type KeyVersionId,
  type QuestionRule,
  type StatelessGradeResult,
} from "./workspace/index.ts";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function extractErrorDetail(response: Response): Promise<string> {
  if (response.status >= 500) {
    return "The server had an error. Check the backend terminal.";
  }

  const fallback = `Request failed (${response.status})`;
  const text = await response.text().catch(() => "");
  if (!text) {
    return fallback;
  }

  try {
    const body = JSON.parse(text) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
    if (Array.isArray(body.detail) && body.detail.length > 0) {
      const first = body.detail[0] as { msg?: unknown };
      if (typeof first?.msg === "string" && first.msg.trim()) {
        return first.msg;
      }
    }
  } catch {
    return text;
  }

  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError(0, `Cannot reach backend at ${API_BASE_URL}`);
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorDetail(response));
  }

  return (await response.json()) as T;
}

export interface WorkspaceScanPaths {
  raw: string;
  aligned: string;
  graded: string;
}

export interface StatelessGradeResponse extends StatelessGradeResult {
  aligned_image_jpeg_base64: string;
  graded_image_jpeg_base64?: string;
  workspace_paths?: WorkspaceScanPaths | null;
}

export interface WorkspaceDiskStatus {
  workspace_dir: string;
  has_workspace_json: boolean;
  scan_count: number;
  template_files: string[];
  last_modified: string | null;
}

export interface TemplateInfo {
  template_id: TemplateId;
  question_count: number;
}

export function templatePdfUrl(templateId: string): string {
  return `${API_BASE_URL}/workspace/templates/${encodeURIComponent(templateId)}`;
}

export function getHealth(): Promise<{ status: string }> {
  return request<{ status: string }>("/health");
}

export function getWorkspaceDiskStatus(): Promise<WorkspaceDiskStatus> {
  return request<WorkspaceDiskStatus>("/workspace/status");
}

export function getTemplates(): Promise<TemplateInfo[]> {
  return request<TemplateInfo[]>("/templates");
}

export function gradeSheet(params: {
  file: File;
  templateId: string;
  answerKey: string[];
  points?: number[];
  questionRules?: QuestionRule[];
  keyVersions?: Partial<Record<KeyVersionId, KeyVersionData>>;
  saveToWorkspace?: boolean;
  quizId?: string;
  quizName?: string;
  paperId?: string;
}): Promise<StatelessGradeResponse> {
  const formData = new FormData();
  formData.append("template_id", params.templateId);
  formData.append(
    "answer_key",
    JSON.stringify({
      answer_key: params.answerKey,
      ...(params.points ? { points: params.points } : {}),
      ...(params.questionRules ? { question_rules: params.questionRules } : {}),
      ...(params.keyVersions && Object.keys(params.keyVersions).length > 0
        ? { key_versions: params.keyVersions }
        : {}),
    }),
  );
  formData.append("file", params.file);
  if (params.saveToWorkspace) {
    formData.append("save_to_workspace", "true");
    if (params.quizId) formData.append("quiz_id", params.quizId);
    if (params.quizName) formData.append("quiz_name", params.quizName);
    if (params.paperId) formData.append("paper_id", params.paperId);
  }
  return request<StatelessGradeResponse>("/grade", {
    method: "POST",
    body: formData,
  });
}

export function scanKeyFromImage(
  templateId: TemplateId,
  file: File,
): Promise<{
  template_id: TemplateId;
  answer_key: string[];
  flagged_questions: number[];
}> {
  const formData = new FormData();
  formData.append("file", file);
  return request<{
    template_id: TemplateId;
    answer_key: string[];
    flagged_questions: number[];
  }>(`/tests/scan-key?template_id=${encodeURIComponent(templateId)}`, {
    method: "POST",
    body: formData,
  });
}

export function base64JpegToBlob(b64: string): Blob {
  return new Blob([base64ToBytes(b64)], { type: "image/jpeg" });
}
