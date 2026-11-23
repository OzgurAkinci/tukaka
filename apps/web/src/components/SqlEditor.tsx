
import { useEffect, useLayoutEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, Prec } from '@codemirror/state';
import {
  MariaSQL,
  MSSQL,
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  sql,
  type SQLNamespace,
} from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import type { CompletionMetadata, DatabaseType } from '@tukaka/contracts';

import { useTheme, type ResolvedTheme } from '../lib/theme';

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
  /** Cmd/Ctrl+Shift+Enter: sorgu planı (EXPLAIN). */
  onExplain?: (selectedSql: string | null) => void;
  /** Cmd/Ctrl+S. */
  onSave?: () => void;
  onCursorChange?: (position: CursorPosition) => void;
  autoFocus?: boolean;
}

const dialects: Record<DatabaseType, typeof StandardSQL> = {
  postgresql: PostgreSQL,
  mysql: MySQL,
  mariadb: MariaSQL,
  sqlite: SQLite,
  mssql: MSSQL,
  clickhouse: StandardSQL,
};

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

const editorThemeSpec = {
  '&': {
    height: '100%',
    backgroundColor: 'var(--c-111318)',
    color: 'var(--c-d5d8df)',
    fontSize: '13px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    lineHeight: '1.8',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--c-111318)',
    color: 'var(--c-626b7a)',
    border: 'none',
    borderRight: '1px solid var(--c-252a33)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--c-202530)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--c-active-line)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--c-60a5fa)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--c-264f78) !important',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--c-202530)',
    border: '1px solid var(--c-343a46)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--c-334155)',
  },
};

/** Koyu temada oneDark sözdizimi renkleri, açıkta CodeMirror varsayılanları. */
function themeExtension(theme: ResolvedTheme) {
  const base = EditorView.theme(editorThemeSpec, { dark: theme === 'dark' });
  return theme === 'dark' ? [oneDark, base] : [base];
}

export default function SqlEditor({
  value,
  onChange,
  databaseType,
  completion,
  onRun,
  onExplain,
  onSave,
  onCursorChange,
  autoFocus,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const theme = useTheme();

  // Güncel callback'leri sakla (ref render sırasında değil, commit sonrası güncellenir).
  const handlers = useRef({ onChange, onRun, onExplain, onSave, onCursorChange });

  useLayoutEffect(() => {
    handlers.current = { onChange, onRun, onExplain, onSave, onCursorChange };
  }, [onChange, onRun, onExplain, onSave, onCursorChange]);

  // Editör örneğini yalnızca bir kez oluştur.
  useEffect(() => {
    if (!containerRef.current) return;

    const selectedText = (view: EditorView) => {
      const selection = view.state.selection.main;
      return selection.empty ? null : view.state.sliceDoc(selection.from, selection.to);
    };

    const shortcuts = Prec.highest(
      keymap.of([
        {
          key: 'Mod-Shift-Enter',
          run: (view) => {
            handlers.current.onExplain?.(selectedText(view));
            return true;
          },
        },
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
        themeCompartment.current.of(themeExtension(theme)),
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

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(themeExtension(theme)),
    });
  }, [theme]);

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
