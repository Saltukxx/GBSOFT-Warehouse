import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { EmptyState } from "../ui/primitives";

/**
 * DataTable — §11.3.
 * Sticky header, kolon sıralama, satır seçimi, klavye navigasyonu,
 * compact/default yoğunluk ve boş durumu destekler.
 */

export type Column<T> = {
  key: string;
  header: string;
  /** Hücre içeriği. */
  cell: (row: T) => ReactNode;
  /** Sıralama için sayısal/metinsel anahtar. */
  sortValue?: (row: T) => number | string;
  align?: "left" | "right";
  width?: number | string;
  /** 1280 px altında gizlenecek düşük öncelikli kolon (§17.3). */
  secondary?: boolean;
};

type Props<T> = {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  density?: "compact" | "default";
  selectedKey?: string | null;
  onSelect?: (row: T) => void;
  onRowHover?: (row: T | null) => void;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  /** Değişen değerleri vurgulamak için satır anahtarları. */
  flashKeys?: Set<string>;
  defaultSort?: { key: string; dir: "asc" | "desc" };
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  density = "compact",
  selectedKey,
  onSelect,
  onRowHover,
  emptyTitle = "Kayıt bulunamadı.",
  emptyHint = "Filtreleri gözden geçirin.",
  emptyAction,
  flashKeys,
  defaultSort,
}: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    defaultSort ?? null,
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * factor;
      }
      return String(av).localeCompare(String(bv), "tr") * factor;
    });
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>) {
    const row = event.currentTarget;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      (row.nextElementSibling as HTMLElement | null)?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      (row.previousElementSibling as HTMLElement | null)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      row.click();
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />
    );
  }

  return (
    <div className="table-wrap">
      <table
        className={`table${density === "compact" ? " table--compact" : ""}`}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={`${col.align === "right" ? "num" : ""}${
                    col.sortValue ? " is-sortable" : ""
                  }`}
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={
                    active
                      ? sort!.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  onClick={col.sortValue ? () => toggleSort(col.key) : undefined}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        font: "inherit",
                      }}
                    >
                      {col.header}
                      <span className="table__sort" aria-hidden="true">
                        {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody onMouseLeave={() => onRowHover?.(null)}>
          {sorted.map((row) => {
            const key = rowKey(row);
            const selected = selectedKey === key;
            return (
              <tr
                key={key}
                tabIndex={onSelect ? 0 : -1}
                className={`${selected ? "is-selected" : ""}${
                  onSelect ? " is-selectable" : ""
                }${flashKeys?.has(key) ? " flash" : ""}`}
                aria-selected={onSelect ? selected : undefined}
                onClick={onSelect ? () => onSelect(row) : undefined}
                onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
                onKeyDown={onSelect ? handleKeyDown : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.align === "right" ? "num" : undefined}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
