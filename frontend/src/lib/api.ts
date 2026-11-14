import type {
  BatchRecord,
  CorrectionValue,
  ScanJobRecord,
  ScanResultRecord,
  TemplateId,
  TestRecord,
} from "./types";

const API_BASE_URL = (
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

export function getHealth(): Promise<{ status: string }> {
  return request<{ status: string }>("/health");
}

export function createTest(payload: {
  name: string;
  template_id: TemplateId;
  answer_key: string[];
}): Promise<TestRecord> {
  return request<TestRecord>("/tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function createBatch(testId: number): Promise<BatchRecord> {
  return request<BatchRecord>(`/tests/${testId}/batches`, {
    method: "POST",
  });
}

export function uploadScan(
  batchId: number,
  file: File,
): Promise<ScanJobRecord> {
  const formData = new FormData();
  formData.append("file", file);
  return request<ScanJobRecord>(`/batches/${batchId}/scans`, {
    method: "POST",
    body: formData,
  });
}

export function listBatchResults(
  batchId: number,
): Promise<ScanResultRecord[]> {
  return request<ScanResultRecord[]>(`/batches/${batchId}/results`);
}

export function batchExportCsvUrl(batchId: number): string {
  return `${API_BASE_URL}/batches/${batchId}/export.csv`;
}

export function scanImageUrl(
  scanJobId: number,
  cacheBust?: string | number,
): string {
  const base = `${API_BASE_URL}/scans/${scanJobId}/image`;
  if (cacheBust === undefined) {
    return base;
  }
  return `${base}?v=${encodeURIComponent(String(cacheBust))}`;
}

export function gradeScan(
  scanJobId: number,
  force = false,
): Promise<ScanResultRecord> {
  const query = force ? "?force=true" : "";
  return request<ScanResultRecord>(`/scans/${scanJobId}/grade${query}`, {
    method: "POST",
  });
}

export function applyScanCorrections(
  scanJobId: number,
  corrections: Record<number, CorrectionValue>,
): Promise<ScanResultRecord> {
  return request<ScanResultRecord>(`/scans/${scanJobId}/corrections`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ corrections }),
  });
}

export function updateScanIdentity(
  scanJobId: number,
  payload: {
    name_text?: string | null;
    date_text?: string | null;
    section_text?: string | null;
  },
): Promise<ScanResultRecord> {
  return request<ScanResultRecord>(`/scans/${scanJobId}/identity`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listReviewQueue(): Promise<ScanResultRecord[]> {
  return request<ScanResultRecord[]>("/review-queue");
}
