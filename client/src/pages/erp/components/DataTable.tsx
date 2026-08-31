/**
 * 정렬·필터가 모든 화면의 기본이다 (§15). 헤더 클릭 정렬 — 숫자는 수치,
 * 나머지는 한글 정렬. 합계행은 하단 고정 (§ UI 동작).
 */
import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** 정렬 기준값. 없으면 정렬 불가 */
  sortValue?: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  wrap?: boolean;
}

const collator = new Intl.Collator("ko-KR");

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  footer,
  empty = "표시할 행이 없습니다",
  initialSort,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  footer?: ReactNode;
  empty?: ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find(c => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      // null은 언제나 뒤로 — 0으로 취급하지 않는다 (§10.2)
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * factor;
      return collator.compare(String(av), String(bv)) * factor;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string, sortable: boolean) => {
    if (!sortable) return;
    setSort(prev =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  };

  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {columns.map(column => {
              const sortable = Boolean(column.sortValue);
              return (
                <th
                  key={column.key}
                  className={column.numeric ? "num" : undefined}
                  data-sortable={sortable}
                  onClick={() => toggle(column.key, sortable)}
                  aria-sort={
                    sort?.key === column.key
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {column.header}
                  {sort?.key === column.key
                    ? sort.dir === "asc"
                      ? " ↑"
                      : " ↓"
                    : ""}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ color: "var(--muted)" }}>
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map(row => (
              <tr key={rowKey(row)}>
                {columns.map(column => (
                  <td
                    key={column.key}
                    className={[
                      column.numeric ? "num" : "",
                      column.wrap ? "wrap" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
