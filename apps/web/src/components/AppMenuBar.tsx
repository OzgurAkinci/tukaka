import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

import { formatShortcut, type MenuDefinition } from '../lib/menu';

/**
 * Masaüstü başlık çubuğundaki File / Edit / View … menüleri. Tıklamalar
 * odağı almaz; böylece Copy/Paste gibi komutlar editördeki seçime uygulanır.
 */
export default function AppMenuBar({ menus }: { menus: MenuDefinition[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openIndex === null) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenIndex(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenIndex(null);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const step = event.key === 'ArrowRight' ? 1 : -1;
        setOpenIndex((index) => (index === null ? null : (index + step + menus.length) % menus.length));
      }
    };
    const close = () => setOpenIndex(null);

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [openIndex, menus.length]);

  return (
    <div ref={rootRef} role="menubar" className="app-no-drag flex h-full items-center">
      {menus.map((menu, index) => {
        const open = openIndex === index;

        return (
          <div key={menu.label} className="relative h-full flex items-center">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpenIndex(open ? null : index)}
              onMouseEnter={() => {
                if (openIndex !== null) setOpenIndex(index);
              }}
              className={`h-7 px-2.5 rounded-md text-[12.5px] transition-colors ${
                open
                  ? 'bg-(--c-292e39) text-(--c-e5e7eb)'
                  : 'text-(--c-aab1bd) hover:bg-(--c-252a34) hover:text-(--c-e5e7eb)'
              }`}
            >
              {menu.label}
            </button>

            {open && (
              <div
                role="menu"
                aria-label={menu.label}
                onMouseDown={(event) => event.preventDefault()}
                className="absolute left-0 top-[calc(100%-2px)] z-[60] min-w-[248px] rounded-lg border border-(--c-343a46) bg-(--c-1a1e27) p-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
              >
                {menu.items.map((item, itemIndex) =>
                  'separator' in item ? (
                    <div key={`sep-${itemIndex}`} role="separator" className="my-1 h-px bg-(--c-2b303b)" />
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                      aria-checked={item.checked}
                      disabled={item.disabled}
                      onClick={() => {
                        setOpenIndex(null);
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
