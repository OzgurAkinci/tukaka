
import { Logger } from '@nestjs/common';
import { createPool } from 'mysql2/promise';
import type {
  FieldPacket,
  Pool,
  PoolConnection,
  PoolOptions,
} from 'mysql2/promise';

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
import { mysqlDialect } from './sql-dialects';
import { PoolRegistry } from './pool-registry';
import { resolveSsl } from './ssl-options';

type StatementResult = {
  rows: Record<string, unknown>[];
  fields: FieldPacket[] | undefined;
  affectedRows: number;
};

function isResultSetHeader(value: unknown): value is { affectedRows: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'affectedRows' in value
  );
}

/**
 * mysql2, `multipleStatements` açıkken birden fazla ifade gönderildiğinde
 * sonuçları ve alanları ifade başına dizi olarak döndürür.
 */
export function normalizeResults(
  result: unknown,
  fields: unknown,
): StatementResult[] {
  const isMulti =
    Array.isArray(fields) &&
    fields.some((item) => item === undefined || Array.isArray(item));

  const toStatement = (
    item: unknown,
    itemFields: FieldPacket[] | undefined,
  ): StatementResult =>
    isResultSetHeader(item)
      ? { rows: [], fields: undefined, affectedRows: item.affectedRows }
      : {
          rows: (Array.isArray(item) ? item : []) as Record<string, unknown>[],
          fields: itemFields,
          affectedRows: 0,
        };

  if (!isMulti) {
    return [toStatement(result, fields as FieldPacket[] | undefined)];
  }

  const results = result as unknown[];
  const fieldSets = fields as Array<FieldPacket[] | undefined>;

  return results.map((item, index) => toStatement(item, fieldSets[index]));
}

export class MySqlDriver implements DatabaseDriver {
  private readonly logger = new Logger(MySqlDriver.name);

  readonly dialect = mysqlDialect;

  readonly supportsCancel = true;

  private readonly pools = new PoolRegistry<Pool>((pool) => pool.end());

  private getPool(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<Pool> {
    return this.pools.get(connection, password, () =>
      this.createPool(connection, password),
    );
  }

  private async createPool(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<Pool> {
    if (!connection.host || !connection.port || !connection.username) {
      throw new Error('Invalid MySQL connection configuration.');
    }

    const { tls, allowFallback } = resolveSsl(connection.ssl_mode);

    const build = (ssl: typeof tls) => {
      const pool = createPool({
        host: connection.host!,
        port: connection.port!,
        database: connection.database,
        user: connection.username!,
        password: password ?? '',
        ssl: ssl ? (ssl as PoolOptions['ssl']) : undefined,
        connectTimeout: 10_000,
        connectionLimit: 5,
        maxIdle: 5,
        idleTimeout: 60_000,
        enableKeepAlive: true,
        multipleStatements: true,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
      });

      pool.on('connection', (poolConnection) => {
        poolConnection.on('error', (error: Error) => {
          this.logger.warn(
            `MySQL connection error (${connection.name}): ${error.message}`,
          );
        });
      });

      return pool;
    };

    const verify = async (pool: Pool) => {
      const poolConnection = await pool.getConnection();
      poolConnection.release();
    };

    const pool = build(tls);

    try {
      await verify(pool);
      return pool;
    } catch (error) {
      await pool.end().catch(() => undefined);

      const code = (error as { code?: string }).code;

      if (tls && allowFallback && code === 'HANDSHAKE_NO_SSL_SUPPORT') {
        const plainPool = build(false);

        try {
          await verify(plainPool);
        } catch (plainError) {
          await plainPool.end().catch(() => undefined);
          throw plainError;
        }

        return plainPool;
      }

      throw error;
    }
  }

  private async withConnection<T>(
    connection: ConnectionProfile,
    password: string | null,
    work: (poolConnection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const pool = await this.getPool(connection, password);
    const poolConnection = await pool.getConnection();

    try {
      return await work(poolConnection);
    } finally {
      poolConnection.release();
    }
  }

  async testConnection(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<void> {
    await this.withConnection(connection, password, (poolConnection) =>
      poolConnection.query('SELECT 1'),
    );
  }

  async executeQuery(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
    parameters: unknown[],
    options: QueryOptions,
  ): Promise<QueryResult> {
    const pool = await this.getPool(connection, password);
    const poolConnection = await pool.getConnection();

    const startedAt = performance.now();
    let destroyConnection = false;
    let active = true;

    if (options.onCancelAvailable) {
      const threadId = poolConnection.threadId;

      // İptal, havuzdaki başka bir bağlantı üzerinden gönderilir.
      options.onCancelAvailable(async () => {
        if (active) {
          await pool.query('KILL QUERY ?', [threadId]);
        }
      });
    }

    try {
      const [result, fields] = await poolConnection.query(
        { sql, timeout: options.timeoutMs },
        parameters as any[],
      );

      const durationMs = Math.round(performance.now() - startedAt);

      const results = normalizeResults(result, fields);

      const statement =
        [...results].reverse().find((item) => item.fields?.length) ??
        results[results.length - 1];

      const isRead = Boolean(statement.fields?.length);
      const rows = statement.rows.slice(0, options.maxRows);

      return {
        columns: statement.fields?.map((field) => field.name) ?? [],
        rows,
        rowCount: isRead ? rows.length : statement.affectedRows,
        durationMs,
        truncated: statement.rows.length > rows.length,
        statementCount: results.length,
      };
    } catch (error) {
      const { code, fatal } = error as { code?: string; fatal?: boolean };

      if (code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
        destroyConnection = true;

        // İstemci tarafı zaman aşımı sunucudaki sorguyu durdurmaz;
        // başka bir bağlantıdan sorguyu sonlandır.
        await pool
          .query('KILL QUERY ?', [poolConnection.threadId])
          .catch(() => undefined);

        throw new Error(
          `Query timed out after ${options.timeoutMs} ms and was cancelled.`,
        );
      }

      if (fatal) {
        destroyConnection = true;
      }

      throw error;
    } finally {
      active = false;

      if (!destroyConnection) {
        // Açık kalan transaction'ı geri al.
        await poolConnection.query('ROLLBACK').catch(() => {
          destroyConnection = true;
        });
      }

      if (destroyConnection) {
        poolConnection.destroy();
      } else {
        poolConnection.release();
      }
    }
  }

  async getSchemas(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<DatabaseSchema[]> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const [rows] = await poolConnection.query(`
        SELECT
          SCHEMA_NAME AS name
        FROM information_schema.SCHEMATA
        WHERE SCHEMA_NAME NOT IN (
          'information_schema',
          'mysql',
          'performance_schema',
          'sys'
        )
        ORDER BY SCHEMA_NAME
      `);

      return rows as DatabaseSchema[];
    });
  }

  async getTables(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const [rows] = await poolConnection.execute(
        `
          SELECT
            TABLE_NAME AS name,
            TABLE_SCHEMA AS \`schema\`,
            CASE
              WHEN TABLE_TYPE = 'VIEW' THEN 'view'
              ELSE 'table'
            END AS type
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ?
            AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
          ORDER BY TABLE_NAME
        `,
        [schema],
      );

      return rows as DatabaseTable[];
    });
  }

  async getColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseColumn[]> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const [rows] = await poolConnection.execute(
        `
          SELECT
            c.COLUMN_NAME AS name,
            c.COLUMN_TYPE AS dataType,
            (c.IS_NULLABLE = 'YES') AS nullable,
            c.COLUMN_DEFAULT AS defaultValue,

            (c.COLUMN_KEY = 'PRI') AS isPrimaryKey,

            EXISTS (
              SELECT 1
              FROM information_schema.KEY_COLUMN_USAGE kcu
              WHERE kcu.TABLE_SCHEMA = c.TABLE_SCHEMA
                AND kcu.TABLE_NAME = c.TABLE_NAME
                AND kcu.COLUMN_NAME = c.COLUMN_NAME
                AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
            ) AS isForeignKey,

            c.ORDINAL_POSITION AS position

          FROM information_schema.COLUMNS c

          WHERE c.TABLE_SCHEMA = ?
            AND c.TABLE_NAME = ?

          ORDER BY c.ORDINAL_POSITION
        `,
        [schema, table],
      );

      return (rows as Array<{
        name: string;
        dataType: string;
        nullable: number;
        defaultValue: string | null;
        isPrimaryKey: number;
        isForeignKey: number;
        position: number;
      }>).map((row) => ({
        name: row.name,
        dataType: row.dataType,
        nullable: Boolean(row.nullable),
        defaultValue: row.defaultValue,
        isPrimaryKey: Boolean(row.isPrimaryKey),
        isForeignKey: Boolean(row.isForeignKey),
        position: Number(row.position),
      }));
    });
  }

  async getCompletionData(
    connection: ConnectionProfile,
    password: string | null,
    maxColumns: number,
  ): Promise<CompletionData> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const [rows] = await poolConnection.query(
        `
          SELECT
            TABLE_SCHEMA AS \`schema\`,
            TABLE_NAME AS \`table\`,
            COLUMN_NAME AS \`column\`
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA NOT IN (
            'information_schema',
            'mysql',
            'performance_schema',
            'sys'
          )
          ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
          LIMIT ?
        `,
        [maxColumns + 1],
      );

      return {
        defaultSchema: connection.database || null,
        ...groupCompletionRows(
          rows as Array<{ schema: string; table: string; column: string }>,
          maxColumns,
        ),
      };
    });
  }

  release(connectionId: string): Promise<void> {
    return this.pools.release(connectionId);
  }

  releaseAll(): Promise<void> {
    return this.pools.releaseAll();
  }
}
