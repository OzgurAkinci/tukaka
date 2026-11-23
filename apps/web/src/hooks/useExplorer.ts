import { useCallback, useState } from 'react';
import type {
  DatabaseRoutine,
  DatabaseSchema,
  DatabaseTable,
} from '@tukaka/contracts';

import { errorMessage } from '../api/client';
import { connectionsApi } from '../api/connections';

export const schemaKey = (connectionId: string, schema: string) =>
  `${connectionId}::${schema}`;

/**
 * Sol paneldeki bağlantı → şema → tablo ağacının durumunu yönetir.
 */
export function useExplorer() {
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(
    new Set(),
  );
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    new Set(),
  );
  const [schemas, setSchemas] = useState<Record<string, DatabaseSchema[]>>({});
  const [tables, setTables] = useState<Record<string, DatabaseTable[]>>({});
  const [routines, setRoutines] = useState<Record<string, DatabaseRoutine[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setFlag = (key: string, value: boolean) =>
    setLoading((previous) => ({ ...previous, [key]: value }));

  const setErrorFor = (key: string, value: string) =>
    setErrors((previous) => ({ ...previous, [key]: value }));

  const loadSchemas = useCallback(
    async (connectionId: string, force = false) => {
      if (!force && schemas[connectionId]) return;

      setFlag(connectionId, true);
      setErrorFor(connectionId, '');

      try {
        const response = await connectionsApi.getSchemas(connectionId);
        setSchemas((previous) => ({
          ...previous,
          [connectionId]: response.schemas,
        }));
      } catch (error) {
        setErrorFor(connectionId, errorMessage(error, 'Schemas could not be loaded.'));
      } finally {
        setFlag(connectionId, false);
      }
    },
    [schemas],
  );

  const loadTables = useCallback(
    async (connectionId: string, schema: string, force = false) => {
      const key = schemaKey(connectionId, schema);

      if (!force && tables[key]) return;

      setFlag(key, true);
      setErrorFor(key, '');

      try {
        const response = await connectionsApi.getTables(connectionId, schema);
        setTables((previous) => ({ ...previous, [key]: response.tables }));
      } catch (error) {
        setErrorFor(key, errorMessage(error, 'Tables could not be loaded.'));
      } finally {
        setFlag(key, false);
      }
    },
    [tables],
  );

  /** Fonksiyon/prosedür listesi; hata olursa sessizce boş kalır (yetki vb.). */
  const loadRoutines = useCallback(
    async (connectionId: string, schema: string, force = false) => {
      const key = schemaKey(connectionId, schema);

      if (!force && routines[key]) return;

      try {
        const response = await connectionsApi.getRoutines(connectionId, schema);
        setRoutines((previous) => ({ ...previous, [key]: response.routines }));
      } catch {
        setRoutines((previous) => ({ ...previous, [key]: [] }));
      }
    },
    [routines],
  );

  const toggleConnection = useCallback(
    (connectionId: string) => {
      const expanding = !expandedConnections.has(connectionId);

      setExpandedConnections((previous) => {
        const next = new Set(previous);
        if (expanding) next.add(connectionId);
        else next.delete(connectionId);
        return next;
      });

      if (expanding) void loadSchemas(connectionId);
    },
    [expandedConnections, loadSchemas],
  );

  const toggleSchema = useCallback(
    (connectionId: string, schema: string, withRoutines = false) => {
      const key = schemaKey(connectionId, schema);
      const expanding = !expandedSchemas.has(key);

      setExpandedSchemas((previous) => {
        const next = new Set(previous);
        if (expanding) next.add(key);
        else next.delete(key);
        return next;
      });

      if (expanding) {
        void loadTables(connectionId, schema);
        if (withRoutines) void loadRoutines(connectionId, schema);
      }
    },
    [expandedSchemas, loadTables, loadRoutines],
  );

  const refreshConnection = useCallback(
    async (connectionId: string) => {
      const prefix = `${connectionId}::`;

      const keep = <T,>(previous: Record<string, T>) =>
        Object.fromEntries(
          Object.entries(previous).filter(([key]) => !key.startsWith(prefix)),
        );

      setTables(keep);
      setRoutines(keep);

      await loadSchemas(connectionId, true);

      // Açık şemaların tablolarını da yeniden yükle.
      await Promise.all(
        [...expandedSchemas]
          .filter((key) => key.startsWith(prefix))
          .flatMap((key) => [
            loadTables(connectionId, key.slice(prefix.length), true),
            loadRoutines(connectionId, key.slice(prefix.length), true),
          ]),
      );
    },
    [expandedSchemas, loadSchemas, loadTables, loadRoutines],
  );

  return {
    expandedConnections,
    expandedSchemas,
    schemas,
    tables,
    routines,
    loading,
    errors,
    loadSchemas,
    loadTables,
    toggleConnection,
    toggleSchema,
    refreshConnection,
  };
}

export type ExplorerState = ReturnType<typeof useExplorer>;
