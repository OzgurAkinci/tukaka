
/**
 * Uygulama veritabanı (studio.sqlite) şema geçişleri.
 *
 * Her geçiş bir kez, sırayla ve kendi transaction'ı içinde çalışır.
 * Uygulanan son sürüm `PRAGMA user_version` içinde tutulur.
 * Yeni bir değişiklik için listeye yeni bir sürüm ekleyin; mevcut
 * geçişleri asla değiştirmeyin.
 */
export interface Migration {
  version: number;
  description: string;
  up: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Connection profiles and app metadata',
    // İlk sürümler user_version kullanmadığı için IF NOT EXISTS ile
    // mevcut veritabanlarında güvenle çalışır.
    up: `
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS connection_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (
          type IN ('postgresql', 'mysql', 'sqlite')
        ),
        host TEXT,
        port INTEGER,
        database TEXT NOT NULL,
        username TEXT,
        credential_key TEXT,
        ssl_mode TEXT NOT NULL DEFAULT 'prefer',
        options_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_connected_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_connection_profiles_name
        ON connection_profiles(name);

      CREATE INDEX IF NOT EXISTS idx_connection_profiles_type
        ON connection_profiles(type);
    `,
  },
  {
    version: 2,
    description: 'Query history and saved queries',
    up: `
      CREATE TABLE IF NOT EXISTS query_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id TEXT
          REFERENCES connection_profiles(id) ON DELETE SET NULL,
        connection_name TEXT,
        sql TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'error')),
        error_message TEXT,
        row_count INTEGER,
        duration_ms INTEGER,
        executed_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_query_history_connection
        ON query_history(connection_id, id DESC);

      CREATE TABLE IF NOT EXISTS saved_queries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        connection_id TEXT
          REFERENCES connection_profiles(id) ON DELETE SET NULL,
        sql TEXT NOT NULL,
        created_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_saved_queries_name
        ON saved_queries(name COLLATE NOCASE);
    `,
  },
];
