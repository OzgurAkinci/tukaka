import { FileCode2, Loader2, Network, Plus, Table2, X } from 'lucide-react';

import { isDirty, type WorkspaceTab } from '../hooks/useWorkspaceTabs';

interface TabsBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewQuery: () => void;
}

function tabLabel(tab: WorkspaceTab) {
  if (tab.kind === 'query') return tab.title;
  if (tab.kind === 'er') return `ER · ${tab.schema}`;
  return tab.table;
}

export default function TabsBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewQuery,
}: TabsBarProps) {
  return (
    <div className="h-11 shrink-0 flex items-center border-b border-(--c-292d36) bg-(--c-171a21)">
      <div role="tablist" className="flex h-full min-w-0 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(tab.id);
              }}
              onMouseDown={(event) => {
                // Orta tık ile kapat.
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              title={
                tab.kind === 'table'
                  ? `${tab.schema}.${tab.table}`
                  : tab.kind === 'er'
                    ? `ER diagram: ${tab.schema}`
                    : tab.title
              }
              className={`group h-full shrink-0 px-4 flex items-center gap-2 border-r border-(--c-292d36) text-xs cursor-pointer select-none ${
                active
                  ? 'bg-(--c-111318) text-white border-t-2 border-t-blue-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.kind === 'query' ? (
                tab.running ? (
                  <Loader2 size={14} className="animate-spin text-blue-400" />
                ) : (
                  <FileCode2
                    size={14}
                    className={active ? 'text-blue-400' : 'text-gray-500'}
                  />
                )
              ) : tab.kind === 'er' ? (
                <Network size={14} className="text-emerald-400" />
              ) : (
                <Table2
                  size={14}
                  className={tab.tableType === 'view' ? 'text-purple-400' : 'text-sky-400'}
                />
              )}

              <span className="max-w-[180px] truncate">{tabLabel(tab)}</span>

              {tab.kind === 'query' && isDirty(tab) && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
              )}

              <button
                type="button"
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                className="ml-1 rounded p-0.5 text-gray-600 hover:bg-(--c-292e39) hover:text-white"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onNewQuery}
        title="New query tab"
        className="p-2 ml-1 shrink-0 text-gray-500 hover:text-white"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
