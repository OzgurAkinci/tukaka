
import { useEffect, useState } from 'react';
import {
  Database,
  Plus,
  Search,
  ChevronRight,
  Play,
  Save,
  Activity,
  History,
  Settings,
  Table2,
  X,
  FileCode2,
  Download,
  RefreshCw,
  PanelLeftClose,
  Terminal,
  CheckCircle2,
  Circle,
  MoreHorizontal,
  Zap,
  Trash2,
  Pencil,
  Loader2,
  ChevronDown,
  FolderTree,
} from 'lucide-react';
import SqlEditor from './components/SqlEditor';
import {
  connectionsApi,
  type ConnectionProfile,
  type QueryResult,
  type DatabaseSchema,
  type DatabaseTable,
} from './services/connections';

import type { ConnectionConfig } from './components/ConnectionDialog';
import ConnectionDialog from './components/ConnectionDialog';

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function App() {
  const [activeTab, setActiveTab] = useState('query-1');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(
    'SELECT *\nFROM users\nORDER BY id\nLIMIT 100;'
  );
  //const [executed, setExecuted] = useState(false);
  const [running, setRunning] = useState(false);
  const [activePanel, setActivePanel] = useState('results');

  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);

  // Database Explorer states
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(
    new Set(),
  );

  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    new Set(),
  );

  const [schemasByConnection, setSchemasByConnection] = useState<
    Record<string, DatabaseSchema[]>
  >({});

  const [tablesBySchema, setTablesBySchema] = useState<
    Record<string, DatabaseTable[]>
  >({});

  const [schemasLoading, setSchemasLoading] = useState<
    Record<string, boolean>
  >({});

  const [tablesLoading, setTablesLoading] = useState<
    Record<string, boolean>
  >({});

  const [explorerErrors, setExplorerErrors] = useState<
    Record<string, string>
  >({});

  const [editingConnection, setEditingConnection] = useState<ConnectionProfile | null>(null);

  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  type ConnectionTestStatus = {
    loading: boolean;
    success?: boolean;
    message?: string;
  };

  const [connectionTestStatuses, setConnectionTestStatuses] = useState<Record<string, ConnectionTestStatus>>({});

  useEffect(() => {
    let cancelled = false;

    const loadConnections = async () => {
      try {
        setConnectionsLoading(true);
        setConnectionsError(null);

        const result = await connectionsApi.findAll();

        if (!cancelled) {
          setConnections(result);

          setSelectedConnectionId((current) => {
            if (current && result.some((item) => item.id === current)) {
              return current;
            }

            return result[0]?.id ?? null;
          });
        }
      } catch (error) {
        if (!cancelled) {
          setConnectionsError(
            error instanceof Error
              ? error.message
              : 'Bağlantılar yüklenemedi.',
          );
        }
      } finally {
        if (!cancelled) {
          setConnectionsLoading(false);
        }
      }
    };

    loadConnections();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveConnection = async (config: ConnectionConfig) => {
    try {
      setConnectionsError(null);

      const savedConnection = await connectionsApi.create({
        name: config.name,
        type: config.type,
        database: config.database,
        ...(config.type !== 'sqlite' && {
          host: config.host,
          port: config.port,
          username: config.username,
        }),
      });

      if (config.password) {
        try {
          await connectionsApi.setCredential(
            savedConnection.id,
            config.password,
          );
        } catch (credentialError) {
          await connectionsApi.remove(savedConnection.id);
          throw credentialError;
        }
      }

      setConnections((previous) => [
        ...previous,
        savedConnection,
      ]);

      setIsConnectionDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Bağlantı kaydedilemedi.';

      setConnectionsError(message);
      console.error('Connection save error:', error);
    }
  };

  const handleUpdateConnection = async (
    config: ConnectionConfig,
  ) => {
    if (!editingConnection) {
      return;
    }

    try {
      setConnectionsError(null);

      const updatedConnection = await connectionsApi.update(
        editingConnection.id,
        {
          name: config.name,
          database: config.database,
          ...(config.type !== 'sqlite' && {
            host: config.host,
            port: config.port,
            username: config.username,
          }),
        },
      );

      if (config.password) {
        await connectionsApi.setCredential(
          editingConnection.id,
          config.password,
        );
      }

      setConnections((previous) =>
        previous.map((item) =>
          item.id === updatedConnection.id
            ? updatedConnection
            : item,
        ),
      );

      setEditingConnection(null);
      setIsConnectionDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Bağlantı güncellenemedi.';

      setConnectionsError(message);
      console.error('Connection update error:', error);
    }
  };

  const handleDeleteConnection = async (
    connection: ConnectionProfile,
  ) => {
    const confirmed = window.confirm(
      `"${connection.name}" bağlantısını silmek istediğine emin misin?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setConnectionsError(null);

      await connectionsApi.remove(connection.id);

      setConnections((previous) =>
        previous.filter((item) => item.id !== connection.id),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Bağlantı silinemedi.';

      setConnectionsError(message);
      console.error('Connection delete error:', error);
    }
  };

  const getSchemaKey = (connectionId: string, schema: string) =>
    `${connectionId}::${schema}`;

  const loadSchemas = async (
    connectionId: string,
    forceRefresh = false,
  ) => {
    if (!forceRefresh && schemasByConnection[connectionId]) {
      return;
    }

    try {
      setSchemasLoading((previous) => ({
        ...previous,
        [connectionId]: true,
      }));

      setExplorerErrors((previous) => ({
        ...previous,
        [connectionId]: '',
      }));

      const response = await connectionsApi.getSchemas(connectionId);

      setSchemasByConnection((previous) => ({
        ...previous,
        [connectionId]: response.schemas,
      }));
    } catch (error) {
      setExplorerErrors((previous) => ({
        ...previous,
        [connectionId]:
          error instanceof Error
            ? error.message
            : 'Schemas could not be loaded.',
      }));
    } finally {
      setSchemasLoading((previous) => ({
        ...previous,
        [connectionId]: false,
      }));
    }
  };

  const loadTables = async (
    connectionId: string,
    schema: string,
    forceRefresh = false,
  ) => {
    const schemaKey = getSchemaKey(connectionId, schema);

    if (!forceRefresh && tablesBySchema[schemaKey]) {
      return;
    }

    try {
      setTablesLoading((previous) => ({
        ...previous,
        [schemaKey]: true,
      }));

      setExplorerErrors((previous) => ({
        ...previous,
        [schemaKey]: '',
      }));

      const response = await connectionsApi.getTables(
        connectionId,
        schema,
      );

      setTablesBySchema((previous) => ({
        ...previous,
        [schemaKey]: response.tables,
      }));
    } catch (error) {
      setExplorerErrors((previous) => ({
        ...previous,
        [schemaKey]:
          error instanceof Error
            ? error.message
            : 'Tables could not be loaded.',
      }));
    } finally {
      setTablesLoading((previous) => ({
        ...previous,
        [schemaKey]: false,
      }));
    }
  };

  const toggleConnectionExplorer = async (connectionId: string) => {
    const isExpanded = expandedConnections.has(connectionId);

    setExpandedConnections((previous) => {
      const next = new Set(previous);

      if (next.has(connectionId)) {
        next.delete(connectionId);
      } else {
        next.add(connectionId);
      }

      return next;
    });

    if (!isExpanded) {
      await loadSchemas(connectionId);
    }
  };

  const toggleSchemaExplorer = async (
    connectionId: string,
    schema: string,
  ) => {
    const schemaKey = getSchemaKey(connectionId, schema);
    const isExpanded = expandedSchemas.has(schemaKey);

    setExpandedSchemas((previous) => {
      const next = new Set(previous);

      if (next.has(schemaKey)) {
        next.delete(schemaKey);
      } else {
        next.add(schemaKey);
      }

      return next;
    });

    if (!isExpanded) {
      await loadTables(connectionId, schema);
    }
  };

  const refreshConnectionExplorer = async (connectionId: string) => {
    setTablesBySchema((previous) => {
      const next = { ...previous };

      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${connectionId}::`)) {
          delete next[key];
        }
      });

      return next;
    });

    await loadSchemas(connectionId, true);
  };

  const handleTestConnection = async (connectionId: string) => {
    setConnectionTestStatuses((prev) => ({
      ...prev,
      [connectionId]: {
        loading: true,
      },
    }));

    try {
      const result = await connectionsApi.testConnection(connectionId);

      setConnectionTestStatuses((prev) => ({
        ...prev,
        [connectionId]: {
          loading: false,
          success: result.success,
          message: result.message,
        },
      }));
    } catch (error) {
      setConnectionTestStatuses((prev) => ({
        ...prev,
        [connectionId]: {
          loading: false,
          success: false,
          message:
            error instanceof Error
              ? error.message
              : 'Connection test failed.',
        },
      }));
    }
  };

  const runQuery = async () => {
    if (!selectedConnectionId) {
      setQueryError('Please select a database connection.');
      setQueryResult(null);
      setActivePanel('messages');
      return;
    }

    if (!query.trim()) {
      setQueryError('SQL query cannot be empty.');
      setQueryResult(null);
      setActivePanel('messages');
      return;
    }

    setRunning(true);
    //setExecuted(false);
    setQueryError(null);
    setQueryResult(null);

    try {
      const result = await connectionsApi.executeQuery(
        selectedConnectionId,
        {
          sql: query,
          parameters: [],
        },
      );

      setQueryResult(result);
      //setExecuted(true);
      setActivePanel('results');
    } catch (error) {
      setQueryError(
        error instanceof Error
          ? error.message
          : 'Query execution failed.',
      );

      setActivePanel('messages');
    } finally {
      setRunning(false);
    }
  };

  const filteredConnections = connections.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-screen flex flex-col bg-[#111318] text-[#d5d8df] overflow-hidden">
      {/* Top bar */}
      <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-[#292d36] bg-[#171a21]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Database size={19} className="text-white" />
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm tracking-wide text-white">
              Database Studio
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#292e39] text-gray-400">
              DEV
            </span>
          </div>

          <div className="h-5 w-px bg-[#343946] mx-2" />

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-md hover:bg-[#292e39] text-gray-400"
            title="Toggle sidebar"
          >
            <PanelLeftClose size={17} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-gray-400 px-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Workspace
          </div>

          <button className="p-2 rounded-md hover:bg-[#292e39] text-gray-400">
            <Settings size={17} />
          </button>

          <div className="w-8 h-8 rounded-full bg-[#34415d] flex items-center justify-center text-xs font-semibold text-blue-200">
            OA
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-[260px] shrink-0 border-r border-[#292d36] bg-[#171a21] flex flex-col">
            <div className="p-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                Database Explorer
              </span>

              <button
                className="p-1.5 rounded hover:bg-[#292e39] text-gray-400"
                title="Add connection"
                onClick={() => setIsConnectionDialogOpen(true)}
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="px-3 pb-3">
              <div className="flex items-center gap-2 px-2.5 h-9 rounded-md border border-[#303541] bg-[#111318]">
                <Search size={14} className="text-gray-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search connections..."
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

              {filteredConnections.map((connection) => {
                const connectionColor =
                  connection.type === 'postgresql'
                    ? 'text-sky-400'
                    : connection.type === 'mysql'
                      ? 'text-orange-400'
                      : 'text-purple-400';

                const isConnectionExpanded = expandedConnections.has(connection.id);

                return (
                  <div key={connection.id} className="mb-1">

                    {/* Connection row */}
                    <div
                      className={`group flex items-center rounded-md ${selectedConnectionId === connection.id
                          ? 'bg-[#252a34]'
                          : 'hover:bg-[#252a34]'
                        }`}
                    >
                      {/* Expand / collapse */}
                      <button
                        onClick={() => toggleConnectionExplorer(connection.id)}
                        title="Expand database objects"
                        className="p-1.5 ml-1 rounded text-gray-500 hover:text-gray-200"
                      >
                        {isConnectionExpanded ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </button>

                      {/* Select connection */}
                      <button
                        onClick={() => {
                          setSelectedConnectionId(connection.id);
                          setActiveTab('query-1');
                        }}
                        className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 text-left"
                      >
                        <Database size={15} className={connectionColor} />

                        <div className="flex-1 min-w-0">
                          <span className="block text-xs text-gray-300 truncate">
                            {connection.name}
                          </span>

                          {connectionTestStatuses[connection.id]?.message && (
                            <span
                              className={`block mt-1 text-[10px] truncate ${connectionTestStatuses[connection.id].success
                                  ? 'text-emerald-400'
                                  : 'text-red-400'
                                }`}
                              title={connectionTestStatuses[connection.id].message}
                            >
                              {connectionTestStatuses[connection.id].message}
                            </span>
                          )}
                        </div>

                        <span className="text-[9px] text-gray-600 uppercase">
                          {connection.type}
                        </span>
                      </button>

                      {/* Edit button */}
                      <button
                        onClick={() => {
                          setEditingConnection(connection);
                          setIsConnectionDialogOpen(true);
                        }}
                        title="Edit connection"
                        className="p-2 rounded text-gray-600 opacity-0 group-hover:opacity-100 hover:text-blue-400 transition"
                      >
                        <Pencil size={13} />
                      </button>

                      {/* Delete button */}
                      <button
                        onClick={() => handleDeleteConnection(connection)}
                        title="Delete connection"
                        className="p-2 mr-1 rounded text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
                      >
                        <Trash2 size={13} />
                      </button>

                      {/* Test connection */}
                      <button
                        onClick={() => handleTestConnection(connection.id)}
                        disabled={connectionTestStatuses[connection.id]?.loading}
                        title={
                          connectionTestStatuses[connection.id]?.loading
                            ? 'Testing connection...'
                            : 'Test Connection'
                        }
                        className="p-1.5 rounded-md text-gray-400 hover:text-blue-400 hover:bg-white/5 disabled:opacity-50"
                      >
                        {connectionTestStatuses[connection.id]?.loading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Activity size={14} />
                        )}
                      </button>
                    </div>

                    {/* Database explorer */}
                    {isConnectionExpanded && (
                      <div className="ml-4 pl-2 border-l border-[#303541]">

                        {/* Explorer header */}
                        <div className="flex items-center justify-between px-2 py-1.5">
                          <span className="text-[9px] font-semibold tracking-wider text-gray-500">
                            DATABASE OBJECTS
                          </span>

                          <button
                            onClick={() => refreshConnectionExplorer(connection.id)}
                            title="Refresh database objects"
                            className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-white/5"
                          >
                            <RefreshCw
                              size={12}
                              className={
                                schemasLoading[connection.id] ? 'animate-spin' : ''
                              }
                            />
                          </button>
                        </div>

                        {/* Schema loading */}
                        {schemasLoading[connection.id] && (
                          <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-gray-500">
                            <Loader2 size={12} className="animate-spin" />
                            Loading schemas...
                          </div>
                        )}

                        {/* Schema error */}
                        {explorerErrors[connection.id] && (
                          <div className="px-2 py-2">
                            <p className="text-[10px] text-red-400 break-words">
                              {explorerErrors[connection.id]}
                            </p>

                            <button
                              onClick={() => loadSchemas(connection.id, true)}
                              className="mt-1 text-[10px] text-blue-400 hover:text-blue-300"
                            >
                              Try again
                            </button>
                          </div>
                        )}

                        {/* Empty schemas */}
                        {!schemasLoading[connection.id] &&
                          !explorerErrors[connection.id] &&
                          schemasByConnection[connection.id]?.length === 0 && (
                            <p className="px-2 py-2 text-[10px] text-gray-600">
                              No schemas found
                            </p>
                          )}

                        {/* Schema list */}
                        {schemasByConnection[connection.id]?.map((schema) => {
                          const schemaKey = getSchemaKey(
                            connection.id,
                            schema.name
                          );

                          const isSchemaExpanded = expandedSchemas.has(schemaKey);

                          return (
                            <div key={schemaKey}>

                              {/* Schema row */}
                              <button
                                onClick={() =>
                                  toggleSchemaExplorer(connection.id, schema.name)
                                }
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-gray-400 hover:text-gray-200 hover:bg-white/5"
                              >
                                {isSchemaExpanded ? (
                                  <ChevronDown size={12} />
                                ) : (
                                  <ChevronRight size={12} />
                                )}

                                <FolderTree size={13} className="text-amber-400" />

                                <span className="text-[11px] truncate">
                                  {schema.name}
                                </span>
                              </button>

                              {/* Tables and views */}
                              {isSchemaExpanded && (
                                <div className="ml-4 pl-2 border-l border-[#303541]">

                                  {tablesLoading[schemaKey] && (
                                    <div className="flex items-center gap-2 px-2 py-2 text-[10px] text-gray-500">
                                      <Loader2 size={11} className="animate-spin" />
                                      Loading tables...
                                    </div>
                                  )}

                                  {explorerErrors[schemaKey] && (
                                    <div className="px-2 py-2">
                                      <p className="text-[10px] text-red-400 break-words">
                                        {explorerErrors[schemaKey]}
                                      </p>

                                      <button
                                        onClick={() =>
                                          loadTables(connection.id, schema.name, true)
                                        }
                                        className="mt-1 text-[10px] text-blue-400 hover:text-blue-300"
                                      >
                                        Try again
                                      </button>
                                    </div>
                                  )}

                                  {!tablesLoading[schemaKey] &&
                                    !explorerErrors[schemaKey] &&
                                    tablesBySchema[schemaKey]?.length === 0 && (
                                      <p className="px-2 py-2 text-[10px] text-gray-600">
                                        No tables or views
                                      </p>
                                    )}

                                  {tablesBySchema[schemaKey]?.map((table) => (
                                    <div
                                      key={`${schemaKey}:${table.name}`}
                                      title={`${table.type}: ${table.name}`}
                                      className="flex items-center gap-2 px-2 py-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-white/5"
                                    >
                                      <Table2
                                        size={12}
                                        className={
                                          table.type === 'view'
                                            ? 'text-purple-400'
                                            : 'text-sky-400'
                                        }
                                      />

                                      <span className="text-[11px] truncate">
                                        {table.name}
                                      </span>

                                      {table.type === 'view' && (
                                        <span className="ml-auto text-[8px] text-gray-600">
                                          VIEW
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {connectionsLoading && (
                <p className="text-xs text-gray-500 text-center py-6">
                  Loading connections...
                </p>
              )}

              {!connectionsLoading && connectionsError && (
                <p className="text-xs text-red-400 text-center py-6">
                  {connectionsError}
                </p>
              )}

              {!connectionsLoading &&
                !connectionsError &&
                filteredConnections.length === 0 && (
                  <p className="text-xs text-gray-500 text-center py-6">
                    No connections found
                  </p>
                )}
            </div>


            <div className="border-t border-[#292d36] p-3 space-y-1">
              <button className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-[#252a34] text-gray-400">
                <History size={15} />
                <span className="text-xs">Query History</span>
              </button>

              <button className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-[#252a34] text-gray-400">
                <Settings size={15} />
                <span className="text-xs">Settings</span>
              </button>
            </div>
          </aside>
        )}

        {/* Main workspace */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Tabs */}
          <div className="h-11 shrink-0 flex items-center border-b border-[#292d36] bg-[#171a21]">
            <button
              onClick={() => setActiveTab('query-1')}
              className={`h-full px-4 flex items-center gap-2 border-r border-[#292d36] text-xs ${activeTab === 'query-1'
                ? 'bg-[#111318] text-white border-t-2 border-t-blue-500'
                : 'text-gray-500 hover:text-gray-300'
                }`}
            >
              <FileCode2 size={14} className="text-blue-400" />
              query-1.sql
              <X size={13} className="ml-2 text-gray-600" />
            </button>

            <button
              onClick={() => setActiveTab('query-2')}
              className={`h-full px-4 flex items-center gap-2 border-r border-[#292d36] text-xs ${activeTab === 'query-2'
                ? 'bg-[#111318] text-white border-t-2 border-t-blue-500'
                : 'text-gray-500 hover:text-gray-300'
                }`}
            >
              <FileCode2 size={14} className="text-gray-500" />
              query-2.sql
              <X size={13} className="ml-2 text-gray-600" />
            </button>

            <button
              onClick={() => setIsConnectionDialogOpen(true)}
              title="New Connection" className="p-2 ml-1 text-gray-500 hover:text-white">
              <Plus size={16} />
            </button>
          </div>

          {/* Connection toolbar */}
          <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-[#292d36] bg-[#14171d]">
            <div className="flex items-center gap-2">
              <select
                value={selectedConnectionId ?? ''}
                onChange={(event) => setSelectedConnectionId(event.target.value || null)}
                className="px-3 py-1.5 rounded border border-[#303541] bg-[#1c2029] text-xs text-gray-200 outline-none"
              >
                <option value="">Select connection</option>

                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} ({connection.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={runQuery}
                disabled={running}
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium"
              >
                <Play size={13} fill="currentColor" />
                {running ? 'Running...' : 'Run'}
              </button>

              <button
                onClick={() => setQuery('')}
                className="p-2 rounded hover:bg-[#292e39] text-gray-400"
                title="Clear editor"
              >
                <X size={15} />
              </button>

              <button className="p-2 rounded hover:bg-[#292e39] text-gray-400" title="Save">
                <Save size={15} />
              </button>

              <button className="p-2 rounded hover:bg-[#292e39] text-gray-400" title="More">
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>

          {/* SQL editor */}
          <section className="flex-1 min-h-[180px] min-w-0 flex bg-[#111318]">
            <SqlEditor
              value={query}
              onChange={setQuery}
            />
          </section>

          {/* Results */}
          <section className="h-[42%] min-h-[220px] flex flex-col border-t border-[#303541] bg-[#151820]">
            <div className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-[#292d36]">
              <div className="flex items-center h-full gap-5">
                <button
                  onClick={() => setActivePanel('results')}
                  className={`h-full flex items-center gap-2 text-xs border-b-2 ${activePanel === 'results'
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-gray-500'
                    }`}
                >
                  <Table2 size={14} />
                  Results
                </button>

                <button
                  onClick={() => setActivePanel('messages')}
                  className={`h-full flex items-center gap-2 text-xs border-b-2 ${activePanel === 'messages'
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-gray-500'
                    }`}
                >
                  <Terminal size={14} />
                  Messages
                </button>
              </div>

              <div className="flex items-center gap-3 text-gray-500">
                <button title="Refresh" className="hover:text-white">
                  <RefreshCw size={14} />
                </button>
                <button title="Export CSV" className="hover:text-white">
                  <Download size={15} />
                </button>
                <button title="More" className="hover:text-white">
                  <MoreHorizontal size={17} />
                </button>
              </div>
            </div>

            {activePanel === 'results' ? (
              <div className="flex-1 overflow-auto">

                {queryResult && queryResult.columns.length > 0 ? (
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-[#1b1f28]">
                      <tr>
                        {queryResult.columns.map((column) => (
                          <th
                            key={column}
                            className="px-4 py-3 border-b border-r border-[#303541] text-[11px] font-semibold text-gray-400 whitespace-nowrap"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {queryResult.rows.map((row, rowIndex) => (
                        <tr
                          key={rowIndex}
                          className="hover:bg-[#202530]"
                        >
                          {queryResult.columns.map((column) => {
                            const value = row[column];

                            return (
                              <td
                                key={`${rowIndex}-${column}`}
                                className="px-4 py-2.5 border-b border-r border-[#292d36] text-xs text-gray-300 whitespace-nowrap"
                              >
                                {value === null || value === undefined ? (
                                  <span className="text-gray-600 italic">
                                    NULL
                                  </span>
                                ) : typeof value === 'boolean' ? (
                                  <span className={value ? 'text-emerald-400' : 'text-gray-500'}>
                                    {String(value)}
                                  </span>
                                ) : (
                                  formatCellValue(value)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : queryResult ? (
                  <div className="p-6 text-center">
                    <CheckCircle2
                      size={24}
                      className="mx-auto mb-2 text-emerald-500"
                    />

                    <p className="text-sm text-gray-300">
                      Query executed successfully.
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      {queryResult.rowCount} row(s) affected.
                    </p>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-600">
                    Run a query to see results.
                  </div>
                )}

              </div>
            ) : (
              <div className="flex-1 overflow-auto p-4 text-xs">
                {queryError ? (
                  <div className="text-red-400 whitespace-pre-wrap">
                    <div className="mb-2 font-semibold">
                      Query execution failed
                    </div>
                    {queryError}
                  </div>
                ) : queryResult ? (
                  <div className="text-emerald-400">
                    <div className="mb-2 font-semibold">
                      Query executed successfully
                    </div>

                    <div className="text-gray-400">
                      Rows: {queryResult.rowCount}
                    </div>

                    <div className="text-gray-400">
                      Duration: {queryResult.durationMs} ms
                    </div>
                  </div>
                ) : (
                  <span className="text-gray-500">
                    Henüz sorgu çalıştırılmadı.
                  </span>
                )}
              </div>
            )}

            <div className="h-8 shrink-0 px-4 flex items-center justify-between border-t border-[#292d36] text-[10px] text-gray-500">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-emerald-500" />
                  {running ? 'Running' : 'Ready'}
                </span>
                <span>
                  {queryResult ? `${queryResult.rowCount} rows` : '0 rows'}
                </span>

                {queryResult && (
                  <span>{queryResult.durationMs} ms</span>
                )}
              </div>
              <span>UTF-8 · SQL</span>
            </div>
          </section>
        </main>
      </div>

      {/* Bottom status bar */}
      <footer className="h-7 shrink-0 flex items-center justify-between px-4 bg-[#171a21] border-t border-[#292d36] text-[10px] text-gray-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Circle size={8} className="text-emerald-500 fill-emerald-500" />
            Application Ready
          </span>
          <span>Database Studio v0.1.0</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Zap size={11} />
            Development
          </span>
          <span>Ln 1, Col 1</span>
        </div>
      </footer>

      {isConnectionDialogOpen && (
        <ConnectionDialog
          initialConfig={editingConnection ?? undefined}
          onClose={() => {
            setIsConnectionDialogOpen(false);
            setEditingConnection(null);
          }}
          onSave={
            editingConnection
              ? handleUpdateConnection
              : handleSaveConnection
          }
        />
      )}
    </div>
  );
}

export default App;
