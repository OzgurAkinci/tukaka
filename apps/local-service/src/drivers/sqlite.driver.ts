
import Database from 'better-sqlite3';

import { ConnectionProfile } from '../connections/connections.service';
import {
  CompletionData,
  DatabaseColumn,
  DatabaseDriver,
  DatabaseSchema,
  DatabaseTable,
  QueryOptions,
  QueryResult,
  groupCompletionRows,
} from './database-driver.interface';
import { sqliteDialect } from './sql-dialects';
import { PoolRegistry } from './pool-registry';

import { isBlankSql, splitSqlSegments } from './sql-splitter';

const MULTIPLE_STATEMENTS = /more than one statement/i;
const INCOMPLETE_INPUT = /incomplete input/i;
/** İfade başında transaction kontrolü (BEGIN, COMMIT, END, ROLLBACK, SAVEPOINT, RELEASE). */
const TRANSACTION_CONTROL =
  /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

/** Jest gibi ayrı realm'larda `instanceof Error` güvenilmez; mesajı doğrudan oku. */
const errorText = (error: unknown) =>
  String((error as { message?: unknown })?.message ?? error);

/**
 * Satırları tek tek okuyarak limit aşıldığında durur; böylece büyük
 * tablolarda tüm sonuç belleğe alınmaz.
 */
function readRows(
  statement: Database.Statement,
  parameters: unknown[],
  maxRows: number,
) {
  const rows: Record<string, unknown>[] = [];
  let truncated = false;

  for (const row of statement.iterate(...(parameters as any[]))) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }

    rows.push(row as Record<string, unknown>);
  }

  return {
    columns: statement.columns().map((column) => column.name),
    rows,
    truncated,
  };
}

export class SqliteDriver implements DatabaseDriver {
  readonly dialect = sqliteDialect;

  /** better-sqlite3 senkron çalışır; çalışan sorgu kesilemez. */
  readonly supportsCancel = false;
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
        MULTIPLE_STATEMENTS.test(errorText(error))
      ) {
        return this.executeScript(db, sql, options, startedAt);
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

    const { columns, rows, truncated } = readRows(
      statement,
      parameters,
      options.maxRows,
    );

    return {
      columns,
      rows,
      rowCount: rows.length,
      durationMs: Math.round(performance.now() - startedAt),
      truncated,
      statementCount: 1,
    };
  }

  /**
   * Birden fazla ifade içeren parametresiz betikleri ifade ifade çalıştırır.
   *
   * Son okuma ifadesinin (SELECT) satırları döner; okuma yoksa toplam
   * etkilenen satır sayısı döner. Betik kendi transaction kontrolünü
   * (BEGIN/COMMIT) içermiyorsa tek transaction içinde çalışır ve hata olursa
   * tamamı geri alınır.
   */
  private executeScript(
    db: Database.Database,
    sql: string,
    options: QueryOptions,
    startedAt: number,
  ): QueryResult {
    const segments = splitSqlSegments(sql);
    const managesTransaction = segments.some((segment) =>
      TRANSACTION_CONTROL.test(segment),
    );

    const run = (): QueryResult => {
      let pending = '';
      let statementCount = 0;
      let changes = 0;
      let lastRead: {
        columns: string[];
        rows: Record<string, unknown>[];
        truncated: boolean;
      } | null = null;

      for (const segment of segments) {
        pending += segment;

        if (isBlankSql(pending)) {
          pending = '';
          continue;
        }

        let statement: Database.Statement;

        try {
          statement = db.prepare(pending);
        } catch (error) {
          // Tetikleyici gövdesi gibi yarım kalmış ifade: sonraki parçayla birleştir.
          if (INCOMPLETE_INPUT.test(errorText(error))) {
            continue;
          }

          throw error;
        }

        pending = '';
        statementCount++;

        if (statement.reader) {
          lastRead = readRows(statement, [], options.maxRows);
        } else {
          changes += statement.run().changes;
        }
      }

      if (!isBlankSql(pending)) {
        // Döngü bitti ama ifade hâlâ eksik: SQLite'ın kendi hatasını ver.
        db.prepare(pending);
      }

      const durationMs = Math.round(performance.now() - startedAt);

      return lastRead
        ? {
            ...lastRead,
            rowCount: lastRead.rows.length,
            durationMs,
            statementCount,
          }
        : {
            columns: [],
            rows: [],
            rowCount: changes,
            durationMs,
            truncated: false,
            statementCount,
          };
    };

    return db.inTransaction || managesTransaction
      ? run()
      : db.transaction(run)();
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

  async getCompletionData(
    connection: ConnectionProfile,
    _password: string | null,
    maxColumns: number,
  ): Promise<CompletionData> {
    const db = await this.getDatabase(connection);

    const schemas = (
      db.prepare('PRAGMA database_list').all() as Array<{ name: string }>
    )
      .map((row) => row.name)
      .filter((name) => name !== 'temp');

    const rows: Array<{ schema: string; table: string; column: string }> = [];

    outer: for (const schema of schemas) {
      const escapedSchema = schema.replace(/"/g, '""');

      const tables = db
        .prepare(
          `
          SELECT name FROM "${escapedSchema}".sqlite_master
          WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
        )
        .all() as Array<{ name: string }>;

      for (const { name } of tables) {
        const columns = db
          .prepare(
            `PRAGMA "${escapedSchema}".table_info("${name.replace(/"/g, '""')}")`,
          )
          .all() as Array<{ name: string }>;

        for (const column of columns) {
          rows.push({ schema, table: name, column: column.name });

          if (rows.length > maxColumns) {
            break outer;
          }
        }
      }
    }

    return {
      defaultSchema: 'main',
      ...groupCompletionRows(rows, maxColumns),
    };
  }

  release(connectionId: string): Promise<void> {
    return this.handles.release(connectionId);
  }

  releaseAll(): Promise<void> {
    return this.handles.releaseAll();
  }
}
