import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { TableSort } from '@tukaka/contracts';

import { formatCellValue } from '../lib/format';

interface ResultGridProps {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Satır numaralarının başlangıcı (sayfalı görünümde offset + 1). */
  startIndex?: number;
  sort?: TableSort | null;
  /** Verilirse kolon başlıkları tıklanarak sıralanabilir. */
  onSortChange?: (sort: TableSort | null) => void;
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

export default function ResultGrid({
  columns,
  rows,
  startIndex = 1,
  sort,
  onSortChange,
}: ResultGridProps) {
  return (
    <table className="w-full border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-[#1b1f28]">
        <tr>
          <th className="w-12 px-3 py-3 border-b border-r border-[#303541] text-[10px] font-semibold text-gray-600 text-right">
            #
          </th>

          {columns.map((column) => {
            const active = sort?.column === column;

            return (
              <th
                key={column}
                className="px-4 py-0 border-b border-r border-[#303541] text-[11px] font-semibold text-gray-400 whitespace-nowrap"
              >
                {onSortChange ? (
                  <button
                    type="button"
                    onClick={() => onSortChange(nextSort(sort, column))}
                    className={`flex w-full items-center gap-1.5 py-3 hover:text-white ${active ? 'text-white' : ''}`}
                    title="Sort"
                  >
                    {column}
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
                  <span className="block py-3">{column}</span>
                )}
              </th>
            );
          })}
        </tr>
      </thead>

      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="hover:bg-[#202530]">
            <td className="px-3 py-2.5 border-b border-r border-[#292d36] text-[10px] text-gray-600 text-right tabular-nums">
              {startIndex + rowIndex}
            </td>

            {columns.map((column) => {
              const value = row[column];

              return (
                <td
                  key={column}
                  title={value === null || value === undefined ? undefined : formatCellValue(value)}
                  className="max-w-[420px] truncate px-4 py-2.5 border-b border-r border-[#292d36] text-xs text-gray-300 whitespace-nowrap"
                >
                  <Cell value={value} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
