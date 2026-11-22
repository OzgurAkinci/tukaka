
import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView } from '@codemirror/view';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
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

export default function SqlEditor({ value, onChange }: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  // Her render'da güncel callback'i sakla.
  onChangeRef.current = onChange;

  // Editör örneğini yalnızca bir kez oluştur.
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      doc: value,
      parent: containerRef.current,
      extensions: [
        basicSetup,
        sql({ dialect: PostgreSQL }),
        oneDark,
        editorTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Editörün yaşam döngüsü bileşen yaşam döngüsüne bağlıdır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
