
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, EditorSelection, Prec } from '@codemirror/state';
import { toggleComment } from '@codemirror/commands';
import {
  MariaSQL,
  MSSQL,
  MySQL,
  PLSQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  sql,
  type SQLNamespace,
} from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import type { CompletionMetadata, DatabaseType } from '@tukaka/contracts';

import type { MenuEntry } from '../lib/menu';
import { formatSql } from '../lib/sqlFormat';
import { useTheme, type ResolvedTheme } from '../lib/theme';
import ContextMenu from './ContextMenu';

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
  oracle: PLSQL,
  // Db2 for i için özel bir CodeMirror diyalekti yok.
  db2i: StandardSQL,
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

const selectedText = (view: EditorView) => {
  const selection = view.state.selection.main;
  return selection.empty ? null : view.state.sliceDoc(selection.from, selection.to);
};

/**
 * Seçili SQL'i (seçim yoksa tüm editörü) biçimlendirir. Geri alınabilir tek
 * bir değişiklik olarak uygulanır. Ayrıştırılamazsa hata fırlatır.
 */
function formatInEditor(view: EditorView, databaseType: DatabaseType | null | undefined) {
  const { state } = view;
  const selection = state.selection.main;
  const from = selection.empty ? 0 : selection.from;
  const to = selection.empty ? state.doc.length : selection.to;
  const text = state.sliceDoc(from, to);

  if (!text.trim()) return;

  // Seçimin baş/son boşlukları korunur; yalnızca içerik biçimlenir.
  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trailing = text.match(/\s*$/)?.[0] ?? '';
  const formatted = leading + formatSql(text.trim(), databaseType) + trailing;

  if (formatted === text) return;

  view.dispatch({
    changes: { from, to, insert: formatted },
    selection: selection.empty
      ? EditorSelection.cursor(Math.min(selection.head, formatted.length))
      : EditorSelection.range(from, from + formatted.length),
    userEvent: 'input.format',
    scrollIntoView: true,
  });
}

/** Seçili metnin harflerini değiştirir. */
function transformSelection(view: EditorView, transform: (text: string) => string) {
  view.dispatch(
    view.state.changeByRange((range) => {
      if (range.empty) return { range };
      const insert = transform(view.state.sliceDoc(range.from, range.to));
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from, range.from + insert.length),
      };
    }),
    { userEvent: 'input' },
  );
}

/** Koyu temada oneDark sözdizimi renkleri, açıkta CodeMirror varsayılanları. */
function themeExtension(theme: ResolvedTheme) {
  const base = EditorView.theme(editorThemeSpec, { dark: theme === 'dark' });
  return theme === 'dark' ? [oneDark, base] : [base];
}

/** Sağ tık menüsü; açıldığı andaki seçime göre olay içinde oluşturulur. */
function buildMenuItems(
  view: EditorView,
  handlers: Pick<SqlEditorProps, 'onRun' | 'onExplain'>,
  runFormat: (view: EditorView) => boolean,
  setNotice: (message: string) => void,
): MenuEntry[] {
  const selected = selectedText(view);
  const hasSelection = selected !== null;
  const desktop = window.desktopAPI;

  const copy = async (cut: boolean) => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected);
    if (cut) view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut' });
  };

  const paste = async () => {
    if (desktop?.windowCommand) {
      await desktop.windowCommand('paste');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste' });
    } catch {
      setNotice('Clipboard access was blocked. Use Ctrl+V to paste.');
    }
  };

  const after = (action: () => unknown) => () => {
    void action();
    view.focus();
  };

  return [
    {
      label: hasSelection ? 'Run Selection' : 'Run Query',
      shortcut: 'Ctrl+Enter',
      disabled: !handlers.onRun,
      onSelect: () => handlers.onRun?.(selected),
    },
    {
      label: hasSelection ? 'Explain Selection' : 'Explain Query',
      shortcut: 'Ctrl+Shift+Enter',
      disabled: !handlers.onExplain,
      onSelect: () => handlers.onExplain?.(selected),
    },
    { separator: true },
    {
      label: hasSelection ? 'Format Selection' : 'Format Document',
      shortcut: 'Shift+Alt+F',
      disabled: !view.state.doc.length,
      onSelect: after(() => runFormat(view)),
    },
    {
      label: 'Toggle Line Comment',
      shortcut: 'Ctrl+/',
      onSelect: after(() => toggleComment(view)),
    },
    {
      label: 'UPPERCASE',
      disabled: !hasSelection,
      onSelect: after(() => transformSelection(view, (text) => text.toUpperCase())),
    },
    {
      label: 'lowercase',
      disabled: !hasSelection,
      onSelect: after(() => transformSelection(view, (text) => text.toLowerCase())),
    },
    { separator: true },
    { label: 'Cut', shortcut: 'Ctrl+X', disabled: !hasSelection, onSelect: after(() => copy(true)) },
    { label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasSelection, onSelect: after(() => copy(false)) },
    { label: 'Paste', shortcut: 'Ctrl+V', onSelect: after(paste) },
    { separator: true },
    {
      label: 'Select All',
      shortcut: 'Ctrl+A',
      onSelect: after(() =>
        view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) }),
      ),
    },
  ];
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
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const databaseTypeRef = useRef(databaseType);

  useLayoutEffect(() => {
    databaseTypeRef.current = databaseType;
  }, [databaseType]);

  // Biçimlendirme hatası gibi kısa bildirimler birkaç saniye sonra kaybolur.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const runFormat = useCallback((view: EditorView) => {
    try {
      formatInEditor(view, databaseTypeRef.current);
    } catch (error) {
      setNotice(
        `Could not format SQL: ${error instanceof Error ? error.message.split('\n')[0] : 'parse error'}`,
      );
    }
    return true;
  }, []);

  // Güncel callback'leri sakla (ref render sırasında değil, commit sonrası güncellenir).
  const handlers = useRef({ onChange, onRun, onExplain, onSave, onCursorChange });

  useLayoutEffect(() => {
    handlers.current = { onChange, onRun, onExplain, onSave, onCursorChange };
  }, [onChange, onRun, onExplain, onSave, onCursorChange]);

  // Editör örneğini yalnızca bir kez oluştur.
  useEffect(() => {
    if (!containerRef.current) return;

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
          key: 'Shift-Alt-f',
          preventDefault: true,
          run: (view) => runFormat(view),
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
        EditorView.domEventHandlers({
          contextmenu: (event, view) => {
            event.preventDefault();

            // Seçimin dışına sağ tıklanırsa imleç oraya taşınır (seçim içindeyse korunur).
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            const insideSelection =
              pos !== null &&
              view.state.selection.ranges.some(
                (range) => !range.empty && pos >= range.from && pos <= range.to,
              );

            if (pos !== null && !insideSelection) {
              view.dispatch({ selection: EditorSelection.cursor(pos) });
            }

            view.focus();
            setMenu({ x: event.clientX, y: event.clientY, items: buildMenuItems(view, handlers.current, runFormat, setNotice) });
            return true;
          },
        }),
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

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div
        ref={containerRef}
        className="sql-editor-container h-full min-h-0 w-full overflow-hidden"
      />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />
      )}

      {notice && (
        <div
          role="status"
          className="absolute bottom-3 right-3 z-10 max-w-[70%] rounded-md border border-red-500/30 bg-(--c-1a1e27) px-3 py-2 text-[11.5px] text-red-400 shadow-lg"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
