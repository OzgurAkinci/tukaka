import type { ReactNode } from 'react';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { DatabaseColumn, TableDetailsResponse } from '@tukaka/contracts';

interface TableStructureProps {
  columns: DatabaseColumn[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  details: TableDetailsResponse | null;
  detailsError: string | null;
  /** Verilirse kolon ekleme/silme SQL'i üretilebilir. */
  onAddColumn?: () => void;
  onDropColumn?: (column: string) => void;
}

const th =
  'px-4 py-3 border-b border-r border-(--c-303541) text-[11px] font-semibold text-gray-400 whitespace-nowrap';
const td = 'px-4 py-3 border-b border-r border-(--c-292d36)';

function Badge({ tone, children }: { tone: 'amber' | 'purple' | 'sky'; children: ReactNode }) {
  const tones = {
    amber: 'bg-amber-500/10 text-amber-400',
    purple: 'bg-purple-500/10 text-purple-400',
    sky: 'bg-sky-500/10 text-sky-400',
  };

  return <span className={`text-[9px] px-1.5 py-0.5 rounded ${tones[tone]}`}>{children}</span>;
}

function SectionTitle({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-6">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {title}
        {count !== undefined && <span className="ml-2 text-gray-700">{count}</span>}
      </h3>
      {action}
    </div>
  );
}

export default function TableStructure({
  columns,
  loading,
  error,
  onRetry,
  details,
  detailsError,
  onAddColumn,
  onDropColumn,
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
          className="flex items-center gap-2 px-3 py-1.5 rounded bg-(--c-252a34) text-xs text-gray-300 hover:bg-(--c-303746)"
        >
          <RefreshCw size={12} />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <SectionTitle
        title="Columns"
        count={columns.length}
        action={
          onAddColumn && (
            <button
              type="button"
              onClick={onAddColumn}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white"
            >
              <Plus size={12} />
              Add column
            </button>
          )
        }
      />

      {columns.length === 0 ? (
        <p className="px-4 py-6 text-xs text-gray-500">No columns found.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead className="bg-(--c-1b1f28)">
            <tr>
              {['#', 'Column', 'Data Type', 'Nullable', 'Key', 'Default'].map((heading) => (
                <th key={heading} className={th}>
                  {heading}
                </th>
              ))}
              {onDropColumn && <th className={`${th} w-10`} />}
            </tr>
          </thead>

          <tbody>
            {columns.map((column) => (
              <tr key={column.name} className="group hover:bg-(--c-202530) transition">
                <td className={`${td} text-[11px] text-gray-600`}>{column.position}</td>
                <td className={`${td} text-xs text-gray-200 font-medium`}>{column.name}</td>
                <td className={`${td} text-xs text-sky-300`}>{column.dataType}</td>
                <td className={`${td} text-xs`}>
                  {column.nullable ? (
                    <span className="text-gray-400">YES</span>
                  ) : (
                    <span className="text-gray-300">NO</span>
                  )}
                </td>
                <td className={td}>
                  <div className="flex items-center gap-1.5">
                    {column.isPrimaryKey && <Badge tone="amber">PK</Badge>}
                    {column.isForeignKey && <Badge tone="purple">FK</Badge>}
                    {!column.isPrimaryKey && !column.isForeignKey && (
                      <span className="text-gray-700">—</span>
                    )}
                  </div>
                </td>
                <td className={`${td} text-xs text-gray-400`}>{column.defaultValue ?? '—'}</td>
                {onDropColumn && (
                  <td className={`${td} text-right`}>
                    <button
                      type="button"
                      title={`Drop column ${column.name}…`}
                      onClick={() => onDropColumn(column.name)}
                      className="p-1 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detailsError && (
        <p className="px-4 pt-6 text-xs text-red-400">{detailsError}</p>
      )}

      {!details && !detailsError && (
        <div className="flex items-center gap-2 px-4 pt-6 text-xs text-gray-500">
          <Loader2 size={13} className="animate-spin" />
          Loading indexes and foreign keys…
        </div>
      )}

      {details && (
        <>
          <SectionTitle title="Indexes" count={details.indexes.length} />
          {details.indexes.length === 0 ? (
            <p className="px-4 text-xs text-gray-600">No indexes.</p>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="bg-(--c-1b1f28)">
                <tr>
                  {['Name', 'Columns', 'Type'].map((heading) => (
                    <th key={heading} className={th}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {details.indexes.map((index) => (
                  <tr key={index.name} className="hover:bg-(--c-202530)">
                    <td className={`${td} text-xs text-gray-200`}>{index.name}</td>
                    <td className={`${td} text-xs text-gray-400 font-mono`}>
                      {index.columns.join(', ')}
                    </td>
                    <td className={td}>
                      <div className="flex gap-1.5">
                        {index.primary && <Badge tone="amber">PRIMARY</Badge>}
                        {index.unique && !index.primary && <Badge tone="sky">UNIQUE</Badge>}
                        {!index.unique && <span className="text-xs text-gray-600">index</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <SectionTitle title="Foreign keys" count={details.foreignKeys.length} />
          {details.foreignKeys.length === 0 ? (
            <p className="px-4 text-xs text-gray-600">No foreign keys.</p>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="bg-(--c-1b1f28)">
                <tr>
                  {['Name', 'Columns', 'References'].map((heading) => (
                    <th key={heading} className={th}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {details.foreignKeys.map((key) => (
                  <tr key={key.name} className="hover:bg-(--c-202530)">
                    <td className={`${td} text-xs text-gray-200`}>{key.name}</td>
                    <td className={`${td} text-xs text-gray-400 font-mono`}>
                      {key.columns.join(', ')}
                    </td>
                    <td className={`${td} text-xs text-purple-300 font-mono`}>
                      {key.referencedSchema}.{key.referencedTable}({key.referencedColumns.join(', ')})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
