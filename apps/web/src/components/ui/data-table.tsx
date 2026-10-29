import type { ReactNode } from "react";

export type Column<T> = { key: string; header: string; cell: (row: T) => ReactNode };

// A table that becomes labelled cards at phone width (globals.css). Loading, empty and error states are the page's
// loading.tsx, EmptyState and error.tsx; this renders the success state.
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  caption: string;
}) {
  return (
    <table className="table">
      <caption className="muted" style={{ textAlign: "left", padding: "0 0 8px" }}>
        {caption}
      </caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col">
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((c) => (
              <td key={c.key} data-label={c.header} className="wrap">
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
