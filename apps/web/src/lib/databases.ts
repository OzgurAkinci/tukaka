import type { DatabaseType } from '@tukaka/contracts';

export type DatabaseGroup = 'server' | 'analytics' | 'file';

export const databaseGroups: Record<DatabaseGroup, string> = {
  server: 'Relational databases',
  analytics: 'Analytics',
  file: 'Local files',
};

export interface DatabaseInfo {
  label: string;
  /** Combobox altında gösterilen kısa açıklama. */
  description: string;
  group: DatabaseGroup;
  /** "Database" alanının bu veritabanındaki adı (servis adı, kütüphane…). */
  databaseLabel: string;
  databasePlaceholder: string;
  /** Port alanı için ek bilgi. */
  portHint?: string;
  /**
   * true ise sürücü SSL'i kendiliğinden denemez: "Prefer" SSL'siz bağlanır.
   * SSL için "Require" seçilmelidir.
   */
  sslNoNegotiation?: boolean;
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
    /** Sorgu planı (EXPLAIN). */
    explain: boolean;
  };
}

export const databases: Record<DatabaseType, DatabaseInfo> = {
  postgresql: {
    label: 'PostgreSQL',
    description: 'PostgreSQL 9.6+. Schemas, functions, EXPLAIN and row editing.',
    group: 'server',
    databaseLabel: 'Database',
    databasePlaceholder: 'postgres',
    defaultPort: 5432,
    defaultDatabase: 'postgres',
    defaultUsername: 'postgres',
    color: 'text-sky-400',
    server: true,
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true, explain: true },
  },
  mysql: {
    label: 'MySQL',
    description: 'MySQL 5.7 / 8.x. Each database appears as a schema.',
    group: 'server',
    databaseLabel: 'Database',
    databasePlaceholder: 'app_db',
    defaultPort: 3306,
    defaultDatabase: '',
    defaultUsername: 'root',
    color: 'text-orange-400',
    server: true,
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true, explain: true },
  },
  mariadb: {
    label: 'MariaDB',
    description: 'MariaDB 10.x / 11.x (uses the MySQL protocol).',
    group: 'server',
    databaseLabel: 'Database',
    databasePlaceholder: 'app_db',
    defaultPort: 3306,
    defaultDatabase: '',
    defaultUsername: 'root',
    color: 'text-amber-500',
    server: true,
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true, explain: true },
  },
  mssql: {
    label: 'SQL Server',
    description: 'Microsoft SQL Server 2012+ and Azure SQL.',
    group: 'server',
    databaseLabel: 'Database',
    databasePlaceholder: 'master',
    defaultPort: 1433,
    defaultDatabase: 'master',
    defaultUsername: 'sa',
    color: 'text-red-400',
    server: true,
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true, explain: true },
  },
  clickhouse: {
    label: 'ClickHouse',
    sslNoNegotiation: true,
    description: 'ClickHouse over HTTP (8123) or HTTPS (8443). Read-only data viewer.',
    group: 'analytics',
    databaseLabel: 'Database',
    databasePlaceholder: 'default',
    defaultPort: 8123,
    defaultDatabase: 'default',
    defaultUsername: 'default',
    color: 'text-yellow-300',
    server: true,
    // ClickHouse'ta transaction ve birincil anahtar tekilliği yoktur.
    supports: { rowEditing: false, routines: false, cancel: true, ssl: true, explain: true },
  },
  oracle: {
    label: 'Oracle',
    sslNoNegotiation: true,
    description: 'Oracle Database 12.1+. No Instant Client needed (Thin mode).',
    group: 'server',
    databaseLabel: 'Service name',
    databasePlaceholder: 'FREEPDB1',
    defaultPort: 1521,
    // Oracle'da "veritabanı" servis adıdır (Oracle Free: FREEPDB1).
    defaultDatabase: 'FREEPDB1',
    defaultUsername: 'system',
    color: 'text-rose-400',
    server: true,
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true, explain: true },
  },
  db2i: {
    label: 'IBM i (AS400)',
    sslNoNegotiation: true,
    description:
      'Db2 for i on IBM i (AS400) via IBM JTOpen (jt400). Requires Java 11+ (bundled in the desktop app).',
    group: 'server',
    databaseLabel: 'Default library',
    databasePlaceholder: 'QGPL',
    portHint: 'Database host server port (8471, TLS 9471). Leave the default to use the port mapper.',
    defaultPort: 8471,
    defaultDatabase: 'QGPL',
    defaultUsername: '',
    color: 'text-teal-400',
    server: true,
    // Satır düzenleme commitment control ister: tablolar günlüklenmiş olmalı.
    supports: { rowEditing: true, routines: true, cancel: true, ssl: true, explain: false },
  },
  sqlite: {
    label: 'SQLite',
    description: 'A local SQLite database file.',
    group: 'file',
    databaseLabel: 'Database file',
    databasePlaceholder: '/path/to/database.sqlite',
    defaultPort: 0,
    defaultDatabase: '',
    defaultUsername: '',
    color: 'text-purple-400',
    server: false,
    supports: { rowEditing: true, routines: false, cancel: false, ssl: false, explain: true },
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
