import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  DatabaseColumn,
  FilterOperator,
  TableDataResponse,
  TableFilter,
  TableSort,
} from '@tukaka/contracts';

import { errorMessage } from '../api/client';
import { connectionsApi } from '../api/connections';
import { useRowEditing } from '../hooks/useRowEditing';
import CellEditor from './CellEditor';
import ExportMenu from './ExportMenu';
import ResultGrid from './ResultGrid';
import ReviewChangesDialog from './ReviewChangesDialog';

interface TableDataViewerProps {
  connectionId: string;
  schema: string;
  table: string;
  columns: DatabaseColumn[];
  defaultPageSize: number;
  /** Satır ekleme/düzenleme/silme açık mı (tablo + destekleyen veritabanı). */
  canEdit: boolean;
}

const operators: Array<[FilterOperator, string]> = [
  ['eq', '='],
  ['neq', '≠'],
  ['lt', '<'],
  ['lte', '≤'],
  ['gt', '>'],
  ['gte', '≥'],
  ['contains', 'contains'],
  ['notContains', 'not contains'],
  ['startsWith', 'starts with'],
  ['endsWith', 'ends with'],
  ['isNull', 'is NULL'],
  ['isNotNull', 'is not NULL'],
];

const needsValue = (operator: FilterOperator) =>
  operator !== 'isNull' && operator !== 'isNotNull';

const pageSizes = [50, 100, 250, 500, 1000];

interface DraftFilter extends TableFilter {
  key: number;
}

const controlClass =
  'h-7 rounded border border-(--c-303541) bg-(--c-1c2029) px-2 text-xs text-gray-200 outline-none focus:border-blue-500';

export default function TableDataViewer({
  connectionId,
  schema,
  table,
  columns,
  defaultPageSize,
  canEdit,
}: TableDataViewerProps) {
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<TableSort | null>(null);
  const [filters, setFilters] = useState<TableFilter[]>([]);
  const [draftFilters, setDraftFilters] = useState<DraftFilter[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);
  // Son tamamlanan isteğin sonucu; yükleme sırasında eski veri gösterilmeye devam eder.
  const [data, setData] = useState<TableDataResponse | null>(null);
  const [dataKey, setDataKey] = useState('');
  const [completed, setCompleted] = useState<{
    key: string;
    error: string | null;
  } | null>(null);

  const filterKey = useRef(0);

  const requestKey = JSON.stringify([
    connectionId,
    schema,
    table,
    pageSize,
    offset,
    sort,
    filters,
    reloadToken,
  ]);

  // Sayfa, sıralama ya da filtre değişince yeniden yükle.
  useEffect(() => {
    let cancelled = false;

    connectionsApi
      .getTableData(connectionId, schema, table, {
        limit: pageSize,
        offset,
        sort: sort ?? undefined,
        filters,
      })
      .then(
        (response) => {
          if (cancelled) return;
          setData(response);
          setDataKey(requestKey);
          setCompleted({ key: requestKey, error: null });
        },
        (loadError: unknown) => {
          if (cancelled) return;
          setCompleted({
            key: requestKey,
            error: errorMessage(loadError, 'Table data could not be loaded.'),
          });
        },
      );

    // Daha yeni bir istek başladıysa bu sonucu yok say.
    return () => {
      cancelled = true;
    };
  }, [requestKey, connectionId, schema, table, pageSize, offset, sort, filters]);

  const loading = completed?.key !== requestKey;
  const error = loading ? null : (completed?.error ?? null);

  // --- Satır düzenleme -----------------------------------------------------
  const primaryKey = columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
  const canUpdate = canEdit && primaryKey.length > 0;

  const editing = useRowEditing({
    version: dataKey,
    rows: data?.rows ?? [],
    columns: data?.columns ?? [],
    primaryKey,
    canUpdate,
    canInsert: canEdit,
  });

  const [review, setReview] = useState<string[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  /** Bekleyen değişiklik varsa sayfa/sıralama/filtre değişmeden önce onay ister. */
  const guard = (action: () => void) => () => {
    if (
      editing.pendingCount > 0 &&
      !window.confirm(`Discard ${editing.pendingCount} unsaved change(s)?`)
    ) {
      return;
    }

    action();
  };

  const reloadData = () => setReloadToken((token) => token + 1);
  const load = guard(reloadData);

  const openReview = async () => {
    setEditError(null);

    try {
      const preview = await connectionsApi.applyChanges(connectionId, schema, table, {
        changes: editing.buildChanges(),
        dryRun: true,
      });
      setReview(preview.statements);
    } catch (reviewError) {
      setEditError(errorMessage(reviewError, 'Changes could not be prepared.'));
    }
  };

  const applyChanges = async () => {
    setApplying(true);
    setEditError(null);

    try {
      await connectionsApi.applyChanges(connectionId, schema, table, {
        changes: editing.buildChanges(),
      });
      editing.discard();
      setReview(null);
      reloadData();
    } catch (applyError) {
      setEditError(errorMessage(applyError, 'Changes could not be saved.'));
    } finally {
      setApplying(false);
    }
  };

  const addDraftFilter = () => {
    setShowFilters(true);
    setDraftFilters((previous) => [
      ...previous,
      {
        key: ++filterKey.current,
        column: columns[0]?.name ?? '',
        operator: 'contains',
        value: '',
      },
    ]);
  };

  const updateDraft = (key: number, patch: Partial<TableFilter>) =>
    setDraftFilters((previous) =>
      previous.map((filter) =>
        filter.key === key ? { ...filter, ...patch } : filter,
      ),
    );

  const applyFilters = (next: DraftFilter[] = draftFilters) =>
    guard(() => {
    setFilters(
      next
        .filter((filter) => filter.column)
        .map(({ column, operator, value }) =>
          needsValue(operator) ? { column, operator, value: value ?? '' } : { column, operator },
        ),
    );
    setOffset(0);
    })();

  const removeDraft = (key: number) => {
    const next = draftFilters.filter((filter) => filter.key !== key);
    setDraftFilters(next);
    applyFilters(next);
  };

  const clearFilters = guard(() => {
    setDraftFilters([]);
    setFilters([]);
    setOffset(0);
  });

  const total = data?.totalCount ?? null;
  const rows = data?.rows ?? [];
  const page = Math.floor(offset / pageSize) + 1;
  const pageCount = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const canPrevious = offset > 0;
  const canNext = data?.hasMore ?? false;

  const pagerButton =
    'p-1 rounded text-gray-400 hover:text-white hover:bg-(--c-292e39) disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="shrink-0 border-b border-(--c-292d36) bg-(--c-14171d)">
        <div className="flex h-10 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                draftFilters.length === 0
                  ? addDraftFilter()
                  : setShowFilters((value) => !value)
              }
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-(--c-292e39) ${
                filters.length > 0 ? 'text-blue-400' : 'text-gray-400'
              }`}
            >
              <Filter size={13} />
              Filters
              {filters.length > 0 && (
                <span className="rounded bg-blue-500/20 px-1.5 text-[10px]">
                  {filters.length}
                </span>
              )}
            </button>

            {filters.length > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] text-gray-500 hover:text-gray-300"
              >
                Clear
              </button>
            )}

            {sort && (
              <span className="text-[11px] text-gray-500">
                Sorted by <span className="text-gray-300">{sort.column}</span>{' '}
                {sort.direction}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-gray-500">
            {loading && <Loader2 size={13} className="animate-spin" />}
            <button
              type="button"
              title="Refresh"
              onClick={load}
              className="hover:text-white"
            >
              <RefreshCw size={14} />
            </button>
            <ExportMenu
              fileBaseName={`${schema}.${table}`}
              columns={data?.columns ?? []}
              rows={rows}
              disabled={rows.length === 0}
            />
          </div>
        </div>

        {canEdit && (
          <div className="flex h-9 items-center gap-3 border-t border-(--c-292d36) px-4 text-[11px]">
            <button
              type="button"
              onClick={editing.addRow}
              className="flex items-center gap-1 text-gray-400 hover:text-white"
            >
              <Plus size={12} />
              Add row
            </button>

            {canUpdate && (
              <button
                type="button"
                disabled={editing.selectedCount === 0}
                onClick={editing.deleteSelected}
                className="flex items-center gap-1 text-gray-400 hover:text-red-400 disabled:opacity-40 disabled:hover:text-gray-400"
                title="Mark selected rows for deletion (click row numbers to select)"
              >
                <Trash2 size={12} />
                Delete{editing.selectedCount > 0 && ` (${editing.selectedCount})`}
              </button>
            )}

            <span className="flex items-center gap-1 text-gray-600">
              <Pencil size={11} />
              {canUpdate
                ? 'Double-click a cell to edit · click row numbers to select'
                : 'No primary key: rows can be added but not edited or deleted'}
            </span>

            {editing.pendingCount > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-amber-400">
                  {editing.pendingCount} pending change(s)
                </span>
                <button
                  type="button"
                  onClick={editing.discard}
                  className="flex items-center gap-1 rounded px-2 py-1 text-gray-400 hover:bg-(--c-292e39) hover:text-white"
                >
                  <Undo2 size={12} />
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void openReview()}
                  className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 font-medium text-[white] hover:bg-blue-500"
                >
                  <Save size={12} />
                  Review & save
                </button>
              </div>
            )}
          </div>
        )}

        {editError && !review && (
          <div className="flex items-start justify-between gap-3 border-t border-(--c-292d36) bg-red-500/10 px-4 py-2 text-[11px] text-red-400">
            <span className="whitespace-pre-wrap">{editError}</span>
            <button type="button" onClick={() => setEditError(null)} title="Dismiss">
              <X size={12} />
            </button>
          </div>
        )}

        {showFilters && draftFilters.length > 0 && (
          <form
            className="space-y-2 border-t border-(--c-292d36) px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters();
            }}
          >
            {draftFilters.map((filter) => (
              <div key={filter.key} className="flex items-center gap-2">
                <select
                  aria-label="Filter column"
                  value={filter.column}
                  onChange={(event) =>
                    updateDraft(filter.key, { column: event.target.value })
                  }
                  className={`${controlClass} w-48`}
                >
                  {columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter operator"
                  value={filter.operator}
                  onChange={(event) =>
                    updateDraft(filter.key, {
                      operator: event.target.value as FilterOperator,
                    })
                  }
                  className={`${controlClass} w-32`}
                >
                  {operators.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>

                {needsValue(filter.operator) && (
                  <input
                    aria-label="Filter value"
                    value={filter.value ?? ''}
                    onChange={(event) =>
                      updateDraft(filter.key, { value: event.target.value })
                    }
                    placeholder="value"
                    className={`${controlClass} w-56`}
                  />
                )}

                <button
                  type="button"
                  title="Remove filter"
                  onClick={() => removeDraft(filter.key)}
                  className="p-1 text-gray-500 hover:text-red-400"
                >
                  <X size={13} />
                </button>
              </div>
            ))}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={addDraftFilter}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white"
              >
                <Plus size={12} />
                Add filter
              </button>
              <button
                type="submit"
                className="ml-auto rounded bg-blue-600 px-3 py-1 text-xs font-medium text-[white] hover:bg-blue-500"
              >
                Apply
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Grid */}
      <div className="relative flex-1 min-h-0 overflow-auto">
        {error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3">
            <p className="max-w-xl text-center text-xs text-red-400 whitespace-pre-wrap">
              {error}
            </p>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-2 rounded bg-(--c-252a34) px-3 py-1.5 text-xs text-gray-300 hover:bg-(--c-303746)"
            >
              <RefreshCw size={12} />
              Try again
            </button>
          </div>
        ) : data ? (
          <>
            <ResultGrid
              columns={data.columns}
              rows={canEdit ? editing.displayRows : rows}
              startIndex={offset + 1}
              sort={sort}
              onSortChange={(next) =>
                guard(() => {
                  setSort(next);
                  setOffset(0);
                })()
              }
              primaryKey={primaryKey}
              {...(canEdit && {
                getRowState: editing.getRowState,
                isCellChanged: editing.isCellChanged,
                isCellDefault: editing.isCellDefault,
                editingCell: editing.editingCell,
                onCellDoubleClick: editing.startEdit,
                onRowNumberClick: editing.toggleSelect,
                renderEditor: (rowIndex: number, column: string) => (
                  <CellEditor
                    key={`${rowIndex}:${column}`}
                    value={editing.displayRows[rowIndex]?.[column] ?? null}
                    onCommit={editing.commitEdit}
                    onCancel={editing.cancelEdit}
                  />
                ),
              })}
            />
            {rows.length === 0 && editing.displayRows.length === 0 && (
              <div className="py-10 text-center text-xs text-gray-500">
                {filters.length > 0 ? 'No rows match the filters.' : 'Table is empty.'}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-40 items-center justify-center gap-2 text-xs text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            Loading data...
          </div>
        )}
      </div>

      {/* Pager */}
      <div className="h-9 shrink-0 flex items-center justify-between border-t border-(--c-292d36) px-4 text-[11px] text-gray-500">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(event) => {
              const size = Number(event.target.value);
              guard(() => {
                setPageSize(size);
                setOffset(0);
              })();
            }}
            className={controlClass}
          >
            {[...new Set([...pageSizes, defaultPageSize])]
              .sort((a, b) => a - b)
              .map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <span className="tabular-nums">
            {rows.length > 0
              ? `${offset + 1}–${offset + rows.length}`
              : '0'}
            {total !== null && ` of ${total.toLocaleString()}`}
            {data && ` · ${data.durationMs} ms`}
          </span>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="First page"
              disabled={!canPrevious || loading}
              onClick={guard(() => setOffset(0))}
              className={pagerButton}
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              type="button"
              title="Previous page"
              disabled={!canPrevious || loading}
              onClick={guard(() => setOffset(Math.max(0, offset - pageSize)))}
              className={pagerButton}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2 tabular-nums">
              Page {page}
              {pageCount !== null && ` / ${pageCount}`}
            </span>
            <button
              type="button"
              title="Next page"
              disabled={!canNext || loading}
              onClick={guard(() => setOffset(offset + pageSize))}
              className={pagerButton}
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              title="Last page"
              disabled={!canNext || loading || pageCount === null}
              onClick={guard(() => {
                if (pageCount !== null) setOffset((pageCount - 1) * pageSize);
              })}
              className={pagerButton}
            >
              <ChevronsRight size={14} />
            </button>
          </div>
        </div>
      </div>
      {review && (
        <ReviewChangesDialog
          statements={review}
          applying={applying}
          error={editError}
          onApply={() => void applyChanges()}
          onClose={() => {
            setReview(null);
            setEditError(null);
          }}
        />
      )}
    </div>
  );
}
