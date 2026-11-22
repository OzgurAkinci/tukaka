
import Database from 'better-sqlite3';

import { ConnectionProfile } from '../connections/connections.service';
import {
  DatabaseDriver,
  DatabaseSchema,
  DatabaseTable,
  QueryResult,
} from './database-driver.interface';

export class SqliteDriver implements DatabaseDriver {
  private createClient(connection: ConnectionProfile): Database.Database {
    if (!connection.database) {
      throw new Error('SQLite database file path is required.');
    }

    return new Database(connection.database, {
      readonly: false,
      fileMustExist: true,
      timeout: 10000,
    });
  }

  async testConnection(
    connection: ConnectionProfile,
    _password: string | null,
  ): Promise<void> {
    const db = this.createClient(connection);

    try {
      db.prepare('SELECT 1').get();
    } finally {
      db.close();
    }
  }

  async executeQuery(
    connection: ConnectionProfile,
    _password: string | null,
    sql: string,
    parameters: unknown[] = [],
  ): Promise<QueryResult> {
    const db = this.createClient(connection);
    const startedAt = performance.now();

    try {
      const statement = db.prepare(sql);

      const result = statement.reader
        ? statement.all(...parameters as any[])
        : [];

      let rowCount: number;

      if (statement.reader) {
        rowCount = result.length;
      } else {
        const writeResult = statement.run(...parameters as any[]);
        rowCount = writeResult.changes;
      }

      const columns = statement.columns().map(
        (column) => column.name,
      );

      return {
        columns,
        rows: result as Record<string, unknown>[],
        rowCount,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } finally {
      db.close();
    }
  }

  async getSchemas(
    connection: ConnectionProfile,
    _password: string | null,
  ): Promise<DatabaseSchema[]> {
    const db = this.createClient(connection);

    try {
      const rows = db.prepare(`
        PRAGMA database_list
      `).all() as Array<{ name: string }>;

      return rows
        .filter((row) => row.name !== 'temp')
        .map((row) => ({
          name: row.name,
        }));
    } finally {
      db.close();
    }
  }

  async getTables(
    connection: ConnectionProfile,
    _password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    const db = this.createClient(connection);

    try {
      // Schema adını SQL identifier olarak güvenli şekilde kaçır.
      const escapedSchema = schema.replace(/"/g, '""');

      const rows = db.prepare(`
        SELECT
          name,
          type
        FROM "${escapedSchema}".sqlite_master
        WHERE type IN ('table', 'view')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as Array<{
        name: string;
        type: 'table' | 'view';
      }>;

      return rows.map((row) => ({
        name: row.name,
        schema,
        type: row.type,
      }));
    } finally {
      db.close();
    }
  }
}
