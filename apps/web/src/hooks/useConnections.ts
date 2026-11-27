import { useCallback, useEffect, useState } from 'react';
import type {
  ConnectionCollection,
  ConnectionProfile,
  CreateCollectionPayload,
  UpdateCollectionPayload,
} from '@tukaka/contracts';

import { errorMessage } from '../api/client';
import { collectionsApi } from '../api/collections';
import { connectionsApi } from '../api/connections';
import type { ConnectionConfig } from '../components/ConnectionDialog';
import { databases } from '../lib/databases';

/** Bağlantı ayarlarından API alanlarını üretir (sunucu tabanlı tipler için). */
function serverFields(config: ConnectionConfig) {
  if (!databases[config.type].server) return {};

  return {
    host: config.host,
    port: config.port,
    username: config.username,
    sslMode: config.sslMode,
    options: { ssh: config.ssh },
  };
}

function credentialPayload(config: ConnectionConfig) {
  const payload = {
    ...(config.password && { password: config.password }),
    ...(config.sshSecret && { sshSecret: config.sshSecret }),
  };

  return Object.keys(payload).length > 0 ? payload : null;
}

export interface ConnectionTestStatus {
  loading: boolean;
  success?: boolean;
  message?: string;
}

export function useConnections() {
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [collections, setCollections] = useState<ConnectionCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testStatuses, setTestStatuses] = useState<
    Record<string, ConnectionTestStatus>
  >({});

  useEffect(() => {
    let cancelled = false;

    Promise.all([connectionsApi.findAll(), collectionsApi.findAll()])
      .then(([connectionList, collectionList]) => {
        if (cancelled) return;
        setConnections(connectionList);
        setCollections(collectionList);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(errorMessage(loadError, 'Bağlantılar yüklenemedi.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const createConnection = useCallback(async (config: ConnectionConfig) => {
    setError(null);

    const saved = await connectionsApi.create({
      name: config.name,
      type: config.type,
      database: config.database,
      collectionId: config.collectionId ?? null,
      ...serverFields(config),
    });

    const credential = credentialPayload(config);

    if (credential) {
      try {
        await connectionsApi.setCredential(saved.id, credential);
      } catch (credentialError) {
        await connectionsApi.remove(saved.id);
        throw credentialError;
      }
    }

    setConnections((previous) =>
      [...previous, saved].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    );

    return saved;
  }, []);

  const updateConnection = useCallback(
    async (id: string, config: ConnectionConfig) => {
      setError(null);

      const updated = await connectionsApi.update(id, {
        name: config.name,
        database: config.database,
        ...(config.collectionId !== undefined && { collectionId: config.collectionId }),
        ...serverFields(config),
      });

      const credential = credentialPayload(config);

      if (credential) {
        await connectionsApi.setCredential(id, credential);
      }

      setConnections((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );

      return updated;
    },
    [],
  );

  const removeConnection = useCallback(async (id: string) => {
    setError(null);
    await connectionsApi.remove(id);
    setConnections((previous) => previous.filter((item) => item.id !== id));
  }, []);

  // ---------------------------------------------------------------------------
  // Koleksiyonlar
  // ---------------------------------------------------------------------------

  const createCollection = useCallback(async (payload: CreateCollectionPayload) => {
    setError(null);
    const created = await collectionsApi.create(payload);
    setCollections((previous) => [...previous, created]);
    return created;
  }, []);

  const updateCollection = useCallback(
    async (id: string, payload: UpdateCollectionPayload) => {
      setError(null);
      const updated = await collectionsApi.update(id, payload);
      setCollections((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      return updated;
    },
    [],
  );

  const removeCollection = useCallback(async (id: string) => {
    setError(null);
    await collectionsApi.remove(id);
    setCollections((previous) => previous.filter((item) => item.id !== id));
    // Sunucu bağlantıları gruplanmamışa taşır; yerel listeyi de eşitle.
    setConnections((previous) =>
      previous.map((item) =>
        item.collection_id === id ? { ...item, collection_id: null } : item,
      ),
    );
  }, []);

  /** Koleksiyonları verilen sıraya dizer (yalnızca değişenler kaydedilir). */
  const reorderCollections = useCallback(
    async (orderedIds: string[]) => {
      setError(null);

      const changed = orderedIds.filter((id, index) => {
        const item = collections.find((collection) => collection.id === id);
        return item && item.sort_order !== index;
      });

      // Arayüz hemen güncellenir; istekler arkadan gider.
      setCollections((previous) =>
        orderedIds
          .map((id, index) => {
            const item = previous.find((collection) => collection.id === id);
            return item ? { ...item, sort_order: index } : null;
          })
          .filter((item): item is ConnectionCollection => item !== null),
      );

      try {
        await Promise.all(
          changed.map((id) =>
            collectionsApi.update(id, { sortOrder: orderedIds.indexOf(id) }),
          ),
        );
      } catch (reorderError) {
        setError(errorMessage(reorderError, 'Koleksiyon sırası kaydedilemedi.'));
        setCollections(await collectionsApi.findAll());
      }
    },
    [collections],
  );

  const moveConnection = useCallback(
    async (id: string, collectionId: string | null) => {
      setError(null);
      const updated = await connectionsApi.update(id, { collectionId });
      setConnections((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
    },
    [],
  );

  const testConnection = useCallback(async (id: string) => {
    setTestStatuses((previous) => ({ ...previous, [id]: { loading: true } }));

    try {
      const result = await connectionsApi.testConnection(id);

      setTestStatuses((previous) => ({
        ...previous,
        [id]: {
          loading: false,
          success: result.success,
          message: result.message,
        },
      }));
    } catch (testError) {
      setTestStatuses((previous) => ({
        ...previous,
        [id]: {
          loading: false,
          success: false,
          message: errorMessage(testError, 'Connection test failed.'),
        },
      }));
    }
  }, []);

  return {
    connections,
    collections,
    createCollection,
    updateCollection,
    removeCollection,
    reorderCollections,
    moveConnection,
    loading,
    error,
    setError,
    testStatuses,
    createConnection,
    updateConnection,
    removeConnection,
    testConnection,
  };
}
