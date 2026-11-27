import {
  Activity,
  ChevronDown,
  ChevronRight,
  Database,
  FilePlus2,
  FolderTree,
  Loader2,
  Network,
  Pencil,
  Plus,
  SquareFunction,
  RefreshCw,
  Table2,
  Trash2,
} from 'lucide-react';
import type { ConnectionProfile, DatabaseRoutine } from '@tukaka/contracts';

import type { ConnectionTestStatus } from '../hooks/useConnections';
import { schemaKey, type ExplorerState } from '../hooks/useExplorer';
import { databases } from '../lib/databases';
import { CONNECTION_DRAG_TYPE } from '../lib/dragTypes';

export interface ActiveTableRef {
  connectionId: string;
  schema: string;
  table: string;
}

export interface DatabaseExplorerProps {
  connections: ConnectionProfile[];
  explorer: ExplorerState;
  testStatuses: Record<string, ConnectionTestStatus>;
  activeConnectionId: string | null;
  activeTable: ActiveTableRef | null;
  onNewQuery: (connectionId: string) => void;
  onEdit: (connection: ConnectionProfile) => void;
  onDelete: (connection: ConnectionProfile) => void;
  onTest: (connectionId: string) => void;
  onRefresh: (connectionId: string) => void;
  onOpenTable: (
    connectionId: string,
    schema: string,
    table: string,
    type: 'table' | 'view',
  ) => void;
  onOpenErDiagram: (connectionId: string, schema: string) => void;
  onCreateTable: (connectionId: string, schema: string) => void;
  onOpenRoutine: (connectionId: string, schema: string, routine: DatabaseRoutine) => void;
}

const iconButton =
  'p-1.5 rounded text-gray-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition';

export default function DatabaseExplorer({
  connections,
  explorer,
  testStatuses,
  activeConnectionId,
  activeTable,
  onNewQuery,
  onEdit,
  onDelete,
  onTest,
  onRefresh,
  onOpenTable,
  onOpenErDiagram,
  onCreateTable,
  onOpenRoutine,
}: DatabaseExplorerProps) {
  return (
    <>
      {connections.map((connection) => {
        const expanded = explorer.expandedConnections.has(connection.id);
        const status = testStatuses[connection.id];
        const schemas = explorer.schemas[connection.id];
        const schemasLoading = explorer.loading[connection.id];
        const schemasError = explorer.errors[connection.id];

        return (
          <div key={connection.id} className="mb-1">
            {/* Connection row */}
            <div
              draggable
              onDragStart={(event) => {
                // Koleksiyonlar arasında taşımak için (bkz. ConnectionTree).
                event.dataTransfer.setData(CONNECTION_DRAG_TYPE, connection.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              className={`group flex items-center rounded-md ${
                activeConnectionId === connection.id
                  ? 'bg-(--c-252a34)'
                  : 'hover:bg-(--c-252a34)'
              }`}
            >
              <button
                type="button"
                onClick={() => explorer.toggleConnection(connection.id)}
                title={expanded ? 'Collapse' : 'Expand database objects'}
                className="p-1.5 ml-1 rounded text-gray-500 hover:text-gray-200"
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              <button
                type="button"
                onClick={() => explorer.toggleConnection(connection.id)}
                onDoubleClick={() => onNewQuery(connection.id)}
                className="flex-1 min-w-0 flex items-center gap-2 px-1 py-2 text-left"
              >
                <Database size={15} className={databases[connection.type]?.color ?? 'text-gray-400'} />

                <div className="flex-1 min-w-0">
                  <span className="block text-xs text-gray-300 truncate">
                    {connection.name}
                  </span>

                  {status?.message && (
                    <span
                      className={`block mt-1 text-[10px] truncate ${
                        status.success ? 'text-emerald-400' : 'text-red-400'
                      }`}
                      title={status.message}
                    >
                      {status.message}
                    </span>
                  )}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNewQuery(connection.id)}
                title="New query"
                className={`${iconButton} hover:text-emerald-400`}
              >
                <FilePlus2 size={13} />
              </button>

              <button
                type="button"
                onClick={() => onEdit(connection)}
                title="Edit connection"
                className={`${iconButton} hover:text-blue-400`}
              >
                <Pencil size={13} />
              </button>

              <button
                type="button"
                onClick={() => onDelete(connection)}
                title="Delete connection"
                className={`${iconButton} hover:text-red-400`}
              >
                <Trash2 size={13} />
              </button>

              <button
                type="button"
                onClick={() => onTest(connection.id)}
                disabled={status?.loading}
                title={status?.loading ? 'Testing connection...' : 'Test connection'}
                className="p-1.5 mr-1 rounded-md text-gray-400 hover:text-blue-400 hover:bg-white/5 disabled:opacity-50"
              >
                {status?.loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Activity size={14} />
                )}
              </button>
            </div>

            {/* Database objects */}
            {expanded && (
              <div className="ml-4 pl-2 border-l border-(--c-303541)">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-[9px] font-semibold tracking-wider text-gray-500">
                    DATABASE OBJECTS
                  </span>
                  <button
                    type="button"
                    onClick={() => onRefresh(connection.id)}
                    title="Refresh database objects"
                    className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-white/5"
                  >
                    <RefreshCw
                      size={12}
                      className={schemasLoading ? 'animate-spin' : ''}
                    />
                  </button>
                </div>

                {schemasLoading && !schemas && (
                  <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-gray-500">
                    <Loader2 size={12} className="animate-spin" />
                    Loading schemas...
                  </div>
                )}

                {schemasError && (
                  <div className="px-2 py-2">
                    <p className="text-[10px] text-red-400 break-words">
                      {schemasError}
                    </p>
                    <button
                      type="button"
                      onClick={() => void explorer.loadSchemas(connection.id, true)}
                      className="mt-1 text-[10px] text-blue-400 hover:text-blue-300"
                    >
                      Try again
                    </button>
                  </div>
                )}

                {!schemasLoading && !schemasError && schemas?.length === 0 && (
                  <p className="px-2 py-2 text-[10px] text-gray-600">
                    No schemas found
                  </p>
                )}

                {schemas?.map((schema) => {
                  const key = schemaKey(connection.id, schema.name);
                  const schemaExpanded = explorer.expandedSchemas.has(key);
                  const tables = explorer.tables[key];
                  const routines = explorer.routines[key];
                  const supportsRoutines = databases[connection.type]?.supports.routines ?? false;

                  return (
                    <div key={key}>
                      <div className="group/schema flex items-center rounded hover:bg-white/5">
                      <button
                        type="button"
                        onClick={() =>
                          explorer.toggleSchema(connection.id, schema.name, supportsRoutines)
                        }
                        className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left text-gray-400 hover:text-gray-200"
                      >
                        {schemaExpanded ? (
                          <ChevronDown size={12} />
                        ) : (
                          <ChevronRight size={12} />
                        )}
                        <FolderTree size={13} className="text-amber-400" />
                        <span className="text-[11px] truncate">{schema.name}</span>
                        {tables && (
                          <span className="ml-auto text-[9px] text-gray-600 group-hover/schema:hidden">
                            {tables.length}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        title="New table…"
                        onClick={() => onCreateTable(connection.id, schema.name)}
                        className="p-1 text-gray-500 opacity-0 transition hover:text-emerald-400 focus:opacity-100 group-hover/schema:opacity-100"
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type="button"
                        title="ER diagram"
                        onClick={() => onOpenErDiagram(connection.id, schema.name)}
                        className="p-1 mr-1 text-gray-500 opacity-0 transition hover:text-blue-400 focus:opacity-100 group-hover/schema:opacity-100"
                      >
                        <Network size={12} />
                      </button>
                      </div>

                      {schemaExpanded && (
                        <div className="ml-4 pl-2 border-l border-(--c-303541)">
                          {explorer.loading[key] && !tables && (
                            <div className="flex items-center gap-2 px-2 py-2 text-[10px] text-gray-500">
                              <Loader2 size={11} className="animate-spin" />
                              Loading tables...
                            </div>
                          )}

                          {explorer.errors[key] && (
                            <div className="px-2 py-2">
                              <p className="text-[10px] text-red-400 break-words">
                                {explorer.errors[key]}
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  void explorer.loadTables(connection.id, schema.name, true)
                                }
                                className="mt-1 text-[10px] text-blue-400 hover:text-blue-300"
                              >
                                Try again
                              </button>
                            </div>
                          )}

                          {!explorer.loading[key] &&
                            !explorer.errors[key] &&
                            tables?.length === 0 && (
                              <p className="px-2 py-2 text-[10px] text-gray-600">
                                No tables or views
                              </p>
                            )}

                          {tables?.map((table) => {
                            const isActive =
                              activeTable?.connectionId === connection.id &&
                              activeTable.schema === schema.name &&
                              activeTable.table === table.name;

                            return (
                              <button
                                type="button"
                                key={`${key}:${table.name}`}
                                onClick={() =>
                                  onOpenTable(connection.id, schema.name, table.name, table.type)
                                }
                                title={`${table.type}: ${table.name}`}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left ${
                                  isActive
                                    ? 'bg-(--c-252a34) text-white'
                                    : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
                                }`}
                              >
                                <Table2
                                  size={12}
                                  className={
                                    table.type === 'view' ? 'text-purple-400' : 'text-sky-400'
                                  }
                                />
                                <span className="text-[11px] truncate">{table.name}</span>
                                {table.type === 'view' && (
                                  <span className="ml-auto text-[8px] text-gray-600">VIEW</span>
                                )}
                              </button>
                            );
                          })}

                          {routines && routines.length > 0 && (
                            <>
                              <div className="px-2 pb-1 pt-2 text-[9px] font-semibold tracking-wider text-gray-600">
                                ROUTINES
                              </div>
                              {routines.map((routine) => (
                                <button
                                  type="button"
                                  key={`${key}:routine:${routine.id}`}
                                  onClick={() => onOpenRoutine(connection.id, schema.name, routine)}
                                  title={`${routine.type}: ${routine.name}(${routine.arguments ?? ''})${
                                    routine.returnType ? ` → ${routine.returnType}` : ''
                                  }`}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-gray-500 hover:text-gray-200 hover:bg-white/5"
                                >
                                  <SquareFunction
                                    size={12}
                                    className={routine.type === 'procedure' ? 'text-pink-400' : 'text-emerald-400'}
                                  />
                                  <span className="text-[11px] truncate">{routine.name}</span>
                                  {routine.arguments !== null && (
                                    <span className="truncate text-[10px] text-gray-600">
                                      ({routine.arguments})
                                    </span>
                                  )}
                                </button>
                              ))}
                            </>
                          )}
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
    </>
  );
}
