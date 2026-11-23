import { useCallback, useEffect, useState } from 'react';
import type { ConnectionProfile } from '@tukaka/contracts';

import { errorMessage } from '../api/client';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testStatuses, setTestStatuses] = useState<
    Record<string, ConnectionTestStatus>
  >({});

  useEffect(() => {
    let cancelled = false;

    connectionsApi
      .findAll()
      .then((result) => {
        if (!cancelled) setConnections(result);
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
