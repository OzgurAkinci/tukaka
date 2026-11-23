import { useCallback, useState } from 'react';

import { readStorage, writeStorage } from '../lib/storage';
import type { ThemePreference } from '../lib/theme';

export interface AppSettings {
  /** SQL editöründen çalışan sorgularda döndürülecek en fazla satır. */
  maxRows: number;
  /** Sorgu zaman aşımı (saniye). */
  timeoutSeconds: number;
  /** Data Viewer sayfa boyutu. */
  pageSize: number;
  /** Arayüz teması. */
  theme: ThemePreference;
}

export const DEFAULT_SETTINGS: AppSettings = {
  maxRows: 1000,
  timeoutSeconds: 30,
  pageSize: 100,
  theme: 'dark',
};

const STORAGE_KEY = 'tukaka.settings';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...readStorage<Partial<AppSettings>>(STORAGE_KEY, {}),
  }));

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      writeStorage(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
