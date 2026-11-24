export interface ParsedRosterRow {
  studentCode: string;
  firstName: string;
  lastName: string;
  className: string;
  externalRef: string;
}

function parseCsvMatrix(raw: string): string[][] {
  const text = raw.replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(cell.trim());
      if (row.some((v) => v.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((v) => v.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function splitFullName(fullName: string): { firstName: string; lastName: string } | null {
  const cleaned = fullName.trim();
  if (!cleaned) return null;
  if (cleaned.includes(",")) {
    const [last, ...rest] = cleaned.split(",");
    const first = rest.join(" ").trim();
    if (!last.trim() || !first) return null;
    return { firstName: first, lastName: last.trim() };
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((h) => aliases.includes(h));
}

export function parseRosterCsv(text: string): {
  rows: ParsedRosterRow[];
  skipped: number;
} {
  const matrix = parseCsvMatrix(text);
  if (matrix.length < 2) {
    return { rows: [], skipped: 0 };
  }

  const headers = matrix[0].map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
  );

  const codeIdx = findColumnIndex(headers, [
    "student_code",
    "student_id",
    "id",
    "code",
  ]);
  const firstIdx = findColumnIndex(headers, ["first_name", "first"]);
  const lastIdx = findColumnIndex(headers, ["last_name", "last"]);
  const fullIdx = findColumnIndex(headers, ["name", "full_name", "student"]);
  const classIdx = findColumnIndex(headers, ["class", "section", "class_name"]);
  const refIdx = findColumnIndex(headers, ["external_ref", "lrn", "email"]);

  const rows: ParsedRosterRow[] = [];
  let skipped = 0;

  for (const cells of matrix.slice(1)) {
    let firstName = firstIdx >= 0 ? (cells[firstIdx] ?? "").trim() : "";
    let lastName = lastIdx >= 0 ? (cells[lastIdx] ?? "").trim() : "";

    if ((!firstName || !lastName) && fullIdx >= 0) {
      const split = splitFullName(cells[fullIdx] ?? "");
      if (split) {
        firstName = split.firstName;
        lastName = split.lastName;
      }
    }

    if (!firstName || !lastName) {
      skipped += 1;
      continue;
    }

    rows.push({
      studentCode: codeIdx >= 0 ? (cells[codeIdx] ?? "").trim() : "",
      firstName,
      lastName,
      className: classIdx >= 0 ? (cells[classIdx] ?? "").trim() : "",
      externalRef: refIdx >= 0 ? (cells[refIdx] ?? "").trim() : "",
    });
  }

  return { rows, skipped };
}
