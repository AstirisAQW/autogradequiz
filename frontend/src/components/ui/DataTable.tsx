import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  className?: string;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string | number;
  renderActions?: (row: T) => ReactNode;
  maxHeightClass?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  renderActions,
  maxHeightClass = "max-h-[540px]",
}: DataTableProps<T>) {
  return (
    <div
      className={`overflow-auto rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] ${maxHeightClass}`}
    >
      <table className="w-full border-collapse text-left text-[14px]">
        <thead className="sticky top-0 z-10 border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2.5 text-[12px] font-medium uppercase tracking-wide text-[var(--text-secondary)] ${
                  col.align === "right" ? "text-right" : "text-left"
                } ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
            {renderActions && (
              <th className="px-4 py-2.5 text-right text-[12px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-hairline)]">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="transition-colors hover:bg-[var(--bg-subtle)]/60"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-3 text-[var(--text-primary)] ${
                    col.align === "right" ? "text-right" : "text-left"
                  } ${col.className ?? ""}`}
                >
                  {col.render(row)}
                </td>
              ))}
              {renderActions && (
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center justify-end gap-2">
                    {renderActions(row)}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
