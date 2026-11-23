import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';

import { downloadResult, type ExportFormat } from '../lib/export';

interface ExportMenuProps {
  fileBaseName: string;
  columns: string[];
  rows: Record<string, unknown>[];
  disabled?: boolean;
}

export default function ExportMenu({
  fileBaseName,
  columns,
  rows,
  disabled,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const exportAs = (format: ExportFormat) => {
    downloadResult(fileBaseName, format, columns, rows);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title="Export"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 hover:text-white disabled:opacity-40 disabled:hover:text-inherit"
      >
        <Download size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-md border border-(--c-343a46) bg-(--c-1c2029) py-1 shadow-xl">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500">
            Export {rows.length} rows
          </div>
          {(['csv', 'json'] as const).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => exportAs(format)}
              className="block w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-(--c-292e39)"
            >
              {format === 'csv' ? 'CSV (.csv)' : 'JSON (.json)'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
