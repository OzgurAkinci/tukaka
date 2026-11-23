import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const query = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const systemTheme = (): ResolvedTheme =>
  window.matchMedia(query).matches ? 'dark' : 'light';

/**
 * Tercihi (sistem dahil) çözer ve `<html data-theme>` özniteliğini günceller.
 */
export function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const system = useSyncExternalStore(subscribe, systemTheme, () => 'dark' as const);
  const resolved = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  return resolved;
}

export const ThemeContext = createContext<ResolvedTheme>('dark');

export const useTheme = () => useContext(ThemeContext);
