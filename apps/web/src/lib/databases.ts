import type { DatabaseType } from '@tukaka/contracts';

export interface DatabaseInfo {
  label: string;
  defaultPort: number;
  defaultDatabase: string;
  defaultUsername: string;
  /** Sidebar ikonu rengi (Tailwind sınıfı). */
  color: string;
  /** Sunucu tabanlı mı (host/port/kullanıcı)? */
  server: boolean;
  supports: {
    /** Data Viewer'da satır ekleme/düzenleme/silme. */
    rowEditing: boolean;
    /** Fonksiyon / prosedür listesi. */
    routines: boolean;
    /** Çalışan sorguyu iptal. */
    cancel: boolean;
    /** SSL ayarları. */
    ssl: boolean;
  };
}

export const databases: Record<DatabaseType, DatabaseInfo> = {
  postgresql: {
    label: 'PostgreSQL',
    defaultPort: 5432,
    defaultDatabase: 'postgres',
    defaultUsername: 'postgres',
    color: 'text-sky-400',
    server: true,
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true },
  },
  mysql: {
    label: 'MySQL',
    defaultPort: 3306,
    defaultDatabase: '',
    defaultUsername: 'root',
    color: 'text-orange-400',
    server: true,
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true },
  },
  mariadb: {
    label: 'MariaDB',
    defaultPort: 3306,
    defaultDatabase: '',
    defaultUsername: 'root',
    color: 'text-amber-500',
    server: true,
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true },
  },
  mssql: {
    label: 'SQL Server',
    defaultPort: 1433,
    defaultDatabase: 'master',
    defaultUsername: 'sa',
    color: 'text-red-400',
    server: true,
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true },
  },
  clickhouse: {
    label: 'ClickHouse',
    defaultPort: 8123,
    defaultDatabase: 'default',
    defaultUsername: 'default',
    color: 'text-yellow-300',
    server: true,
    // ClickHouse'ta transaction ve birincil anahtar tekilliği yoktur.
    supports: { rowEditing: false, routines: false, cancel: true, ssl: true },
  },
  sqlite: {
    label: 'SQLite',
    defaultPort: 0,
    defaultDatabase: '',
    defaultUsername: '',
    color: 'text-purple-400',
    server: false,
    supports: { rowEditing: true, routines: false, cancel: false, ssl: false },
  },
};

export const databaseTypes = Object.keys(databases) as DatabaseType[];

/** Tanımlayıcıyı (tablo/kolon adı) veritabanına uygun şekilde tırnaklar. */
export function quoteIdentifier(type: DatabaseType | undefined, name: string): string {
  switch (type) {
    case 'mysql':
    case 'mariadb':
    case 'clickhouse':
      return '`' + name.replace(/`/g, '``') + '`';
    case 'mssql':
      return `[${name.replace(/]/g, ']]')}]`;
    default:
      return `"${name.replace(/"/g, '""')}"`;
  }
}

export function qualifiedName(
  type: DatabaseType | undefined,
  schema: string,
  table: string,
): string {
  return `${quoteIdentifier(type, schema)}.${quoteIdentifier(type, table)}`;
}
