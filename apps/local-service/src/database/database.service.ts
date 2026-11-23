
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

import { migrations } from './migrations';

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

  /**
   * Bekleyen şema geçişlerini sırayla uygular.
   */
  private initializeSchema(): void {
    const currentVersion = this.database.pragma('user_version', {
      simple: true,
    }) as number;

    const pending = migrations
      .filter((migration) => migration.version > currentVersion)
      .sort((a, b) => a.version - b.version);

    for (const migration of pending) {
      this.database.transaction(() => {
        this.database.exec(migration.up);
        this.database.pragma(`user_version = ${migration.version}`);
      })();

      this.logger.log(
        `Applied migration ${migration.version}: ${migration.description}`,
      );
    }

    const latestVersion = Math.max(
      currentVersion,
      ...migrations.map((migration) => migration.version),
    );

    this.database
      .prepare(
        `
        INSERT INTO app_metadata (key, value)
        VALUES ('database_version', @version)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run({ version: String(latestVersion) });
  }
}
