import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

import { formatShortcut, type MenuEntry } from '../lib/menu';

interface ContextMenuProps {
  /** Açıldığı nokta (viewport koordinatları). */
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

const MARGIN = 6;

/**
 * Sağ tık menüsü. Başlık çubuğu menüleriyle aynı görünümdedir; ekrandan
 * taşmayacak şekilde konumlanır ve tıklamalar odağı almaz (editör seçimi korunur).
 */
export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;

    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    window.addEventListener('wheel', onClose, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onMouseDown={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      style={position}
      className="fixed z-[70] min-w-[260px] rounded-lg border border-(--c-343a46) bg-(--c-1a1e27) p-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
    >
      {items.map((item, index) =>
        'separator' in item ? (
          <div key={`sep-${index}`} role="separator" className="my-1 h-px bg-(--c-2b303b)" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className="group w-full flex items-center gap-2 h-8 pl-2 pr-2.5 rounded-md text-left text-[12.5px] text-(--c-d5d8df) hover:bg-blue-600 hover:text-[white] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-(--c-d5d8df)"
          >
            <span className="w-4 shrink-0 flex justify-center">
              {item.checked && <Check size={13} />}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="ml-6 text-[11px] text-(--c-737d8d) group-hover:text-[white]/80 group-disabled:text-(--c-737d8d)">
                {formatShortcut(item.shortcut)}
              </span>
            )}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
