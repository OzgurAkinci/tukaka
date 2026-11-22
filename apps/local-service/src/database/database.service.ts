
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

@Injectable()
export class DatabaseService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);

  private database!: DatabaseType;

  onModuleInit(): void {
    const dataDirectory = this.getDataDirectory();

    fs.mkdirSync(dataDirectory, { recursive: true });

    const databasePath = path.join(
      dataDirectory,
      'studio.sqlite',
    );

    this.database = new Database(databasePath);

    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');

    this.initializeSchema();

    this.logger.log(`SQLite database: ${databasePath}`);
  }

  onModuleDestroy(): void {
    if (this.database?.open) {
      this.database.close();
      this.logger.log('SQLite database connection closed.');
    }
  }

  getDatabase(): DatabaseType {
    if (!this.database?.open) {
      throw new Error('Database connection is not available.');
    }

    return this.database;
  }

  private getDataDirectory(): string {
    if (process.env.TUKAKA_DATA_DIR) {
      return path.resolve(process.env.TUKAKA_DATA_DIR);
    }

    const homeDirectory = os.homedir();

    switch (process.platform) {
      case 'darwin':
        return path.join(
          homeDirectory,
          'Library',
          'Application Support',
          'TUKAKA Database Studio',
        );

      case 'win32':
        return path.join(
          process.env.APPDATA ||
            path.join(homeDirectory, 'AppData', 'Roaming'),
          'TUKAKA Database Studio',
        );

      default:
        return path.join(
          process.env.XDG_DATA_HOME ||
            path.join(homeDirectory, '.local', 'share'),
          'tukaka-database-studio',
        );
    }
  }

  
    private initializeSchema(): void {
    this.database.exec(`
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
    `);

    this.database
        .prepare(`
        INSERT INTO app_metadata (key, value)
        VALUES ('database_version', '2')
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        `)
        .run();
    }

}
