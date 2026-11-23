import { Loader2, RefreshCw } from 'lucide-react';
import type { DatabaseColumn } from '@tukaka/contracts';

interface TableStructureProps {
  columns: DatabaseColumn[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const headings = ['#', 'Column', 'Data Type', 'Nullable', 'Key', 'Default'];

export default function TableStructure({
  columns,
  loading,
  error,
  onRetry,
}: TableStructureProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 h-40 text-xs text-gray-500">
        <Loader2 size={16} className="animate-spin" />
        Loading table structure...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-40">
        <p className="text-xs text-red-400">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#252a34] text-xs text-gray-300 hover:bg-[#303746]"
        >
          <RefreshCw size={12} />
          Try again
        </button>
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-gray-500">
        No columns found.
      </div>
    );
  }

  const cell = 'px-4 py-3 border-b border-r border-[#292d36]';

  return (
    <table className="w-full border-collapse text-left">
      <thead className="sticky top-0 bg-[#1b1f28]">
        <tr>
          {headings.map((heading) => (
            <th
              key={heading}
              className="px-4 py-3 border-b border-r border-[#303541] text-[11px] font-semibold text-gray-400 whitespace-nowrap"
            >
              {heading}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {columns.map((column) => (
          <tr key={column.name} className="hover:bg-[#202530] transition">
            <td className={`${cell} text-[11px] text-gray-600`}>
              {column.position}
            </td>
            <td className={`${cell} text-xs text-gray-200 font-medium`}>
              {column.name}
            </td>
            <td className={`${cell} text-xs text-sky-300`}>
              {column.dataType}
            </td>
            <td className={`${cell} text-xs`}>
              {column.nullable ? (
                <span className="text-gray-400">YES</span>
              ) : (
                <span className="text-gray-300">NO</span>
              )}
            </td>
            <td className={cell}>
              <div className="flex items-center gap-1.5">
                {column.isPrimaryKey && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                    PK
                  </span>
                )}
                {column.isForeignKey && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                    FK
                  </span>
                )}
                {!column.isPrimaryKey && !column.isForeignKey && (
                  <span className="text-gray-700">—</span>
                )}
              </div>
            </td>
            <td className={`${cell} text-xs text-gray-400`}>
              {column.defaultValue ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
