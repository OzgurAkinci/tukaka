
import Database from 'better-sqlite3';

import { ConnectionProfile } from '../connections/connections.service';
import {
  DatabaseColumn,
  DatabaseDriver,
  DatabaseSchema,
  DatabaseTable,
  QueryOptions,
  QueryResult,
} from './database-driver.interface';
import { PoolRegistry } from './pool-registry';

const MULTIPLE_STATEMENTS = /more than one statement/i;

export class SqliteDriver implements DatabaseDriver {
  /**
   * SQLite için havuz yerine bağlantı başına tek, açık tutulan bir handle.
   */
  private readonly handles = new PoolRegistry<Database.Database>(
    async (db) => {
      if (db.open) {
        db.close();
      }
    },
  );

  private getDatabase(
    connection: ConnectionProfile,
  ): Promise<Database.Database> {
    return this.handles.get(connection, null, async () => {
      if (!connection.database) {
        throw new Error('SQLite database file path is required.');
      }

      const db = new Database(connection.database, {
        readonly: false,
        fileMustExist: true,
        // Kilitli veritabanında bekleme süresi (busy timeout).
        timeout: 10_000,
      });

      db.pragma('foreign_keys = ON');

      return db;
    });
  }

  async testConnection(
    connection: ConnectionProfile,
    _password: string | null,
  ): Promise<void> {
    const db = await this.getDatabase(connection);

    db.prepare('SELECT 1').get();
  }

  /**
   * Not: better-sqlite3 senkron çalışır ve çalışan bir sorguyu kesmeyi
   * desteklemez; bu nedenle `timeoutMs` SQLite için uygulanmaz.
   */
  async executeQuery(
    connection: ConnectionProfile,
    _password: string | null,
    sql: string,
    parameters: unknown[],
    options: QueryOptions,
  ): Promise<QueryResult> {
    const db = await this.getDatabase(connection);
    const startedAt = performance.now();

    let statement: Database.Statement;

    try {
      statement = db.prepare(sql);
    } catch (error) {
      if (
        parameters.length === 0 &&
        MULTIPLE_STATEMENTS.test(String((error as { message?: unknown })?.message))
      ) {
        return this.executeScript(db, sql, startedAt);
      }

      throw error;
    }

    if (!statement.reader) {
      const writeResult = statement.run(...(parameters as any[]));

      return {
        columns: [],
        rows: [],
        rowCount: writeResult.changes,
        durationMs: Math.round(performance.now() - startedAt),
        truncated: false,
        statementCount: 1,
      };
    }

    // Satırları tek tek okuyarak limit aşıldığında dur; böylece büyük
    // tablolarda tüm sonuç belleğe alınmaz.
    const rows: Record<string, unknown>[] = [];
    let truncated = false;

    for (const row of statement.iterate(...(parameters as any[]))) {
      if (rows.length >= options.maxRows) {
        truncated = true;
        break;
      }

      rows.push(row as Record<string, unknown>);
    }

    return {
      columns: statement.columns().map((column) => column.name),
      rows,
      rowCount: rows.length,
      durationMs: Math.round(performance.now() - startedAt),
      truncated,
      statementCount: 1,
    };
  }

  /**
   * Birden fazla ifade içeren parametresiz betikleri çalıştırır.
   * Betik tek bir transaction içinde çalışır; hata olursa tamamı geri alınır.
   */
  private executeScript(
    db: Database.Database,
    sql: string,
    startedAt: number,
  ): QueryResult {
    const before = db.prepare('SELECT total_changes() AS total').get() as {
      total: number;
    };

    if (db.inTransaction) {
      db.exec(sql);
    } else {
      db.transaction(() => db.exec(sql))();
    }

    const after = db.prepare('SELECT total_changes() AS total').get() as {
      total: number;
    };

    return {
      columns: [],
      rows: [],
      rowCount: after.total - before.total,
      durationMs: Math.round(performance.now() - startedAt),
      truncated: false,
      statementCount: null,
    };
  }

  async getSchemas(
    connection: ConnectionProfile,
    _password: string | null,
  ): Promise<DatabaseSchema[]> {
    const db = await this.getDatabase(connection);

    const rows = db.prepare('PRAGMA database_list').all() as Array<{
      name: string;
    }>;

    return rows
      .filter((row) => row.name !== 'temp')
      .map((row) => ({
        name: row.name,
      }));
  }

  async getTables(
    connection: ConnectionProfile,
    _password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    const db = await this.getDatabase(connection);

    // Schema adını SQL identifier olarak güvenli şekilde kaçır.
    const escapedSchema = schema.replace(/"/g, '""');

    const rows = db
      .prepare(
        `
        SELECT
          name,
          type
        FROM "${escapedSchema}".sqlite_master
        WHERE type IN ('table', 'view')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
      )
      .all() as Array<{
      name: string;
      type: 'table' | 'view';
    }>;

    return rows.map((row) => ({
      name: row.name,
      schema,
      type: row.type,
    }));
  }

  async getColumns(
    connection: ConnectionProfile,
    _password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseColumn[]> {
    const db = await this.getDatabase(connection);

    // Schema ve tablo isimlerini SQL identifier olarak güvenli şekilde kaçır.
    const escapedSchema = schema.replace(/"/g, '""');
    const escapedTable = table.replace(/"/g, '""');

    const columns = db
      .prepare(`PRAGMA "${escapedSchema}".table_info("${escapedTable}")`)
      .all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;

    const foreignKeys = db
      .prepare(`PRAGMA "${escapedSchema}".foreign_key_list("${escapedTable}")`)
      .all() as Array<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
    }>;

    const foreignKeyColumns = new Set(
      foreignKeys.map((foreignKey) => foreignKey.from),
    );

    return columns.map((column) => ({
      name: column.name,
      dataType: column.type || 'BLOB',
      nullable: column.notnull === 0 && column.pk === 0,
      defaultValue: column.dflt_value,
      isPrimaryKey: column.pk > 0,
      isForeignKey: foreignKeyColumns.has(column.name),
      position: column.cid + 1,
    }));
  }

  release(connectionId: string): Promise<void> {
    return this.handles.release(connectionId);
  }

  releaseAll(): Promise<void> {
    return this.handles.releaseAll();
  }
}
