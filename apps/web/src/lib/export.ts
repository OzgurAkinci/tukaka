function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text =
    typeof value === 'object' && !(value instanceof Date)
      ? JSON.stringify(value)
      : String(value);

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  const lines = [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ];

  return lines.join('\r\n');
}

export function toJson(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  // Kolon sırasını koru.
  const ordered = rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
  );

  return JSON.stringify(ordered, null, 2);
}

export type ExportFormat = 'csv' | 'json';

export function downloadResult(
  fileBaseName: string,
  format: ExportFormat,
  columns: string[],
  rows: Record<string, unknown>[],
): void {
  const content =
    format === 'csv'
      ? // BOM: Excel'in UTF-8'i (Türkçe karakterler) doğru açması için.
        `\uFEFF${toCsv(columns, rows)}`
      : toJson(columns, rows);

  const blob = new Blob([content], {
    type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `${fileBaseName.replace(/[^\w.-]+/g, '_')}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
