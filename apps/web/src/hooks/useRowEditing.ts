import { useCallback, useState } from 'react';
import type { RowChange } from '@tukaka/contracts';

import type { RowState } from '../components/ResultGrid';

/** Hücre değerini düzenleme kutusundaki metne çevirir. */
export function toEditableText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function sameValue(original: unknown, next: unknown): boolean {
  if (next === null) return original === null || original === undefined;
  if (original === null || original === undefined) return false;
  return toEditableText(original) === next;
}

interface PendingChanges {
  /** Hangi veri sürümüne ait (sayfa/filtre değişince değişiklikler geçersizleşir). */
  version: string;
  /** Var olan satırlar: satır indeksi → değişen kolonlar. */
  edits: Record<number, Record<string, unknown>>;
  /** Yeni satırlar: yalnızca girilen kolonlar (diğerleri veritabanı varsayılanı). */
  inserts: Array<Record<string, unknown>>;
  /** Silinecek var olan satırların indeksleri. */
  deletions: number[];
  /** Seçili satır indeksleri (var olan + yeni satırlar birlikte). */
  selected: number[];
  editing: { rowIndex: number; column: string } | null;
}

const empty = (version: string): PendingChanges => ({
  version,
  edits: {},
  inserts: [],
  deletions: [],
  selected: [],
  editing: null,
});

interface UseRowEditingOptions {
  /** Yüklenen verinin kimliği; değişince bekleyen değişiklikler sıfırlanır. */
  version: string;
  rows: Record<string, unknown>[];
  columns: string[];
  primaryKey: string[];
  /** Var olan satırları düzenleme/silme (birincil anahtar gerekir). */
  canUpdate: boolean;
  /** Yeni satır ekleme. */
  canInsert: boolean;
}

/**
 * Data Viewer'daki bekleyen satır değişikliklerini (ekleme, düzenleme, silme)
 * yönetir. Değişiklikler "Kaydet" ile onaylanana kadar veritabanına gitmez.
 */
export function useRowEditing({
  version,
  rows,
  columns,
  primaryKey,
  canUpdate,
  canInsert,
}: UseRowEditingOptions) {
  const [state, setState] = useState<PendingChanges>(() => empty(version));

  // Veri yeniden yüklendiyse eski değişiklikler geçersizdir.
  const pending = state.version === version ? state : empty(version);

  const update = useCallback(
    (change: (current: PendingChanges) => PendingChanges) =>
      setState((previous) =>
        change(previous.version === version ? previous : empty(version)),
      ),
    [version],
  );

  const base = rows.length;
  const isNewRow = (rowIndex: number) => rowIndex >= base;

  const displayRows = [
    ...rows.map((row, index) =>
      pending.edits[index] ? { ...row, ...pending.edits[index] } : row,
    ),
    ...pending.inserts,
  ];

  const editedRowCount = Object.keys(pending.edits).filter(
    (index) => !pending.deletions.includes(Number(index)),
  ).length;

  const pendingCount =
    editedRowCount + pending.inserts.length + pending.deletions.length;

  const canEditCell = (rowIndex: number) =>
    isNewRow(rowIndex) ? canInsert : canUpdate && !pending.deletions.includes(rowIndex);

  const getRowState = (rowIndex: number): RowState => {
    if (!isNewRow(rowIndex) && pending.deletions.includes(rowIndex)) return 'deleted';
    if (pending.selected.includes(rowIndex)) return 'selected';
    if (isNewRow(rowIndex)) return 'new';
    return null;
  };

  const isCellChanged = (rowIndex: number, column: string) =>
    isNewRow(rowIndex)
      ? column in (pending.inserts[rowIndex - base] ?? {})
      : column in (pending.edits[rowIndex] ?? {});

  const isCellDefault = (rowIndex: number, column: string) =>
    isNewRow(rowIndex) && !(column in (pending.inserts[rowIndex - base] ?? {}));

  const startEdit = (rowIndex: number, column: string) => {
    if (!canEditCell(rowIndex)) return;
    update((current) => ({ ...current, editing: { rowIndex, column } }));
  };

  const cancelEdit = () => update((current) => ({ ...current, editing: null }));

  /** Düzenlenen hücreye değeri yazar; `moveNext` ile sağdaki hücreye geçer. */
  const commitEdit = (value: string | null, moveNext = false) =>
    update((current) => {
      const target = current.editing;
      if (!target) return current;

      const { rowIndex, column } = target;
      const next = { ...current };

      if (rowIndex >= base) {
        const inserts = [...current.inserts];
        inserts[rowIndex - base] = { ...inserts[rowIndex - base], [column]: value };
        next.inserts = inserts;
      } else {
        const rowEdits = { ...(current.edits[rowIndex] ?? {}) };

        if (sameValue(rows[rowIndex]?.[column], value)) {
          delete rowEdits[column];
        } else {
          rowEdits[column] = value;
        }

        const edits = { ...current.edits };
        if (Object.keys(rowEdits).length > 0) edits[rowIndex] = rowEdits;
        else delete edits[rowIndex];
        next.edits = edits;
      }

      const columnIndex = columns.indexOf(column);
      next.editing =
        moveNext && columnIndex < columns.length - 1
          ? { rowIndex, column: columns[columnIndex + 1] }
          : null;

      return next;
    });

  const toggleSelect = (rowIndex: number) =>
    update((current) => ({
      ...current,
      selected: current.selected.includes(rowIndex)
        ? current.selected.filter((index) => index !== rowIndex)
        : [...current.selected, rowIndex],
    }));

  /** Seçili satırları silinecek olarak işaretler (yeni satırları doğrudan kaldırır). */
  const deleteSelected = () =>
    update((current) => {
      const existing = current.selected.filter((index) => index < base);
      const newOnes = new Set(
        current.selected.filter((index) => index >= base).map((index) => index - base),
      );

      // Hepsi zaten silinecekse işareti kaldır (geri al).
      const allDeleted = existing.every((index) => current.deletions.includes(index));

      return {
        ...current,
        deletions: allDeleted
          ? current.deletions.filter((index) => !existing.includes(index))
          : [...new Set([...current.deletions, ...existing])],
        inserts: current.inserts.filter((_, index) => !newOnes.has(index)),
        selected: [],
        editing: null,
      };
    });

  const addRow = () =>
    update((current) => ({
      ...current,
      inserts: [...current.inserts, {}],
      editing: columns[0]
        ? { rowIndex: base + current.inserts.length, column: columns[0] }
        : null,
    }));

  const discard = () => setState(empty(version));

  /** Bekleyen değişiklikleri API'nin beklediği biçime çevirir. */
  const buildChanges = (): RowChange[] => {
    const keyOf = (row: Record<string, unknown>) =>
      Object.fromEntries(primaryKey.map((name) => [name, row[name]]));

    return [
      ...pending.deletions.map(
        (index): RowChange => ({ type: 'delete', key: keyOf(rows[index]) }),
      ),
      ...Object.entries(pending.edits)
        .filter(([index]) => !pending.deletions.includes(Number(index)))
        .map(
          ([index, values]): RowChange => ({
            type: 'update',
            key: keyOf(rows[Number(index)]),
            values,
          }),
        ),
      ...pending.inserts.map((values): RowChange => ({ type: 'insert', values })),
    ];
  };

  return {
    displayRows,
    pendingCount,
    selectedCount: pending.selected.length,
    editingCell: pending.editing,
    getRowState,
    isCellChanged,
    isCellDefault,
    startEdit,
    cancelEdit,
    commitEdit,
    toggleSelect,
    deleteSelected,
    addRow,
    discard,
    buildChanges,
  };
}
