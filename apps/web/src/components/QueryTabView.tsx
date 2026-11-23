import { useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eraser,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Square,
  Table2,
  Terminal,
} from 'lucide-react';
import type {
  CompletionMetadata,
  ConnectionProfile,
} from '@tukaka/contracts';

import { isDirty, type QueryTab } from '../hooks/useWorkspaceTabs';
import ExportMenu from './ExportMenu';
import ResultGrid from './ResultGrid';
import SqlEditor, { type CursorPosition } from './SqlEditor';

interface QueryTabViewProps {
  tab: QueryTab;
  connections: ConnectionProfile[];
  completion: CompletionMetadata | null;
  onChange: (patch: Partial<QueryTab>) => void;
  onRun: (sql?: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onCursorChange: (position: CursorPosition) => void;
}

export default function QueryTabView({
  tab,
  connections,
  completion,
  onChange,
  onRun,
  onCancel,
  onSave,
  onCursorChange,
}: QueryTabViewProps) {
  const connection = connections.find((item) => item.id === tab.connectionId);
  const result = tab.result;

  const handleSqlChange = useCallback(
    (sql: string) => onChange({ sql }),
    [onChange],
  );

  const handleEditorRun = useCallback(
    (selected: string | null) => onRun(selected ?? undefined),
    [onRun],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Connection toolbar */}
      <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-[#292d36] bg-[#14171d]">
        <div className="flex items-center gap-2">
          <select
            value={tab.connectionId ?? ''}
            onChange={(event) =>
              onChange({ connectionId: event.target.value || null })
            }
            aria-label="Connection"
            className="px-3 py-1.5 rounded border border-[#303541] bg-[#1c2029] text-xs text-gray-200 outline-none"
          >
            <option value="">Select connection</option>
            {connections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.type})
              </option>
            ))}
          </select>

          {tab.connectionId && !connection && (
            <span className="text-[11px] text-amber-400">
              Connection no longer exists
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden lg:inline text-[10px] text-gray-600 mr-1">
            ⌘/Ctrl + Enter to run · selection runs alone
          </span>

          {tab.running ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={connection?.type === 'sqlite'}
              title={
                connection?.type === 'sqlite'
                  ? 'SQLite queries cannot be cancelled'
                  : 'Cancel query'
              }
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium"
            >
              <Square size={11} fill="currentColor" />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onRun()}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
            >
              <Play size={13} fill="currentColor" />
              Run
            </button>
          )}

          <button
            type="button"
            onClick={() => onChange({ sql: '' })}
            className="p-2 rounded hover:bg-[#292e39] text-gray-400"
            title="Clear editor"
          >
            <Eraser size={15} />
          </button>

          <button
            type="button"
            onClick={onSave}
            className="relative p-2 rounded hover:bg-[#292e39] text-gray-400"
            title={tab.savedQueryId ? 'Save (⌘/Ctrl + S)' : 'Save as… (⌘/Ctrl + S)'}
          >
            <Save size={15} />
            {isDirty(tab) && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
            )}
          </button>
        </div>
      </div>

      {/* SQL editor */}
      <section className="flex-1 min-h-[180px] min-w-0 flex bg-[#111318]">
        <SqlEditor
          value={tab.sql}
          onChange={handleSqlChange}
          databaseType={connection?.type ?? null}
          completion={completion}
          onRun={handleEditorRun}
          onSave={onSave}
          onCursorChange={onCursorChange}
        />
      </section>

      {/* Results */}
      <section className="h-[42%] min-h-[220px] flex flex-col border-t border-[#303541] bg-[#151820]">
        <div className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-[#292d36]">
          <div className="flex items-center h-full gap-5">
            {(
              [
                ['results', 'Results', Table2],
                ['messages', 'Messages', Terminal],
              ] as const
            ).map(([panel, label, Icon]) => (
              <button
                key={panel}
                type="button"
                onClick={() => onChange({ panel })}
                className={`h-full flex items-center gap-2 text-xs border-b-2 ${
                  tab.panel === panel
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-gray-500'
                }`}
              >
                <Icon size={14} />
                {label}
                {panel === 'messages' && tab.error && (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-gray-500">
            <button
              type="button"
              title="Run last query again"
              disabled={!tab.lastRunSql || tab.running}
              onClick={() => onRun(tab.lastRunSql ?? undefined)}
              className="hover:text-white disabled:opacity-40 disabled:hover:text-inherit"
            >
              <RefreshCw size={14} />
            </button>

            <ExportMenu
              fileBaseName={tab.title.replace(/\.sql$/, '') || 'result'}
              columns={result?.columns ?? []}
              rows={result?.rows ?? []}
              disabled={!result || result.columns.length === 0}
            />
          </div>
        </div>

        {tab.panel === 'results' ? (
          <div className="relative flex-1 overflow-auto">
            {tab.running && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#151820]/70 text-xs text-gray-400">
                <Loader2 size={16} className="mr-2 animate-spin" />
                Running query…
              </div>
            )}

            {result && result.columns.length > 0 ? (
              <ResultGrid columns={result.columns} rows={result.rows} />
            ) : result ? (
              <div className="p-6 text-center">
                <CheckCircle2
                  size={24}
                  className="mx-auto mb-2 text-emerald-500"
                />
                <p className="text-sm text-gray-300">
                  Query executed successfully.
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {result.rowCount} row(s) affected.
                </p>
              </div>
            ) : tab.error ? (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-red-400">
                <AlertTriangle size={14} />
                Query failed — see Messages.
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-gray-600">
                Run a query to see results.
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-4 text-xs">
            {tab.notice && (
              <div className="mb-3 text-amber-400">{tab.notice}</div>
            )}

            {tab.running ? (
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 size={13} className="animate-spin" />
                Running query…
              </div>
            ) : tab.error ? (
              <div className="text-red-400 whitespace-pre-wrap">
                <div className="mb-2 font-semibold">Query execution failed</div>
                {tab.error}
              </div>
            ) : result ? (
              <div className="text-emerald-400">
                <div className="mb-2 font-semibold">
                  Query executed successfully
                </div>
                <div className="text-gray-400">Rows: {result.rowCount}</div>
                <div className="text-gray-400">
                  Duration: {result.durationMs} ms
                </div>
                {result.statementCount !== null &&
                  result.statementCount > 1 && (
                    <div className="text-gray-400">
                      Statements: {result.statementCount} (showing result of
                      the last one)
                    </div>
                  )}
                {result.truncated && (
                  <div className="mt-2 text-amber-400">
                    Result truncated to the first {result.rowCount} rows. Change
                    the limit in Settings.
                  </div>
                )}
              </div>
            ) : (
              <span className="text-gray-500">No query has been run yet.</span>
            )}
          </div>
        )}

        <div className="h-8 shrink-0 px-4 flex items-center justify-between border-t border-[#292d36] text-[10px] text-gray-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              {tab.running ? (
                <Loader2 size={12} className="animate-spin text-blue-400" />
              ) : tab.error ? (
                <AlertTriangle size={12} className="text-red-400" />
              ) : (
                <CheckCircle2 size={12} className="text-emerald-500" />
              )}
              {tab.running ? 'Running' : tab.error ? 'Error' : 'Ready'}
            </span>
            <span>{result ? `${result.rowCount} rows` : '0 rows'}</span>
            {result?.truncated && (
              <span className="text-amber-400">
                Limited to first {result.rowCount} rows
              </span>
            )}
            {result && <span>{result.durationMs} ms</span>}
          </div>
          <span>{connection ? connection.type : 'SQL'}</span>
        </div>
      </section>
    </div>
  );
}
