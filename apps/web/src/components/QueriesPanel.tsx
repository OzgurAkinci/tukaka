import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  History,
  Loader2,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  ConnectionProfile,
  QueryHistoryEntry,
  SavedQuery,
} from '@tukaka/contracts';

import { errorMessage } from '../api/client';
import { queriesApi } from '../api/queries';
import { formatRelativeTime } from '../lib/format';
import Modal from './Modal';

export type QueriesPanelTab = 'history' | 'saved';

interface QueriesPanelProps {
  initialTab: QueriesPanelTab;
  connections: ConnectionProfile[];
  activeConnectionId: string | null;
  onClose: () => void;
  onOpenSql: (sql: string, connectionId: string | null) => void;
  onOpenSaved: (saved: SavedQuery) => void;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

function SqlPreview({ sql }: { sql: string }) {
  return (
    <pre className="max-h-16 overflow-hidden whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-gray-300">
      {sql}
    </pre>
  );
}

export default function QueriesPanel({
  initialTab,
  connections,
  activeConnectionId,
  onClose,
  onOpenSql,
  onOpenSaved,
}: QueriesPanelProps) {
  const [tab, setTab] = useState<QueriesPanelTab>(initialTab);
  const [search, setSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const debouncedSearch = useDebounced(search, 250);

  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [completed, setCompleted] = useState<{
    key: string;
    error: string | null;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const connectionName = (id: string | null) =>
    connections.find((item) => item.id === id)?.name ?? null;

  const historyConnectionId =
    onlyActive && activeConnectionId ? activeConnectionId : undefined;

  const requestKey = JSON.stringify(
    tab === 'history'
      ? [tab, debouncedSearch, historyConnectionId, reloadToken]
      : [tab, reloadToken],
  );

  useEffect(() => {
    let cancelled = false;

    const request =
      tab === 'history'
        ? queriesApi
            .history({
              search: debouncedSearch,
              connectionId: historyConnectionId,
              limit: 300,
            })
            .then((entries) => {
              if (!cancelled) setHistory(entries);
            })
        : queriesApi.savedQueries().then((queries) => {
            if (!cancelled) setSaved(queries);
          });

    request.then(
      () => {
        if (!cancelled) setCompleted({ key: requestKey, error: null });
      },
      (loadError: unknown) => {
        if (!cancelled) {
          setCompleted({
            key: requestKey,
            error: errorMessage(loadError, 'Queries could not be loaded.'),
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [requestKey, tab, debouncedSearch, historyConnectionId]);

  const loading = completed?.key !== requestKey;
  const error = actionError ?? (loading ? null : (completed?.error ?? null));
  const reload = () => setReloadToken((token) => token + 1);

  const deleteHistoryEntry = async (id: number) => {
    await queriesApi.deleteHistoryEntry(id).catch(() => undefined);
    setHistory((previous) => previous.filter((entry) => entry.id !== id));
  };

  const clearHistory = async () => {
    const scope =
      onlyActive && activeConnectionId
        ? `for "${connectionName(activeConnectionId)}"`
        : 'for all connections';

    if (!window.confirm(`Clear query history ${scope}?`)) return;

    try {
      setActionError(null);
      await queriesApi.clearHistory(historyConnectionId);
      reload();
    } catch (clearError) {
      setActionError(errorMessage(clearError, 'History could not be cleared.'));
    }
  };

  const deleteSaved = async (query: SavedQuery) => {
    if (!window.confirm(`Delete saved query "${query.name}"?`)) return;

    try {
      setActionError(null);
      await queriesApi.deleteSavedQuery(query.id);
      setSaved((previous) => previous.filter((item) => item.id !== query.id));
    } catch (deleteError) {
      setActionError(
        errorMessage(deleteError, 'Saved query could not be deleted.'),
      );
    }
  };

  const needle = search.trim().toLowerCase();
  const visibleSaved = saved.filter(
    (query) =>
      (!onlyActive || !activeConnectionId || query.connectionId === activeConnectionId) &&
      (!needle ||
        query.name.toLowerCase().includes(needle) ||
        query.sql.toLowerCase().includes(needle)),
  );

  const tabButton = (value: QueriesPanelTab) =>
    `flex items-center gap-2 h-full text-xs border-b-2 ${
      tab === value
        ? 'border-blue-500 text-white'
        : 'border-transparent text-gray-500 hover:text-gray-300'
    }`;

  return (
    <Modal
      title="Queries"
      subtitle="History of executed queries and your saved queries"
      icon={<History size={18} />}
      onClose={onClose}
      widthClass="max-w-[760px]"
    >
      <div className="flex h-11 items-center gap-5 border-b border-[#2b303b] px-5">
        <button type="button" className={tabButton('history')} onClick={() => setTab('history')}>
          <History size={13} />
          History
        </button>
        <button type="button" className={tabButton('saved')} onClick={() => setTab('saved')}>
          <Bookmark size={13} />
          Saved
        </button>
      </div>

      <div className="flex items-center gap-3 border-b border-[#2b303b] px-5 py-3">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-[#303541] bg-[#111318] px-2.5">
          <Search size={13} className="text-gray-500" />
          <input
            aria-label="Search queries"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tab === 'history' ? 'Search SQL…' : 'Search name or SQL…'}
            className="w-full bg-transparent text-xs text-gray-200 outline-none placeholder:text-gray-600"
          />
        </div>

        <label
          className={`flex items-center gap-1.5 text-[11px] ${
            activeConnectionId ? 'text-gray-400' : 'text-gray-600'
          }`}
        >
          <input
            type="checkbox"
            disabled={!activeConnectionId}
            checked={onlyActive && Boolean(activeConnectionId)}
            onChange={(event) => setOnlyActive(event.target.checked)}
          />
          Current connection only
        </label>

        {tab === 'history' && (
          <button
            type="button"
            onClick={() => void clearHistory()}
            className="text-[11px] text-gray-500 hover:text-red-400"
          >
            Clear
          </button>
        )}
      </div>

      <div className="min-h-[320px]">
        {error && <p className="px-5 py-3 text-xs text-red-400">{error}</p>}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-500">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        )}

        {!loading && tab === 'history' && (
          <>
            {history.length === 0 && (
              <p className="py-10 text-center text-xs text-gray-600">
                No queries found.
              </p>
            )}

            {history.map((entry) => (
              <div
                key={entry.id}
                className="group flex gap-3 border-b border-[#252a33] px-5 py-3 hover:bg-[#202530]"
              >
                <div className="pt-0.5">
                  {entry.status === 'success' ? (
                    <CheckCircle2 size={13} className="text-emerald-500" />
                  ) : (
                    <AlertTriangle size={13} className="text-red-400" />
                  )}
                </div>

                <button
                  type="button"
                  title="Open in a new tab"
                  onClick={() => onOpenSql(entry.sql, entry.connectionId)}
                  className="min-w-0 flex-1 text-left"
                >
                  <SqlPreview sql={entry.sql} />
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[10px] text-gray-500">
                    <span>{formatRelativeTime(entry.executedAt)}</span>
                    <span>{entry.connectionName ?? 'deleted connection'}</span>
                    {entry.durationMs !== null && <span>{entry.durationMs} ms</span>}
                    {entry.rowCount !== null && <span>{entry.rowCount} rows</span>}
                    {entry.errorMessage && (
                      <span className="truncate text-red-400" title={entry.errorMessage}>
                        {entry.errorMessage}
                      </span>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  title="Delete from history"
                  onClick={() => void deleteHistoryEntry(entry.id)}
                  className="self-start p-1 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </>
        )}

        {!loading && tab === 'saved' && (
          <>
            {visibleSaved.length === 0 && (
              <p className="py-10 text-center text-xs text-gray-600">
                No saved queries. Use ⌘/Ctrl + S in the editor to save one.
              </p>
            )}

            {visibleSaved.map((query) => (
              <div
                key={query.id}
                className="group flex gap-3 border-b border-[#252a33] px-5 py-3 hover:bg-[#202530]"
              >
                <Bookmark size={13} className="mt-0.5 text-blue-400" />

                <button
                  type="button"
                  title="Open"
                  onClick={() => onOpenSaved(query)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="mb-1 text-xs font-medium text-white">{query.name}</div>
                  <SqlPreview sql={query.sql} />
                  <div className="mt-1.5 flex gap-3 text-[10px] text-gray-500">
                    <span>{connectionName(query.connectionId) ?? 'No connection'}</span>
                    <span>Updated {formatRelativeTime(query.updatedAt)}</span>
                  </div>
                </button>

                <button
                  type="button"
                  title="Delete saved query"
                  onClick={() => void deleteSaved(query)}
                  className="self-start p-1 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
