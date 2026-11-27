import { useEffect, useRef } from 'react';

export type MenuEntry =
  | {
      label: string;
      /** Görüntülenen kısayol, ör. "Ctrl+Shift+N". */
      shortcut?: string;
      /**
       * Kısayol uygulama genelinde dinlenir. Kapalıysa yalnızca gösterilir
       * (ör. Ctrl+C'yi tarayıcı, Ctrl+S'yi SQL editörü zaten karşılar).
       */
      global?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { separator: true };

export interface MenuDefinition {
  label: string;
  items: MenuEntry[];
}

const isMac = window.desktopAPI?.platform === 'darwin';

/** "Ctrl+Shift+N" → macOS'ta "⇧⌘N". */
export function formatShortcut(shortcut: string) {
  if (!isMac) return shortcut;

  return shortcut
    .replace('Ctrl+', '⌘')
    .replace('Shift+', '⇧')
    .replace('Alt+', '⌥')
    .replace(/^(.*?)(⇧|⌥)/, '$2$1');
}

function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  const parts = shortcut.split('+');
  // "Ctrl+=" gibi '+' içeren kısayollar için boş son parçayı topla.
  const key = (parts.at(-1) || '+').toLowerCase();
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));

  const ctrl = isMac ? event.metaKey : event.ctrlKey;
  if (ctrl !== modifiers.has('ctrl')) return false;
  if (event.shiftKey !== modifiers.has('shift')) return false;
  if (event.altKey !== modifiers.has('alt')) return false;

  const pressed = event.key.toLowerCase();
  // Ctrl+= düzenine göre '+' ile de gelebilir.
  return pressed === key || (key === '=' && pressed === '+');
}

/** Menülerdeki `global` kısayolları klavyeden çalıştırır. */
export function useMenuShortcuts(menus: MenuDefinition[], enabled: boolean) {
  const menusRef = useRef(menus);

  useEffect(() => {
    menusRef.current = menus;
  }, [menus]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;

      for (const menu of menusRef.current) {
        for (const item of menu.items) {
          if ('separator' in item || !item.global || !item.shortcut || item.disabled) continue;

          if (matchesShortcut(event, item.shortcut)) {
            event.preventDefault();
            item.onSelect();
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
