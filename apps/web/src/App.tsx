import { useCallback, useState } from 'react';
import {
  Circle,
  Database,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Zap,
} from 'lucide-react';
import type {
  ConnectionProfile,
  DatabaseRoutine,
  SavedQuery,
} from '@tukaka/contracts';

import { errorMessage } from './api/client';
import { connectionsApi } from './api/connections';
import { queriesApi } from './api/queries';
import ConnectionDialog, {
  type ConnectionConfig,
} from './components/ConnectionDialog';
import ColumnDesigner from './components/ColumnDesigner';
import DatabaseExplorer from './components/DatabaseExplorer';
import ErDiagramView from './components/ErDiagramView';
import QueriesPanel, { type QueriesPanelTab } from './components/QueriesPanel';
import QueryTabView from './components/QueryTabView';
import SaveQueryDialog from './components/SaveQueryDialog';
import SettingsDialog from './components/SettingsDialog';
import type { CursorPosition } from './components/SqlEditor';
import TableTabView from './components/TableTabView';
import TabsBar from './components/TabsBar';
import { useCompletion } from './hooks/useCompletion';
import { useConnections } from './hooks/useConnections';
import { useExplorer } from './hooks/useExplorer';
import { useSettings } from './hooks/useSettings';
import { ThemeContext, useResolvedTheme } from './lib/theme';
import {
  isDirty,
  useWorkspaceTabs,
  type QueryTab,
} from './hooks/useWorkspaceTabs';

type ConnectionDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; connection: ConnectionProfile }
  | null;

function App() {
  const { settings, updateSettings } = useSettings();
  const theme = useResolvedTheme(settings.theme);
  const connections = useConnections();
  const explorer = useExplorer();
  const workspace = useWorkspaceTabs(settings);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [connectionDialog, setConnectionDialog] =
    useState<ConnectionDialogState>(null);
  const [queriesPanel, setQueriesPanel] = useState<QueriesPanelTab | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveDialogTabId, setSaveDialogTabId] = useState<string | null>(null);
  const [tableDesigner, setTableDesigner] = useState<{
    connectionId: string;
    schema: string;
  } | null>(null);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });

  const activeTab = workspace.tabs.find(
    (tab) => tab.id === workspace.activeTabId,
  );
  const activeConnectionId = activeTab?.connectionId ?? null;
  const activeConnection = connections.connections.find(
    (item) => item.id === activeConnectionId,
  );

  const { completion, invalidateCompletion } = useCompletion(
    activeTab?.kind === 'query' ? [activeTab.connectionId] : [],
  );

  // ---------------------------------------------------------------------------
  // Bağlantılar
  // ---------------------------------------------------------------------------

  const handleConnectionSave = async (config: ConnectionConfig) => {
    try {
      if (connectionDialog?.mode === 'edit') {
        await connections.updateConnection(connectionDialog.connection.id, config);
        invalidateCompletion(connectionDialog.connection.id);
      } else {
        const created = await connections.createConnection(config);

        // Yeni bağlantıyı, bağlantısı olmayan aktif sorgu sekmesine bağla.
        if (activeTab?.kind === 'query' && !activeTab.connectionId) {
          workspace.updateQueryTab(activeTab.id, { connectionId: created.id });
        }
      }

      setConnectionDialog(null);
    } catch (error) {
      connections.setError(errorMessage(error, 'Bağlantı kaydedilemedi.'));
    }
  };

  const handleConnectionDelete = async (connection: ConnectionProfile) => {
    if (
      !window.confirm(
        `"${connection.name}" bağlantısını silmek istediğine emin misin?`,
      )
    ) {
      return;
    }

    try {
      await connections.removeConnection(connection.id);
      workspace.handleConnectionRemoved(connection.id);
    } catch (error) {
      connections.setError(errorMessage(error, 'Bağlantı silinemedi.'));
    }
  };

  const handleExplorerRefresh = (connectionId: string) => {
    void explorer.refreshConnection(connectionId);
    invalidateCompletion(connectionId);
  };

  // ---------------------------------------------------------------------------
  // Sorgular
  // ---------------------------------------------------------------------------

  const newQueryTab = useCallback(
    (connectionId?: string | null, sql = '') =>
      workspace.openQueryTab({
        connectionId: connectionId ?? activeConnectionId,
        sql,
      }),
    [workspace, activeConnectionId],
  );

  const saveQuery = async (tab: QueryTab) => {
    if (!tab.savedQueryId) {
      setSaveDialogTabId(tab.id);
      return;
    }

    try {
      const saved = await queriesApi.updateSavedQuery(tab.savedQueryId, {
        sql: tab.sql,
        connectionId: tab.connectionId,
      });

      workspace.updateQueryTab(tab.id, { savedSql: saved.sql });
    } catch {
      // Kayıtlı sorgu silinmiş olabilir; yeni kayıt olarak sor.
      workspace.updateQueryTab(tab.id, { savedQueryId: null, savedSql: null });
      setSaveDialogTabId(tab.id);
    }
  };

  const saveQueryAs = async (name: string) => {
    const tab = workspace.tabs.find(
      (item): item is QueryTab =>
        item.id === saveDialogTabId && item.kind === 'query',
    );

    if (!tab) return;

    const saved = await queriesApi.createSavedQuery({
      name,
      sql: tab.sql,
      connectionId: tab.connectionId,
    });

    workspace.updateQueryTab(tab.id, {
      title: saved.name,
      savedQueryId: saved.id,
      savedSql: saved.sql,
    });

    setSaveDialogTabId(null);
  };

  const closeTab = (id: string) => {
    const tab = workspace.tabs.find((item) => item.id === id);

    if (
      tab?.kind === 'query' &&
      isDirty(tab) &&
      !window.confirm(`"${tab.title}" has unsaved changes. Close anyway?`)
    ) {
      return;
    }

    workspace.closeTab(id);
  };

  const openSaved = (saved: SavedQuery) => {
    workspace.openSavedQuery(saved);
    setQueriesPanel(null);
  };

  const openSql = (sql: string, connectionId: string | null) => {
    workspace.openQueryTab({ sql, connectionId });
    setQueriesPanel(null);
  };

  /** Fonksiyon/prosedür tanımını yeni bir sorgu sekmesinde açar. */
  const openRoutine = async (
    connectionId: string,
    schema: string,
    routine: DatabaseRoutine,
  ) => {
    try {
      const { definition } = await connectionsApi.getRoutineDefinition(
        connectionId,
        schema,
        routine,
      );
      workspace.openQueryTab({ title: `${routine.name}.sql`, sql: definition, connectionId });
    } catch (error) {
      connections.setError(errorMessage(error, 'Routine definition could not be loaded.'));
    }
  };

  const needle = search.trim().toLowerCase();
  const filteredConnections = connections.connections.filter((item) =>
    item.name.toLowerCase().includes(needle),
  );

  const saveDialogTab = workspace.tabs.find(
    (item): item is QueryTab =>
      item.id === saveDialogTabId && item.kind === 'query',
  );

  return (
    <ThemeContext.Provider value={theme}>
    <div className="h-screen flex flex-col bg-(--c-111318) text-(--c-d5d8df) overflow-hidden">
      {/* Top bar */}
      <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-(--c-292d36) bg-(--c-171a21)">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Database size={19} className="text-[white]" />
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm tracking-wide text-white">
              Database Studio
            </span>
            {import.meta.env.DEV && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-(--c-292e39) text-gray-400">
                DEV
              </span>
            )}
          </div>

          <div className="h-5 w-px bg-(--c-343946) mx-2" />

          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            className="p-2 rounded-md hover:bg-(--c-292e39) text-gray-400"
            title="Toggle sidebar"
          >
            {sidebarOpen ? (
              <PanelLeftClose size={17} />
            ) : (
              <PanelLeftOpen size={17} />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-gray-400 px-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Workspace
          </div>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="p-2 rounded-md hover:bg-(--c-292e39) text-gray-400"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-[280px] shrink-0 border-r border-(--c-292d36) bg-(--c-171a21) flex flex-col">
            <div className="p-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                Database Explorer
              </span>

              <button
                type="button"
                className="p-1.5 rounded hover:bg-(--c-292e39) text-gray-400"
                title="Add connection"
                onClick={() => setConnectionDialog({ mode: 'create' })}
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="px-3 pb-3">
              <div className="flex items-center gap-2 px-2.5 h-9 rounded-md border border-(--c-303541) bg-(--c-111318)">
                <Search size={14} className="text-gray-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search connections..."
                  aria-label="Search connections"
                  className="w-full bg-transparent outline-none text-xs text-gray-200 placeholder:text-gray-600"
                />
              </div>
            </div>

            <div className="px-3 pb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                Connections
              </span>
              <span className="text-[10px] text-gray-600">
                {filteredConnections.length} items
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2">
              {connections.error && (
                <p className="mx-1 mb-2 rounded bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">
                  {connections.error}
                </p>
              )}

              <DatabaseExplorer
                connections={filteredConnections}
                explorer={explorer}
                testStatuses={connections.testStatuses}
                activeConnectionId={activeConnectionId}
                activeTable={
                  activeTab?.kind === 'table'
                    ? {
                        connectionId: activeTab.connectionId,
                        schema: activeTab.schema,
                        table: activeTab.table,
                      }
                    : null
                }
                onNewQuery={(connectionId) => newQueryTab(connectionId)}
                onEdit={(connection) =>
                  setConnectionDialog({ mode: 'edit', connection })
                }
                onDelete={(connection) => void handleConnectionDelete(connection)}
                onTest={(connectionId) => void connections.testConnection(connectionId)}
                onRefresh={handleExplorerRefresh}
                onOpenTable={workspace.openTableTab}
                onOpenErDiagram={workspace.openErTab}
                onCreateTable={(connectionId, schema) =>
                  setTableDesigner({ connectionId, schema })
                }
                onOpenRoutine={(connectionId, schema, routine) =>
                  void openRoutine(connectionId, schema, routine)
                }
              />

              {connections.loading && (
                <p className="text-xs text-gray-500 text-center py-6">
                  Loading connections...
                </p>
              )}

              {!connections.loading && filteredConnections.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-6">
                  No connections found
                </p>
              )}
            </div>

            <div className="border-t border-(--c-292d36) p-3 space-y-1">
              <button
                type="button"
                onClick={() => setQueriesPanel('history')}
                className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-(--c-252a34) text-gray-400"
              >
                <History size={15} />
                <span className="text-xs">Query History & Saved</span>
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-(--c-252a34) text-gray-400"
              >
                <Settings size={15} />
                <span className="text-xs">Settings</span>
              </button>
            </div>
          </aside>
        )}

        {/* Main workspace */}
        <main className="flex-1 min-w-0 flex flex-col">
          <TabsBar
            tabs={workspace.tabs}
            activeTabId={workspace.activeTabId}
            onSelect={workspace.setActiveTabId}
            onClose={closeTab}
            onNewQuery={() => newQueryTab()}
          />

          {/* Sekmeler bağlı kalır; editör geçmişi ve viewer durumu korunur. */}
          <div className="relative flex-1 min-h-0">
            {workspace.tabs.map((tab) => (
              <div
                key={tab.id}
                className={
                  tab.id === workspace.activeTabId ? 'absolute inset-0' : 'hidden'
                }
              >
                {tab.kind === 'query' ? (
                  <QueryTabView
                    tab={tab}
                    connections={connections.connections}
                    completion={
                      tab.connectionId ? (completion[tab.connectionId] ?? null) : null
                    }
                    onChange={(patch) => workspace.updateQueryTab(tab.id, patch)}
                    onRun={(sql) => void workspace.runQuery(tab.id, sql)}
                    onExplain={(sql) => void workspace.explainQuery(tab.id, sql)}
                    onCancel={() => void workspace.cancelQuery(tab.id)}
                    onSave={() => void saveQuery(tab)}
                    onCursorChange={(position) => {
                      if (tab.id === workspace.activeTabId) setCursor(position);
                    }}
                  />
                ) : tab.kind === 'er' ? (
                  <ErDiagramView
                    connectionId={tab.connectionId}
                    schema={tab.schema}
                    connection={connections.connections.find(
                      (item) => item.id === tab.connectionId,
                    )}
                    onOpenTable={(table, type) =>
                      workspace.openTableTab(tab.connectionId, tab.schema, table, type)
                    }
                  />
                ) : (
                  <TableTabView
                    tab={tab}
                    connection={connections.connections.find(
                      (item) => item.id === tab.connectionId,
                    )}
                    defaultPageSize={settings.pageSize}
                    onViewChange={(view) => workspace.updateTab(tab.id, { view })}
                    onQueryTable={(sql) => newQueryTab(tab.connectionId, sql)}
                  />
                )}
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Bottom status bar */}
      <footer className="h-7 shrink-0 flex items-center justify-between px-4 bg-(--c-171a21) border-t border-(--c-292d36) text-[10px] text-gray-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Circle size={8} className="text-emerald-500 fill-emerald-500" />
            Application Ready
          </span>
          <span>Database Studio v0.1.0</span>
          {activeConnection && (
            <span>
              {activeConnection.name} · {activeConnection.type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span>Limit {settings.maxRows.toLocaleString()} rows</span>
          {import.meta.env.DEV && (
            <span className="flex items-center gap-1">
              <Zap size={11} />
              Development
            </span>
          )}
          {activeTab?.kind === 'query' && (
            <span>
              Ln {cursor.line}, Col {cursor.column}
            </span>
          )}
        </div>
      </footer>

      {connectionDialog && (
        <ConnectionDialog
          initialConfig={
            connectionDialog.mode === 'edit'
              ? connectionDialog.connection
              : undefined
          }
          onClose={() => setConnectionDialog(null)}
          onSave={(config) => void handleConnectionSave(config)}
        />
      )}

      {queriesPanel && (
        <QueriesPanel
          initialTab={queriesPanel}
          connections={connections.connections}
          activeConnectionId={activeConnectionId}
          onClose={() => setQueriesPanel(null)}
          onOpenSql={openSql}
          onOpenSaved={openSaved}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            updateSettings(next);
            setSettingsOpen(false);
          }}
        />
      )}

      {tableDesigner && (() => {
        const target = connections.connections.find(
          (item) => item.id === tableDesigner.connectionId,
        );

        return target ? (
          <ColumnDesigner
            mode="create-table"
            databaseType={target.type}
            schema={tableDesigner.schema}
            onClose={() => setTableDesigner(null)}
            onGenerate={(sql) => {
              setTableDesigner(null);
              workspace.openQueryTab({ sql, connectionId: target.id });
            }}
          />
        ) : null;
      })()}

      {saveDialogTab && (
        <SaveQueryDialog
          initialName={saveDialogTab.title.replace(/\.sql$/, '')}
          onClose={() => setSaveDialogTabId(null)}
          onSave={saveQueryAs}
        />
      )}
    </div>
    </ThemeContext.Provider>
  );
}

export default App;
