/**
 * Hücre değerini tabloda gösterilecek metne çevirir.
 */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  // SQLite CURRENT_TIMESTAMP "YYYY-MM-DD HH:MM:SS" (UTC, Z'siz) döndürür.
  const normalized = /Z$|[+-]\d\d:?\d\d$/.test(iso)
    ? iso
    : `${iso.replace(' ', 'T')}Z`;

  const time = new Date(normalized).getTime();

  if (Number.isNaN(time)) {
    return iso;
  }

  const seconds = Math.round((now - time) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;

  return new Date(time).toLocaleString();
}
