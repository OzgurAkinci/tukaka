import { useEffect, useState } from 'react';
import { FileCode2, Settings2, Table2 } from 'lucide-react';
import type { ConnectionProfile, DatabaseColumn } from '@tukaka/contracts';

import { errorMessage } from '../api/client';
import { connectionsApi } from '../api/connections';
import type { TableTab } from '../hooks/useWorkspaceTabs';
import TableDataViewer from './TableDataViewer';
import TableStructure from './TableStructure';

interface TableTabViewProps {
  tab: TableTab;
  connection: ConnectionProfile | undefined;
  defaultPageSize: number;
  onViewChange: (view: TableTab['view']) => void;
  onQueryTable: (sql: string) => void;
}

function quoteFor(type: ConnectionProfile['type'] | undefined, name: string) {
  return type === 'mysql'
    ? '`' + name.replace(/`/g, '``') + '`'
    : `"${name.replace(/"/g, '""')}"`;
}

export default function TableTabView({
  tab,
  connection,
  defaultPageSize,
  onViewChange,
  onQueryTable,
}: TableTabViewProps) {
  const [reloadToken, setReloadToken] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    columns: DatabaseColumn[];
    error: string | null;
  } | null>(null);
  // Data görünümü bir kez açıldıktan sonra bağlı kalır (filtre/sayfa durumu korunur).
  const [dataOpened, setDataOpened] = useState(tab.view === 'data');

  // İstek anahtarı değişince yeniden yükle; yükleniyor durumu anahtardan türetilir.
  const requestKey = `${tab.connectionId}|${tab.schema}|${tab.table}|${reloadToken}`;

  useEffect(() => {
    let cancelled = false;

    connectionsApi
      .getColumns(tab.connectionId, tab.schema, tab.table)
      .then(
        (response) => ({ columns: response.columns, error: null }),
        (loadError: unknown) => ({
          columns: [] as DatabaseColumn[],
          error: errorMessage(loadError, 'Table columns could not be loaded.'),
        }),
      )
      .then((result) => {
        if (!cancelled) setLoaded({ key: requestKey, ...result });
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey, tab.connectionId, tab.schema, tab.table]);

  const loading = loaded?.key !== requestKey;
  const columns = loaded?.columns ?? [];
  const error = loading ? null : (loaded?.error ?? null);

  const selectView = (view: TableTab['view']) => {
    if (view === 'data') setDataOpened(true);
    onViewChange(view);
  };

  const openInEditor = () => {
    const ref = `${quoteFor(connection?.type, tab.schema)}.${quoteFor(connection?.type, tab.table)}`;
    onQueryTable(`SELECT *\nFROM ${ref}\nLIMIT 100;`);
  };

  const subTab = (view: TableTab['view']) =>
    `h-full flex items-center gap-2 text-xs border-b-2 ${
      tab.view === view
        ? 'border-blue-500 text-white'
        : 'border-transparent text-gray-500 hover:text-gray-300'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111318]">
      {/* Table header */}
      <div className="h-14 shrink-0 flex items-center justify-between px-5 border-b border-[#292d36] bg-[#171a21]">
        <div className="flex items-center gap-3 min-w-0">
          <Table2
            size={18}
            className={tab.tableType === 'view' ? 'text-purple-400' : 'text-sky-400'}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">
                {tab.table}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#292e39] text-gray-400 uppercase">
                {tab.tableType}
              </span>
            </div>
            <div className="text-[10px] text-gray-500 truncate">
              {tab.schema} · {connection?.name ?? 'Unknown connection'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={openInEditor}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white hover:bg-[#292e39]"
        >
          <FileCode2 size={14} />
          Query in editor
        </button>
      </div>

      {/* Sub tabs */}
      <div className="h-10 shrink-0 flex items-center gap-5 px-5 border-b border-[#292d36] bg-[#171a21]">
        <button type="button" onClick={() => selectView('data')} className={subTab('data')}>
          <Table2 size={13} />
          Data
        </button>
        <button
          type="button"
          onClick={() => selectView('structure')}
          className={subTab('structure')}
        >
          <Settings2 size={13} />
          Structure
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <div className={tab.view === 'structure' ? 'flex h-full flex-col' : 'hidden'}>
          <div className="flex-1 min-h-0 overflow-auto">
            <TableStructure
              columns={columns}
              loading={loading}
              error={error}
              onRetry={() => setReloadToken((token) => token + 1)}
            />
          </div>
          <div className="h-8 shrink-0 px-4 flex items-center justify-between border-t border-[#292d36] text-[10px] text-gray-500">
            <span>{loading ? 'Loading' : `${columns.length} columns`}</span>
            <span>
              {tab.schema}.{tab.table}
            </span>
          </div>
        </div>

        {dataOpened && (
          <div className={tab.view === 'data' ? 'h-full' : 'hidden'}>
            <TableDataViewer
              connectionId={tab.connectionId}
              schema={tab.schema}
              table={tab.table}
              columns={columns}
              defaultPageSize={defaultPageSize}
            />
          </div>
        )}
      </div>
    </div>
  );
}
