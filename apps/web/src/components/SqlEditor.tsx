
import { useEffect, useLayoutEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, Prec } from '@codemirror/state';
import {
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  sql,
  type SQLNamespace,
} from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import type { CompletionMetadata, DatabaseType } from '@tukaka/contracts';

export interface CursorPosition {
  line: number;
  column: number;
}

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Bağlantı tipi; sözdizimi vurgulama ve anahtar kelimeler buna göre seçilir. */
  databaseType?: DatabaseType | null;
  /** Şema/tablo/kolon adları (otomatik tamamlama). */
  completion?: CompletionMetadata | null;
  /** Cmd/Ctrl+Enter: seçili metin varsa onu, yoksa tüm editörü çalıştırır. */
  onRun?: (selectedSql: string | null) => void;
  /** Cmd/Ctrl+S. */
  onSave?: () => void;
  onCursorChange?: (position: CursorPosition) => void;
  autoFocus?: boolean;
}

const dialects = {
  postgresql: PostgreSQL,
  mysql: MySQL,
  sqlite: SQLite,
} as const;

function languageExtension(
  databaseType: DatabaseType | null | undefined,
  completion: CompletionMetadata | null | undefined,
) {
  return sql({
    dialect: databaseType ? dialects[databaseType] : StandardSQL,
    schema: (completion?.schemas ?? {}) as SQLNamespace,
    defaultSchema: completion?.defaultSchema ?? undefined,
  });
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#111318',
    color: '#d5d8df',
    fontSize: '13px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    lineHeight: '1.8',
  },
  '.cm-gutters': {
    backgroundColor: '#111318',
    color: '#626b7a',
    border: 'none',
    borderRight: '1px solid #252a33',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#202530',
  },
  '.cm-activeLine': {
    backgroundColor: '#ffffff08',
  },
  '.cm-cursor': {
    borderLeftColor: '#60a5fa',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: '#264f78 !important',
  },
  '.cm-tooltip': {
    backgroundColor: '#202530',
    border: '1px solid #343a46',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: '#334155',
  },
});

export default function SqlEditor({
  value,
  onChange,
  databaseType,
  completion,
  onRun,
  onSave,
  onCursorChange,
  autoFocus,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());

  // Güncel callback'leri sakla (ref render sırasında değil, commit sonrası güncellenir).
  const handlers = useRef({ onChange, onRun, onSave, onCursorChange });

  useLayoutEffect(() => {
    handlers.current = { onChange, onRun, onSave, onCursorChange };
  }, [onChange, onRun, onSave, onCursorChange]);

  // Editör örneğini yalnızca bir kez oluştur.
  useEffect(() => {
    if (!containerRef.current) return;

    const shortcuts = Prec.highest(
      keymap.of([
        {
          key: 'Mod-Enter',
          run: (view) => {
            const selection = view.state.selection.main;
            const selected = selection.empty
              ? null
              : view.state.sliceDoc(selection.from, selection.to);

            handlers.current.onRun?.(selected);
            return true;
          },
        },
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            handlers.current.onSave?.();
            return true;
          },
        },
      ]),
    );

    const view = new EditorView({
      doc: value,
      parent: containerRef.current,
      extensions: [
        shortcuts,
        basicSetup,
        languageCompartment.current.of(
          languageExtension(databaseType, completion),
        ),
        oneDark,
        editorTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            handlers.current.onChange(update.state.doc.toString());
          }

          if (update.docChanged || update.selectionSet) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);

            handlers.current.onCursorChange?.({
              line: line.number,
              column: head - line.from + 1,
            });
          }
        }),
      ],
    });

    viewRef.current = view;

    if (autoFocus) {
      view.focus();
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Editörün yaşam döngüsü bileşen yaşam döngüsüne bağlıdır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bağlantı tipi ya da şema bilgisi değişince dil ayarını güncelle.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageCompartment.current.reconfigure(
        languageExtension(databaseType, completion),
      ),
    });
  }, [databaseType, completion]);

  // React tarafından gelen değişiklikleri editöre uygula.
  useEffect(() => {
    const view = viewRef.current;

    if (!view) return;

    const currentValue = view.state.doc.toString();

    if (currentValue !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="sql-editor-container h-full min-h-0 w-full overflow-hidden"
    />
  );
}
