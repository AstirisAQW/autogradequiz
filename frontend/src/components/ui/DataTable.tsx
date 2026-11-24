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
  onRowClick?: (row: T) => void;
  colgroup?: ReactNode;
  tableClassName?: string;
  actionsHeaderSrOnly?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  renderActions,
  onRowClick,
  colgroup,
  tableClassName = "",
  actionsHeaderSrOnly = false,
}: DataTableProps<T>) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
      <table className={`w-full border-collapse text-left text-sm ${tableClassName}`}>
        {colgroup}
        <thead className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap text-[var(--text-secondary)] ${
                  col.align === "right" ? "text-right" : "text-left"
                } ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
            {renderActions && (
              <th className="px-4 py-2.5 text-right text-xs font-semibold whitespace-nowrap text-[var(--text-secondary)]">
                {actionsHeaderSrOnly ? (
                  <span className="sr-only">Actions</span>
                ) : (
                  "Actions"
                )}
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-hairline)]">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? "button" : undefined}
              onClick={
                onRowClick
                  ? (e) => {
                      const target = e.target as HTMLElement | null;
                      if (
                        target?.closest(
                          'button, a, input, select, [data-stop-row="true"]',
                        )
                      ) {
                        return;
                      }
                      onRowClick(row);
                    }
                  : undefined
              }
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      const target = e.target as HTMLElement | null;
                      if (
                        target?.closest(
                          'button, a, input, select, [data-stop-row="true"]',
                        )
                      ) {
                        return;
                      }
                      e.preventDefault();
                      onRowClick(row);
                    }
                  : undefined
              }
              className={`transition-colors ${
                onRowClick
                  ? "cursor-pointer hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)]"
                  : "hover:bg-black/[0.02]"
              }`}
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
                  <div
                    data-stop-row="true"
                    className="inline-flex items-center justify-end gap-2"
                  >
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
