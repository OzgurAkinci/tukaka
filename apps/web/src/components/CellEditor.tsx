import { useEffect, useRef, useState } from 'react';

import { toEditableText } from '../hooks/useRowEditing';

interface CellEditorProps {
  value: unknown;
  onCommit: (value: string | null, moveNext?: boolean) => void;
  onCancel: () => void;
}

/**
 * Hücre içi düzenleyici. Enter: kaydet · Tab: kaydet ve sağa geç ·
 * Esc: vazgeç · NULL düğmesi: değeri NULL yap.
 */
export default function CellEditor({ value, onCommit, onCancel }: CellEditorProps) {
  const [text, setText] = useState(() => toEditableText(value));
  const [isNull, setIsNull] = useState(value === null);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = (moveNext = false, forceNull = false) => {
    if (done.current) return;
    done.current = true;
    onCommit(forceNull || isNull ? null : text, moveNext);
  };

  return (
    <div className="flex items-center bg-(--c-0d0f13) ring-1 ring-inset ring-blue-500">
      <input
        ref={inputRef}
        aria-label="Cell value"
        value={isNull ? '' : text}
        placeholder={isNull ? 'NULL' : ''}
        onChange={(event) => {
          setIsNull(false);
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Tab') {
            event.preventDefault();
            commit(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        onBlur={() => commit()}
        className="min-w-[140px] flex-1 bg-transparent px-3 py-2 text-xs text-white outline-none placeholder:italic placeholder:text-gray-600"
      />
      <button
        type="button"
        title="Set NULL"
        // Blur'dan önce çalışsın diye mousedown kullanılır.
        onMouseDown={(event) => {
          event.preventDefault();
          commit(false, true);
        }}
        className="mr-1 rounded px-1.5 py-0.5 text-[9px] font-semibold text-gray-500 hover:bg-(--c-292e39) hover:text-white"
      >
        NULL
      </button>
    </div>
  );
}
