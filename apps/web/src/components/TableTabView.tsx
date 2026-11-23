import { useEffect, useState } from 'react';
import { Check, Copy, FileCode2, ScrollText, Settings2, Table2 } from 'lucide-react';
import type {
  ConnectionProfile,
  DatabaseColumn,
  TableDetailsResponse,
} from '@tukaka/contracts';

import { errorMessage } from '../api/client';
import { connectionsApi } from '../api/connections';
import type { TableTab } from '../hooks/useWorkspaceTabs';
import { databases, qualifiedName } from '../lib/databases';
import { dropColumnSql } from '../lib/ddl';
import ColumnDesigner from './ColumnDesigner';
import TableDataViewer from './TableDataViewer';
import TableStructure from './TableStructure';

interface TableTabViewProps {
  tab: TableTab;
  connection: ConnectionProfile | undefined;
  defaultPageSize: number;
  onViewChange: (view: TableTab['view']) => void;
  /** Verilen SQL'i yeni bir sorgu sekmesinde açar. */
  onQueryTable: (sql: string) => void;
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
  const [detailsWanted, setDetailsWanted] = useState(tab.view !== 'data');
  const [details, setDetails] = useState<{
    key: string;
    value: TableDetailsResponse | null;
    error: string | null;
  } | null>(null);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // İndeks/FK/DDL yalnızca Structure ya da DDL açıldığında yüklenir.
  useEffect(() => {
    if (!detailsWanted) return;

    let cancelled = false;

    connectionsApi
      .getTableDetails(tab.connectionId, tab.schema, tab.table)
      .then(
        (value) => ({ value, error: null }),
        (loadError: unknown) => ({
          value: null,
          error: errorMessage(loadError, 'Table details could not be loaded.'),
        }),
      )
      .then((result) => {
        if (!cancelled) setDetails({ key: requestKey, ...result });
      });

    return () => {
      cancelled = true;
    };
  }, [detailsWanted, requestKey, tab.connectionId, tab.schema, tab.table]);

  const loading = loaded?.key !== requestKey;
  const columns = loaded?.columns ?? [];
  const error = loading ? null : (loaded?.error ?? null);
  const currentDetails = details?.key === requestKey ? details : null;

  const type = connection?.type;
  const info = type ? databases[type] : undefined;
  const isTable = tab.tableType === 'table';
  const canEdit = Boolean(info?.supports.rowEditing) && isTable;
  const canAlter = Boolean(type) && isTable;

  const selectView = (view: TableTab['view']) => {
    if (view === 'data') setDataOpened(true);
    else setDetailsWanted(true);
    onViewChange(view);
  };

  const openInEditor = () => {
    onQueryTable(`SELECT *\nFROM ${qualifiedName(type, tab.schema, tab.table)}\nLIMIT 100;`);
  };

  const copyDdl = async () => {
    if (!currentDetails?.value?.ddl) return;

    try {
      await navigator.clipboard.writeText(currentDetails.value.ddl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Panoya erişim yoksa sessizce geç.
    }
  };

  const subTab = (view: TableTab['view']) =>
    `h-full flex items-center gap-2 text-xs border-b-2 ${
      tab.view === view
        ? 'border-blue-500 text-white'
        : 'border-transparent text-gray-500 hover:text-gray-300'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--c-111318)">
      {/* Table header */}
      <div className="h-14 shrink-0 flex items-center justify-between px-5 border-b border-(--c-292d36) bg-(--c-171a21)">
        <div className="flex items-center gap-3 min-w-0">
          <Table2
            size={18}
            className={tab.tableType === 'view' ? 'text-purple-400' : 'text-sky-400'}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{tab.table}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-(--c-292e39) text-gray-400 uppercase">
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
          className="flex items-center gap-2 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-white hover:bg-(--c-292e39)"
        >
          <FileCode2 size={14} />
          Query in editor
        </button>
      </div>

      {/* Sub tabs */}
      <div className="h-10 shrink-0 flex items-center gap-5 px-5 border-b border-(--c-292d36) bg-(--c-171a21)">
        <button type="button" onClick={() => selectView('data')} className={subTab('data')}>
          <Table2 size={13} />
          Data
        </button>
        <button type="button" onClick={() => selectView('structure')} className={subTab('structure')}>
          <Settings2 size={13} />
          Structure
        </button>
        <button type="button" onClick={() => selectView('ddl')} className={subTab('ddl')}>
          <ScrollText size={13} />
          DDL
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <div className={tab.view === 'structure' ? 'h-full overflow-auto' : 'hidden'}>
          <TableStructure
            columns={columns}
            loading={loading}
            error={error}
            onRetry={() => setReloadToken((token) => token + 1)}
            details={currentDetails?.value ?? null}
            detailsError={currentDetails?.error ?? null}
            onAddColumn={canAlter ? () => setDesignerOpen(true) : undefined}
            onDropColumn={
              canAlter && type
                ? (column) => onQueryTable(dropColumnSql(type, tab.schema, tab.table, column))
                : undefined
            }
          />
        </div>

        <div className={tab.view === 'ddl' ? 'flex h-full flex-col' : 'hidden'}>
          <div className="flex h-9 shrink-0 items-center justify-end gap-3 border-b border-(--c-292d36) bg-(--c-14171d) px-4 text-[11px]">
            <button
              type="button"
              disabled={!currentDetails?.value?.ddl}
              onClick={() => void copyDdl()}
              className="flex items-center gap-1 text-gray-400 hover:text-white disabled:opacity-40"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              disabled={!currentDetails?.value?.ddl}
              onClick={() => currentDetails?.value?.ddl && onQueryTable(currentDetails.value.ddl)}
              className="flex items-center gap-1 text-gray-400 hover:text-white disabled:opacity-40"
            >
              <FileCode2 size={12} />
              Open in editor
            </button>
          </div>
          <pre className="flex-1 min-h-0 overflow-auto p-5 font-mono text-xs leading-relaxed text-gray-200 whitespace-pre">
            {currentDetails?.error ? (
              <span className="text-red-400">{currentDetails.error}</span>
            ) : currentDetails ? (
              (currentDetails.value?.ddl ?? '-- DDL is not available for this object.')
            ) : (
              <span className="text-gray-500">Loading…</span>
            )}
          </pre>
        </div>

        {dataOpened && (
          <div className={tab.view === 'data' ? 'h-full' : 'hidden'}>
            <TableDataViewer
              connectionId={tab.connectionId}
              schema={tab.schema}
              table={tab.table}
              columns={columns}
              defaultPageSize={defaultPageSize}
              canEdit={canEdit && !loading}
            />
          </div>
        )}
      </div>

      {designerOpen && type && (
        <ColumnDesigner
          mode="add-column"
          databaseType={type}
          schema={tab.schema}
          table={tab.table}
          onClose={() => setDesignerOpen(false)}
          onGenerate={(sql) => {
            setDesignerOpen(false);
            onQueryTable(sql);
          }}
        />
      )}
    </div>
  );
}
