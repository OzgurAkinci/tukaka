
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
  /**
   * Tablo yeniden kurulurken (SQLite'ta CHECK kısıtını değiştirmenin tek yolu)
   * yabancı anahtar eylemlerinin (ON DELETE SET NULL) tetiklenmemesi için.
   */
  disableForeignKeys?: boolean;
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
  {
    version: 3,
    description: 'Allow MariaDB, SQL Server and ClickHouse connections',
    disableForeignKeys: true,
    up: `
      CREATE TABLE connection_profiles_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (
          type IN ('postgresql', 'mysql', 'mariadb', 'sqlite', 'mssql', 'clickhouse')
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

      INSERT INTO connection_profiles_new (
        id, name, type, host, port, database, username, credential_key,
        ssl_mode, options_json, created_at, updated_at, last_connected_at
      )
      SELECT
        id, name, type, host, port, database, username, credential_key,
        ssl_mode, options_json, created_at, updated_at, last_connected_at
      FROM connection_profiles;

      DROP TABLE connection_profiles;
      ALTER TABLE connection_profiles_new RENAME TO connection_profiles;

      CREATE INDEX IF NOT EXISTS idx_connection_profiles_name
        ON connection_profiles(name);

      CREATE INDEX IF NOT EXISTS idx_connection_profiles_type
        ON connection_profiles(type);
    `,
  },
  {
    version: 4,
    description: 'Known SSH host keys (trust on first use)',
    up: `
      CREATE TABLE IF NOT EXISTS ssh_known_hosts (
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        key_type TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (host, port)
      );
    `,
  },
  {
    version: 5,
    description: 'Allow Oracle connections',
    disableForeignKeys: true,
    up: `
      CREATE TABLE connection_profiles_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (
          type IN ('postgresql', 'mysql', 'mariadb', 'sqlite', 'mssql', 'clickhouse', 'oracle')
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

      INSERT INTO connection_profiles_new (
        id, name, type, host, port, database, username, credential_key,
        ssl_mode, options_json, created_at, updated_at, last_connected_at
      )
      SELECT
        id, name, type, host, port, database, username, credential_key,
        ssl_mode, options_json, created_at, updated_at, last_connected_at
      FROM connection_profiles;

      DROP TABLE connection_profiles;
      ALTER TABLE connection_profiles_new RENAME TO connection_profiles;

      CREATE INDEX IF NOT EXISTS idx_connection_profiles_name
        ON connection_profiles(name);

      CREATE INDEX IF NOT EXISTS idx_connection_profiles_type
        ON connection_profiles(type);
    `,
  },
  {
    version: 6,
    description: 'Validate connection types in the application instead of a CHECK constraint',
    // Her yeni veritabanı tipi için tabloyu yeniden kurmamak adına CHECK kaldırılır;
    // tipler CreateConnectionDto'da doğrulanır.
    disableForeignKeys: true,
    up: `
      CREATE TABLE connection_profiles_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
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

      INSERT INTO connection_profiles_new (
        id, name, type, host, port, database, username, credential_key,
        ssl_mode, options_json, created_at, updated_at, last_connected_at
      )
      SELECT
        id, name, type, host, port, database, username, credential_key,
        ssl_mode, options_json, created_at, updated_at, last_connected_at
      FROM connection_profiles;

      DROP TABLE connection_profiles;
      ALTER TABLE connection_profiles_new RENAME TO connection_profiles;

      CREATE INDEX IF NOT EXISTS idx_connection_profiles_name
        ON connection_profiles(name);

      CREATE INDEX IF NOT EXISTS idx_connection_profiles_type
        ON connection_profiles(type);
    `,
  },
  {
    version: 7,
    description: 'Connection collections',
    up: `
      CREATE TABLE IF NOT EXISTS connection_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE connection_profiles
        ADD COLUMN collection_id TEXT
          REFERENCES connection_collections(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_connection_profiles_collection
        ON connection_profiles(collection_id);
    `,
  },
];
