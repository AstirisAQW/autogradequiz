import type { TemplateId } from "./types.ts";

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

export function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
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

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError(0, `Cannot reach backend at ${API_BASE_URL}`);
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorDetail(response));
  }
  return response;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await rawFetch(path, init);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function requestBlob(
  path: string,
  init?: RequestInit,
): Promise<Blob> {
  const response = await rawFetch(path, init);
  return response.blob();
}

export function templatePdfUrl(templateId: string): string {
  return `${API_BASE_URL}/workspace/templates/${encodeURIComponent(templateId)}`;
}

export function getHealth(): Promise<{ status: string }> {
  return request<{ status: string }>("/health");
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
  }>(`/scan-key?template_id=${encodeURIComponent(templateId)}`, {
    method: "POST",
    body: formData,
  });
}
