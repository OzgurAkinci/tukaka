import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExecuteQueryResponse,
  ExplainResponse,
  SavedQuery,
} from '@tukaka/contracts';

import { errorMessage } from '../api/client';
import { connectionsApi } from '../api/connections';
import { queriesApi } from '../api/queries';
import { readStorage, writeStorage } from '../lib/storage';
import type { AppSettings } from './useSettings';

export type ResultPanel = 'results' | 'messages' | 'plan';

export interface QueryTab {
  kind: 'query';
  id: string;
  title: string;
  connectionId: string | null;
  sql: string;
  /** Kayıtlı sorgudan açıldıysa ya da kaydedildiyse kimliği. */
  savedQueryId: string | null;
  /** Kaydedilmiş SQL; `sql` farklıysa sekme "değişmiş" sayılır. */
  savedSql: string | null;
  running: boolean;
  queryId: string | null;
  /** Son çalıştırılan SQL (Refresh için). */
  lastRunSql: string | null;
  result: ExecuteQueryResponse | null;
  error: string | null;
  notice: string | null;
  panel: ResultPanel;
  explaining: boolean;
  plan: ExplainResponse | null;
  planError: string | null;
}

export interface TableTab {
  kind: 'table';
  id: string;
  connectionId: string;
  schema: string;
  table: string;
  tableType: 'table' | 'view';
  view: 'structure' | 'data' | 'ddl';
}

export interface ErTab {
  kind: 'er';
  id: string;
  connectionId: string;
  schema: string;
}

export type WorkspaceTab = QueryTab | TableTab | ErTab;

const STORAGE_KEY = 'tukaka.workspace';

type PersistedTab =
  | Pick<
      QueryTab,
      'kind' | 'id' | 'title' | 'connectionId' | 'sql' | 'savedQueryId' | 'savedSql'
    >
  | Pick<
      TableTab,
      'kind' | 'id' | 'connectionId' | 'schema' | 'table' | 'tableType' | 'view'
    >
  | ErTab;

interface PersistedWorkspace {
  tabs: PersistedTab[];
  activeTabId: string | null;
}

const newId = () => crypto.randomUUID();

function createQueryTab(
  init: Partial<QueryTab> & { title: string },
): QueryTab {
  return {
    kind: 'query',
    id: newId(),
    connectionId: null,
    sql: '',
    savedQueryId: null,
    savedSql: null,
    running: false,
    queryId: null,
    lastRunSql: null,
    result: null,
    error: null,
    notice: null,
    panel: 'results',
    explaining: false,
    plan: null,
    planError: null,
    ...init,
  };
}

function restore(): { tabs: WorkspaceTab[]; activeTabId: string | null } {
  const stored = readStorage<PersistedWorkspace | null>(STORAGE_KEY, null);

  const tabs: WorkspaceTab[] = (stored?.tabs ?? []).flatMap(
    (tab): WorkspaceTab[] => {
      if (tab?.kind === 'query') {
        return [createQueryTab({ ...tab })];
      }

      if (tab?.kind === 'table' || tab?.kind === 'er') {
        return [{ ...tab }];
      }

      return [];
    },
  );

  if (tabs.length === 0) {
    const first = createQueryTab({
      title: 'query-1.sql',
      sql: 'SELECT 1;',
    });

    return { tabs: [first], activeTabId: first.id };
  }

  const activeTabId = tabs.some((tab) => tab.id === stored?.activeTabId)
    ? (stored?.activeTabId ?? null)
    : tabs[0].id;

  return { tabs, activeTabId };
}

function persist(tabs: WorkspaceTab[], activeTabId: string | null) {
  const data: PersistedWorkspace = {
    activeTabId,
    tabs: tabs.map((tab): PersistedTab =>
      tab.kind === 'er'
        ? { ...tab }
        : tab.kind === 'query'
        ? {
            kind: 'query',
            id: tab.id,
            title: tab.title,
            connectionId: tab.connectionId,
            sql: tab.sql,
            savedQueryId: tab.savedQueryId,
            savedSql: tab.savedSql,
          }
        : {
            kind: 'table',
            id: tab.id,
            connectionId: tab.connectionId,
            schema: tab.schema,
            table: tab.table,
            tableType: tab.tableType,
            view: tab.view,
          },
    ),
  };

  writeStorage(STORAGE_KEY, data);
}

function nextQueryTitle(tabs: WorkspaceTab[]): string {
  const used = new Set(
    tabs.filter((tab) => tab.kind === 'query').map((tab) => tab.title),
  );

  for (let index = 1; ; index++) {
    const title = `query-${index}.sql`;
    if (!used.has(title)) return title;
  }
}

export function isDirty(tab: QueryTab): boolean {
  return tab.savedQueryId !== null && tab.sql !== tab.savedSql;
}

/**
 * Çalışma alanındaki sorgu ve tablo sekmelerini yönetir.
 */
export function useWorkspaceTabs(settings: AppSettings) {
  const [initial] = useState(restore);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(initial.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(
    initial.activeTabId,
  );

  // Asenkron işlemlerde güncel sekmeye erişmek için.
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    persist(tabs, activeTabId);
  }, [tabs, activeTabId]);

  const updateTab = useCallback(
    <T extends WorkspaceTab>(id: string, patch: Partial<T>) => {
      setTabs((previous) =>
        previous.map((tab) =>
          tab.id === id ? ({ ...tab, ...patch } as WorkspaceTab) : tab,
        ),
      );
    },
    [],
  );

  const updateQueryTab = useCallback(
    (id: string, patch: Partial<QueryTab>) => updateTab<QueryTab>(id, patch),
    [updateTab],
  );

  const openQueryTab = useCallback(
    (init: Partial<Omit<QueryTab, 'kind' | 'id'>> = {}) => {
      const tab = createQueryTab({
        title: init.title ?? nextQueryTitle(tabsRef.current),
        ...init,
      });

      setTabs((previous) => [...previous, tab]);
      setActiveTabId(tab.id);

      return tab.id;
    },
    [],
  );

  const openSavedQuery = useCallback(
    (saved: SavedQuery) => {
      const existing = tabsRef.current.find(
        (tab) => tab.kind === 'query' && tab.savedQueryId === saved.id,
      );

      if (existing) {
        setActiveTabId(existing.id);
        return;
      }

      openQueryTab({
        title: saved.name,
        sql: saved.sql,
        connectionId: saved.connectionId,
        savedQueryId: saved.id,
        savedSql: saved.sql,
      });
    },
    [openQueryTab],
  );

  const openTableTab = useCallback(
    (
      connectionId: string,
      schema: string,
      table: string,
      tableType: 'table' | 'view',
      view: TableTab['view'] = 'data',
    ) => {
      const existing = tabsRef.current.find(
        (tab) =>
          tab.kind === 'table' &&
          tab.connectionId === connectionId &&
          tab.schema === schema &&
          tab.table === table,
      );

      if (existing) {
        setActiveTabId(existing.id);
        return;
      }

      const tab: TableTab = {
        kind: 'table',
        id: newId(),
        connectionId,
        schema,
        table,
        tableType,
        view,
      };

      setTabs((previous) => [...previous, tab]);
      setActiveTabId(tab.id);
    },
    [],
  );

  const openErTab = useCallback((connectionId: string, schema: string) => {
    const existing = tabsRef.current.find(
      (tab) =>
        tab.kind === 'er' && tab.connectionId === connectionId && tab.schema === schema,
    );

    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    const tab: ErTab = { kind: 'er', id: newId(), connectionId, schema };

    setTabs((previous) => [...previous, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    const current = tabsRef.current;
    const index = current.findIndex((tab) => tab.id === id);

    if (index === -1) return;

    const closing = current[index];

    if (closing.kind === 'query' && closing.running && closing.queryId) {
      void queriesApi.cancel(closing.queryId).catch(() => undefined);
    }

    let remaining = current.filter((tab) => tab.id !== id);

    // Her zaman en az bir sorgu sekmesi açık kalsın.
    if (remaining.length === 0) {
      remaining = [createQueryTab({ title: 'query-1.sql' })];
    }

    setTabs(remaining);
    setActiveTabId((active) =>
      active === id
        ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
        : active,
    );
  }, []);

  const runQuery = useCallback(
    async (tabId: string, sqlOverride?: string) => {
      const tab = tabsRef.current.find(
        (item): item is QueryTab => item.id === tabId && item.kind === 'query',
      );

      if (!tab || tab.running) return;

      const sql = (sqlOverride ?? tab.sql).trim();

      if (!tab.connectionId) {
        updateQueryTab(tabId, {
          error: 'Please select a database connection.',
          result: null,
          notice: null,
          panel: 'messages',
        });
        return;
      }

      if (!sql) {
        updateQueryTab(tabId, {
          error: 'SQL query cannot be empty.',
          result: null,
          notice: null,
          panel: 'messages',
        });
        return;
      }

      const queryId = newId();

      updateQueryTab(tabId, {
        running: true,
        queryId,
        lastRunSql: sql,
        error: null,
        notice: null,
      });

      try {
        const result = await connectionsApi.executeQuery(tab.connectionId, {
          sql,
          queryId,
          maxRows: settings.maxRows,
          timeoutMs: settings.timeoutSeconds * 1000,
        });

        updateQueryTab(tabId, {
          result,
          error: null,
          panel: result.columns.length > 0 ? 'results' : 'messages',
        });
      } catch (error) {
        updateQueryTab(tabId, {
          result: null,
          error: errorMessage(error, 'Query execution failed.'),
          panel: 'messages',
        });
      } finally {
        updateQueryTab(tabId, { running: false, queryId: null });
      }
    },
    [settings.maxRows, settings.timeoutSeconds, updateQueryTab],
  );

  /** Sorgunun tahmini planını getirir (sorgu çalıştırılmaz). */
  const explainQuery = useCallback(
    async (tabId: string, sqlOverride?: string) => {
      const tab = tabsRef.current.find(
        (item): item is QueryTab => item.id === tabId && item.kind === 'query',
      );

      if (!tab || tab.explaining) return;

      const sql = (sqlOverride ?? tab.sql).trim();

      if (!tab.connectionId || !sql) {
        updateQueryTab(tabId, {
          panel: 'plan',
          plan: null,
          planError: !tab.connectionId
            ? 'Please select a database connection.'
            : 'SQL query cannot be empty.',
        });
        return;
      }

      updateQueryTab(tabId, { explaining: true, panel: 'plan', planError: null });

      try {
        const plan = await connectionsApi.explain(tab.connectionId, sql);
        updateQueryTab(tabId, { plan, planError: null });
      } catch (error) {
        updateQueryTab(tabId, {
          plan: null,
          planError: errorMessage(error, 'Query plan could not be loaded.'),
        });
      } finally {
        updateQueryTab(tabId, { explaining: false });
      }
    },
    [updateQueryTab],
  );

  const cancelQuery = useCallback(
    async (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId);

      if (tab?.kind !== 'query' || !tab.queryId) return;

      try {
        const response = await queriesApi.cancel(tab.queryId);

        if (!response.cancelled) {
          updateQueryTab(tabId, { notice: response.message });
        }
      } catch (error) {
        updateQueryTab(tabId, {
          notice: errorMessage(error, 'Query could not be cancelled.'),
        });
      }
    },
    [updateQueryTab],
  );

  /** Silinen bağlantının tablo sekmelerini kapatır, sorgu sekmelerini ayırır. */
  const handleConnectionRemoved = useCallback((connectionId: string) => {
    setTabs((previous) => {
      const remaining = previous
        .filter(
          (tab) => !(tab.kind !== 'query' && tab.connectionId === connectionId),
        )
        .map((tab) =>
          tab.kind === 'query' && tab.connectionId === connectionId
            ? { ...tab, connectionId: null }
            : tab,
        );

      return remaining.length > 0
        ? remaining
        : [createQueryTab({ title: 'query-1.sql' })];
    });

    setActiveTabId((active) =>
      tabsRef.current.some(
        (tab) =>
          tab.id === active &&
          tab.kind !== 'query' &&
          tab.connectionId === connectionId,
      )
        ? null
        : active,
    );
  }, []);

  // Aktif sekme kapandıysa ilk sekmeyi seç.
  const resolvedActiveId =
    tabs.find((tab) => tab.id === activeTabId)?.id ?? tabs[0]?.id ?? null;

  return {
    tabs,
    activeTabId: resolvedActiveId,
    setActiveTabId,
    updateTab,
    updateQueryTab,
    openQueryTab,
    openSavedQuery,
    openTableTab,
    openErTab,
    closeTab,
    runQuery,
    explainQuery,
    cancelQuery,
    handleConnectionRemoved,
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspaceTabs>;
