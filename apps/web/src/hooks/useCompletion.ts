import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompletionMetadata } from '@tukaka/contracts';

import { connectionsApi } from '../api/connections';

/**
 * Bağlantı başına editör otomatik tamamlama verisini önbelleğe alır.
 */
export function useCompletion(connectionIds: Array<string | null>) {
  const [cache, setCache] = useState<Record<string, CompletionMetadata>>({});
  const requested = useRef(new Set<string>());

  const load = useCallback(async (connectionId: string) => {
    requested.current.add(connectionId);

    try {
      const metadata = await connectionsApi.getCompletion(connectionId);
      setCache((previous) => ({ ...previous, [connectionId]: metadata }));
    } catch {
      // Otomatik tamamlama isteğe bağlıdır; hata olursa anahtar kelimelerle devam.
      requested.current.delete(connectionId);
    }
  }, []);

  const key = connectionIds.filter(Boolean).join('|');

  useEffect(() => {
    for (const id of key ? key.split('|') : []) {
      if (!requested.current.has(id)) {
        void load(id);
      }
    }
  }, [key, load]);

  const invalidate = useCallback(
    (connectionId: string) => {
      setCache((previous) => {
        const next = { ...previous };
        delete next[connectionId];
        return next;
      });
      void load(connectionId);
    },
    [load],
  );

  return { completion: cache, invalidateCompletion: invalidate };
}
