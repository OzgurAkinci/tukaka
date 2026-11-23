import { useState } from 'react';
import { Plus, Table2, Trash2 } from 'lucide-react';
import type { DatabaseType } from '@tukaka/contracts';

import {
  addColumnSql,
  columnTypeSuggestions,
  createTableSql,
  type ColumnDefinition,
} from '../lib/ddl';
import Modal, {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './Modal';

interface ColumnDesignerProps {
  mode: 'create-table' | 'add-column';
  databaseType: DatabaseType;
  schema: string;
  /** add-column modunda hedef tablo. */
  table?: string;
  onClose: () => void;
  /** Üretilen SQL'i bir sorgu sekmesinde açar (çalıştırmaz). */
  onGenerate: (sql: string) => void;
}

const newColumn = (overrides: Partial<ColumnDefinition> = {}): ColumnDefinition => ({
  name: '',
  type: '',
  nullable: true,
  defaultValue: '',
  primaryKey: false,
  ...overrides,
});

const cellInput =
  'h-8 w-full rounded border border-(--c-343a46) bg-(--c-171b24) px-2 text-xs text-(--c-d5d8df) outline-none focus:border-blue-500';

/**
 * Basit tablo tasarımcısı: yeni tablo ya da yeni kolon için SQL üretir.
 * SQL doğrudan çalıştırılmaz; incelemek için editörde açılır.
 */
export default function ColumnDesigner({
  mode,
  databaseType,
  schema,
  table,
  onClose,
  onGenerate,
}: ColumnDesignerProps) {
  const suggestions = columnTypeSuggestions[databaseType];
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<ColumnDefinition[]>(() =>
    mode === 'create-table'
      ? [newColumn({ name: 'id', type: suggestions[0], nullable: false, primaryKey: true })]
      : [newColumn()],
  );

  const update = (index: number, patch: Partial<ColumnDefinition>) =>
    setColumns((previous) =>
      previous.map((column, current) => (current === index ? { ...column, ...patch } : column)),
    );

  const valid =
    columns.length > 0 &&
    columns.every((column) => column.name.trim() && column.type.trim()) &&
    (mode === 'add-column' || tableName.trim().length > 0);

  const generate = () => {
    const cleaned = columns.map((column) => ({ ...column, name: column.name.trim() }));

    onGenerate(
      mode === 'create-table'
        ? createTableSql(databaseType, schema, tableName.trim(), cleaned)
        : addColumnSql(databaseType, schema, table ?? '', cleaned[0]),
    );
  };

  return (
    <Modal
      title={mode === 'create-table' ? 'New table' : `Add column to ${table}`}
      subtitle="Generates SQL in a new query tab so you can review it before running"
      icon={<Table2 size={18} />}
      onClose={onClose}
      widthClass="max-w-[820px]"
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="submit"
            form="column-designer-form"
            disabled={!valid}
            className={primaryButtonClass}
          >
            Open SQL in editor
          </button>
        </>
      }
    >
      <form
        id="column-designer-form"
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) generate();
        }}
      >
        {mode === 'create-table' && (
          <div>
            <label className={labelClass} htmlFor="designer-table-name">
              Table name <span className="text-gray-600">({schema})</span>
            </label>
            <input
              id="designer-table-name"
              autoFocus
              value={tableName}
              onChange={(event) => setTableName(event.target.value)}
              className={inputClass}
              placeholder="orders"
            />
          </div>
        )}

        <datalist id="column-type-suggestions">
          {suggestions.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>

        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="pb-2 pr-2 font-medium">Name</th>
              <th className="pb-2 pr-2 font-medium">Type</th>
              <th className="pb-2 pr-2 font-medium">Default</th>
              <th className="pb-2 pr-2 font-medium text-center">Null</th>
              {mode === 'create-table' && (
                <th className="pb-2 pr-2 font-medium text-center">PK</th>
              )}
              <th />
            </tr>
          </thead>
          <tbody>
            {columns.map((column, index) => (
              <tr key={index}>
                <td className="py-1 pr-2">
                  <input
                    aria-label="Column name"
                    autoFocus={mode === 'add-column' && index === 0}
                    value={column.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    className={cellInput}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label="Column type"
                    list="column-type-suggestions"
                    value={column.type}
                    onChange={(event) => update(index, { type: event.target.value })}
                    className={cellInput}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label="Default value"
                    value={column.defaultValue}
                    onChange={(event) => update(index, { defaultValue: event.target.value })}
                    placeholder="SQL expression"
                    className={cellInput}
                  />
                </td>
                <td className="py-1 pr-2 text-center">
                  <input
                    type="checkbox"
                    aria-label="Nullable"
                    checked={column.nullable && !column.primaryKey}
                    disabled={column.primaryKey}
                    onChange={(event) => update(index, { nullable: event.target.checked })}
                  />
                </td>
                {mode === 'create-table' && (
                  <td className="py-1 pr-2 text-center">
                    <input
                      type="checkbox"
                      aria-label="Primary key"
                      checked={column.primaryKey}
                      onChange={(event) =>
                        update(index, {
                          primaryKey: event.target.checked,
                          nullable: event.target.checked ? false : column.nullable,
                        })
                      }
                    />
                  </td>
                )}
                <td className="py-1 text-right">
                  {mode === 'create-table' && columns.length > 1 && (
                    <button
                      type="button"
                      title="Remove column"
                      onClick={() =>
                        setColumns((previous) => previous.filter((_, current) => current !== index))
                      }
                      className="p-1 text-gray-500 hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {mode === 'create-table' && (
          <button
            type="button"
            onClick={() => setColumns((previous) => [...previous, newColumn()])}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white"
          >
            <Plus size={12} />
            Add column
          </button>
        )}
      </form>
    </Modal>
  );
}
