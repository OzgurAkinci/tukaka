import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Key } from 'lucide-react';
import type { TableSort } from '@tukaka/contracts';

import { formatCellValue } from '../lib/format';

export type RowState = 'new' | 'deleted' | 'selected' | null;

interface ResultGridProps {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Satır numaralarının başlangıcı (sayfalı görünümde offset + 1). */
  startIndex?: number;
  sort?: TableSort | null;
  /** Verilirse kolon başlıkları tıklanarak sıralanabilir. */
  onSortChange?: (sort: TableSort | null) => void;
  /** Başlıkta anahtar simgesiyle gösterilecek birincil anahtar kolonları. */
  primaryKey?: string[];

  // --- Düzenleme (Data Viewer) ---
  getRowState?: (rowIndex: number) => RowState;
  isCellChanged?: (rowIndex: number, column: string) => boolean;
  /** Yeni satırlarda dokunulmamış hücre (veritabanı varsayılanı kullanılacak). */
  isCellDefault?: (rowIndex: number, column: string) => boolean;
  editingCell?: { rowIndex: number; column: string } | null;
  renderEditor?: (rowIndex: number, column: string) => ReactNode;
  onCellDoubleClick?: (rowIndex: number, column: string) => void;
  onRowNumberClick?: (rowIndex: number, event: React.MouseEvent) => void;
}

function nextSort(
  current: TableSort | null | undefined,
  column: string,
): TableSort | null {
  if (current?.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return null;
}

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-gray-600 italic">NULL</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-emerald-400' : 'text-gray-500'}>
        {String(value)}
      </span>
    );
  }

  return <>{formatCellValue(value)}</>;
}

const rowStateClass: Record<Exclude<RowState, null>, string> = {
  new: 'bg-emerald-500/[0.07]',
  deleted: 'bg-red-500/10 line-through text-red-300/70',
  selected: 'bg-blue-500/10',
};

export default function ResultGrid({
  columns,
  rows,
  startIndex = 1,
  sort,
  onSortChange,
  primaryKey = [],
  getRowState,
  isCellChanged,
  isCellDefault,
  editingCell,
  renderEditor,
  onCellDoubleClick,
  onRowNumberClick,
}: ResultGridProps) {
  const keyColumns = new Set(primaryKey);

  return (
    <table className="w-full border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-(--c-1b1f28)">
        <tr>
          <th className="w-12 px-3 py-3 border-b border-r border-(--c-303541) text-[10px] font-semibold text-gray-600 text-right">
            #
          </th>

          {columns.map((column) => {
            const active = sort?.column === column;
            const label = (
              <>
                {keyColumns.has(column) && (
                  <Key size={10} className="text-amber-400" aria-label="primary key" />
                )}
                {column}
              </>
            );

            return (
              <th
                key={column}
                className="px-4 py-0 border-b border-r border-(--c-303541) text-[11px] font-semibold text-gray-400 whitespace-nowrap"
              >
                {onSortChange ? (
                  <button
                    type="button"
                    onClick={() => onSortChange(nextSort(sort, column))}
                    className={`flex w-full items-center gap-1.5 py-3 hover:text-white ${active ? 'text-white' : ''}`}
                    title="Sort"
                  >
                    {label}
                    {active ? (
                      sort?.direction === 'asc' ? (
                        <ArrowUp size={12} className="text-blue-400" />
                      ) : (
                        <ArrowDown size={12} className="text-blue-400" />
                      )
                    ) : (
                      <ArrowUpDown size={11} className="text-gray-700" />
                    )}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 py-3">{label}</span>
                )}
              </th>
            );
          })}
        </tr>
      </thead>

      <tbody>
        {rows.map((row, rowIndex) => {
          const state = getRowState?.(rowIndex) ?? null;

          return (
            <tr
              key={rowIndex}
              className={state ? rowStateClass[state] : 'hover:bg-(--c-202530)'}
            >
              <td
                onClick={(event) => onRowNumberClick?.(rowIndex, event)}
                title={onRowNumberClick ? 'Select row (Shift/⌘ for multiple)' : undefined}
                className={`px-3 py-2.5 border-b border-r border-(--c-292d36) text-[10px] text-right tabular-nums ${
                  state === 'new' ? 'text-emerald-400' : 'text-gray-600'
                } ${onRowNumberClick ? 'cursor-pointer select-none hover:text-white' : ''}`}
              >
                {state === 'new' ? '+' : startIndex + rowIndex}
              </td>

              {columns.map((column) => {
                const value = row[column];
                const editing =
                  editingCell?.rowIndex === rowIndex && editingCell.column === column;
                const changed = isCellChanged?.(rowIndex, column) ?? false;
                const isDefault = isCellDefault?.(rowIndex, column) ?? false;

                return (
                  <td
                    key={column}
                    onDoubleClick={() => onCellDoubleClick?.(rowIndex, column)}
                    title={
                      editing || value === null || value === undefined
                        ? undefined
                        : formatCellValue(value)
                    }
                    className={`max-w-[420px] truncate border-b border-r border-(--c-292d36) text-xs text-gray-300 whitespace-nowrap ${
                      editing ? 'p-0' : 'px-4 py-2.5'
                    } ${changed ? 'bg-amber-500/15 text-amber-100' : ''}`}
                  >
                    {editing && renderEditor ? (
                      renderEditor(rowIndex, column)
                    ) : isDefault ? (
                      <span className="text-gray-600 italic">DEFAULT</span>
                    ) : (
                      <Cell value={value} />
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
