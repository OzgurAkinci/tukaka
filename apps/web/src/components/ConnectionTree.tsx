import { useCallback, useState, type DragEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ConnectionCollection, ConnectionProfile } from '@tukaka/contracts';

import DatabaseExplorer, { type DatabaseExplorerProps } from './DatabaseExplorer';
import { COLLECTION_DRAG_TYPE, CONNECTION_DRAG_TYPE } from '../lib/dragTypes';
import type { MenuEntry } from '../lib/menu';
import { readStorage, writeStorage } from '../lib/storage';
import ContextMenu from './ContextMenu';

const COLLAPSED_KEY = 'tukaka.collapsedCollections';
const UNGROUPED = 'ungrouped';

interface ConnectionTreeProps
  extends Omit<DatabaseExplorerProps, 'connections'> {
  collections: ConnectionCollection[];
  /** Aramaya göre süzülmüş bağlantılar. */
  connections: ConnectionProfile[];
  /** Arama varken boş koleksiyonlar gizlenir, hepsi açık gösterilir. */
  searching: boolean;
  onAddConnection: (collectionId: string | null) => void;
  onEditCollection: (collection: ConnectionCollection) => void;
  onDeleteCollection: (collection: ConnectionCollection) => void;
  onMoveConnection: (connectionId: string, collectionId: string | null) => void;
  onReorderCollections: (orderedIds: string[]) => void;
  /** Yeni koleksiyon oluşturup bağlantıyı içine taşır. */
  onNewCollectionFor: (connectionId: string) => void;
}

const hasType = (event: DragEvent, type: string) =>
  event.dataTransfer.types.includes(type);

const headerAction =
  'p-1 rounded text-gray-500 opacity-0 transition group-hover/collection:opacity-100 focus:opacity-100';

/**
 * Bağlantıları koleksiyonlara göre gruplar. Bağlantılar sürüklenerek
 * koleksiyonlar arasında taşınır; koleksiyon başlıkları sürüklenerek sıralanır.
 */
export default function ConnectionTree({
  collections,
  connections,
  searching,
  onAddConnection,
  onEditCollection,
  onDeleteCollection,
  onMoveConnection,
  onReorderCollections,
  onNewCollectionFor,
  ...props
}: ConnectionTreeProps) {
  const explorerProps = { ...props, collections, onMoveConnection, onNewCollectionFor };
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(
    null,
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(readStorage<string[]>(COLLAPSED_KEY, [])),
  );
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStorage(COLLAPSED_KEY, [...next]);
      return next;
    });

  // Koleksiyonu kalmamış (silinmiş) bağlantılar gruplanmamış sayılır.
  const knownIds = new Set(collections.map((collection) => collection.id));
  const byCollection = new Map<string, ConnectionProfile[]>();

  for (const connection of connections) {
    const key =
      connection.collection_id && knownIds.has(connection.collection_id)
        ? connection.collection_id
        : UNGROUPED;
    byCollection.set(key, [...(byCollection.get(key) ?? []), connection]);
  }

  const ungrouped = byCollection.get(UNGROUPED) ?? [];

  // Koleksiyon yoksa eski düz liste görünümü.
  if (collections.length === 0) {
    return <DatabaseExplorer connections={ungrouped} {...explorerProps} />;
  }

  /** Bir koleksiyona (ya da gruplanmamışa) bırakma hedefi davranışı. */
  const dropProps = (target: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!hasType(event, CONNECTION_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropTarget((current) => (current === target ? null : current));
      }
    },
    onDrop: (event: DragEvent) => {
      const connectionId = event.dataTransfer.getData(CONNECTION_DRAG_TYPE);
      setDropTarget(null);
      if (!connectionId) return;
      event.preventDefault();

      const collectionId = target === UNGROUPED ? null : target;
      const connection = connections.find((item) => item.id === connectionId);

      if (connection && (connection.collection_id ?? null) !== collectionId) {
        onMoveConnection(connectionId, collectionId);
      }
    },
  });

  const reorderBefore = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    const ids = collections.map((collection) => collection.id).filter((id) => id !== draggedId);
    ids.splice(ids.indexOf(targetId), 0, draggedId);
    onReorderCollections(ids);
  };

  const collectionMenu = (collection: ConnectionCollection, open: boolean): MenuEntry[] => {
    const index = collections.findIndex((item) => item.id === collection.id);
    const move = (offset: number) => {
      const ids = collections.map((item) => item.id);
      const [id] = ids.splice(index, 1);
      ids.splice(index + offset, 0, id);
      onReorderCollections(ids);
    };

    return [
      { label: 'New Connection Here…', onSelect: () => onAddConnection(collection.id) },
      { separator: true },
      {
        label: open ? 'Collapse' : 'Expand',
        disabled: searching,
        onSelect: () => toggle(collection.id),
      },
      { label: 'Move Up', disabled: index <= 0, onSelect: () => move(-1) },
      {
        label: 'Move Down',
        disabled: index < 0 || index >= collections.length - 1,
        onSelect: () => move(1),
      },
      { separator: true },
      { label: 'Edit Collection…', onSelect: () => onEditCollection(collection) },
      { label: 'Delete Collection…', onSelect: () => onDeleteCollection(collection) },
    ];
  };

  const visibleCollections = searching
    ? collections.filter((collection) => byCollection.has(collection.id))
    : collections;

  return (
    <div className="space-y-1">
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      {visibleCollections.map((collection) => {
        const items = byCollection.get(collection.id) ?? [];
        const open = searching || !collapsed.has(collection.id);
        const isTarget = dropTarget === collection.id;
        const FolderIcon = open ? FolderOpen : Folder;

        return (
          <section
            key={collection.id}
            aria-label={collection.name}
            {...dropProps(collection.id)}
            className={`rounded-md transition-colors ${
              isTarget ? 'bg-blue-500/10 ring-1 ring-blue-500/40' : ''
            }`}
          >
            <div
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(COLLECTION_DRAG_TYPE, collection.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (hasType(event, COLLECTION_DRAG_TYPE)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => {
                const draggedId = event.dataTransfer.getData(COLLECTION_DRAG_TYPE);
                if (!draggedId) return;
                event.preventDefault();
                event.stopPropagation();
                reorderBefore(draggedId, collection.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  x: event.clientX,
                  y: event.clientY,
                  items: collectionMenu(collection, open),
                });
              }}
              className="group/collection flex items-center rounded-md hover:bg-(--c-252a34)"
            >
              <button
                type="button"
                onClick={() => toggle(collection.id)}
                aria-expanded={open}
                title={open ? 'Collapse collection' : 'Expand collection'}
                className="flex-1 min-w-0 flex items-center gap-1.5 pl-1.5 pr-1 py-1.5 text-left"
              >
                {open ? (
                  <ChevronDown size={13} className="shrink-0 text-gray-500" />
                ) : (
                  <ChevronRight size={13} className="shrink-0 text-gray-500" />
                )}
                <FolderIcon
                  size={14}
                  className="shrink-0"
                  style={{ color: collection.color ?? 'var(--c-858d9b)' }}
                />
                <span className="truncate text-[11.5px] font-semibold text-gray-300">
                  {collection.name}
                </span>
                <span className="ml-1 shrink-0 rounded bg-(--c-292e39) px-1.5 text-[9.5px] leading-4 text-gray-500">
                  {items.length}
                </span>
              </button>

              <button
                type="button"
                title="New connection in this collection"
                onClick={() => onAddConnection(collection.id)}
                className={`${headerAction} hover:text-emerald-400`}
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                title="Edit collection"
                onClick={() => onEditCollection(collection)}
                className={`${headerAction} hover:text-blue-400`}
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                title="Delete collection"
                onClick={() => onDeleteCollection(collection)}
                className={`${headerAction} mr-1 hover:text-red-400`}
              >
                <Trash2 size={12} />
              </button>
            </div>

            {open && (
              <div className="ml-3 pl-1 border-l border-(--c-2b303b)">
                {items.length > 0 ? (
                  <DatabaseExplorer connections={items} {...explorerProps} />
                ) : (
                  <p className="px-2 py-2 text-[10.5px] text-gray-600">
                    Drag connections here
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}

      {(ungrouped.length > 0 || !searching) && (
        <section
          aria-label="Ungrouped connections"
          {...dropProps(UNGROUPED)}
          className={`rounded-md pt-1 transition-colors ${
            dropTarget === UNGROUPED ? 'bg-blue-500/10 ring-1 ring-blue-500/40' : ''
          }`}
        >
          <div className="px-2 py-1 text-[9.5px] font-semibold uppercase tracking-wider text-gray-600">
            Ungrouped
          </div>
          {ungrouped.length > 0 ? (
            <DatabaseExplorer connections={ungrouped} {...explorerProps} />
          ) : (
            <p className="px-2 pb-2 text-[10.5px] text-gray-600">
              Drop a connection here to remove it from its collection
            </p>
          )}
        </section>
      )}
    </div>
  );
}
