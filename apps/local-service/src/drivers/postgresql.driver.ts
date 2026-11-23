
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { PoolClient, QueryResult as PgQueryResult } from 'pg';

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
import { resolveSsl } from './ssl-options';

const NO_SSL_SUPPORT = /does not support SSL/i;

export class PostgreSqlDriver implements DatabaseDriver {
  private readonly logger = new Logger(PostgreSqlDriver.name);

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
      throw new Error('Invalid PostgreSQL connection configuration.');
    }

    if (!password) {
      throw new Error('PostgreSQL password is required.');
    }

    const { tls, allowFallback } = resolveSsl(connection.ssl_mode);

    const build = (ssl: typeof tls) => {
      const pool = new Pool({
        host: connection.host!,
        port: connection.port!,
        database: connection.database,
        user: connection.username!,
        password,
        ssl,
        max: 5,
        idleTimeoutMillis: 60_000,
        connectionTimeoutMillis: 10_000,
        application_name: 'TUKAKA Database Studio',
      });

      // Boştaki bir istemcide oluşan hata (ör. sunucu yeniden başladı)
      // yakalanmazsa tüm servisi düşürür.
      pool.on('error', (error) => {
        this.logger.warn(
          `Idle PostgreSQL client error (${connection.name}): ${error.message}`,
        );
      });

      return pool;
    };

    const pool = build(tls);

    try {
      // İlk bağlantıyı burada kurarak SSL ayarını doğrula.
      const client = await pool.connect();
      client.release();
      return pool;
    } catch (error) {
      await pool.end().catch(() => undefined);

      if (
        tls &&
        allowFallback &&
        error instanceof Error &&
        NO_SSL_SUPPORT.test(error.message)
      ) {
        const plainPool = build(false);
        const client = await plainPool.connect().catch(async (plainError) => {
          await plainPool.end().catch(() => undefined);
          throw plainError;
        });
        client.release();
        return plainPool;
      }

      throw error;
    }
  }

  private async withClient<T>(
    connection: ConnectionProfile,
    password: string | null,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = await this.getPool(connection, password);
    const client = await pool.connect();

    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  async testConnection(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<void> {
    await this.withClient(connection, password, (client) =>
      client.query('SELECT 1'),
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
    const client = await pool.connect();

    const startedAt = performance.now();
    let destroyClient = false;

    try {
      await client.query(
        `SET statement_timeout = ${Math.max(0, Math.floor(options.timeoutMs))}`,
      );

      // Parametresiz sorgular "simple query" protokolüyle gider ve birden fazla
      // ifade içerebilir; bu durumda pg bir dizi döndürür.
      const raw: PgQueryResult | PgQueryResult[] =
        parameters.length > 0
          ? await client.query(sql, parameters as unknown[])
          : await (client.query(sql) as Promise<
              PgQueryResult | PgQueryResult[]
            >);

      const durationMs = Math.round(performance.now() - startedAt);

      const results = Array.isArray(raw) ? raw : [raw];

      // Son ifadenin sonucunu göster; varsa kolon döndüren son ifadeyi tercih et.
      const result =
        [...results].reverse().find((item) => item.fields?.length > 0) ??
        results[results.length - 1];

      const fields = result?.fields ?? [];
      const allRows = (result?.rows ?? []) as Record<string, unknown>[];
      const isRead = fields.length > 0;
      const rows = allRows.slice(0, options.maxRows);

      return {
        columns: fields.map((field) => field.name),
        rows,
        rowCount: isRead ? rows.length : (result?.rowCount ?? 0),
        durationMs,
        truncated: allRows.length > rows.length,
        statementCount: results.length,
      };
    } finally {
      // Havuza dönen bağlantı, yeni açılmış bir bağlantı gibi temiz olmalı:
      // açık kalan transaction geri alınır, oturum ayarları sıfırlanır.
      try {
        await client.query('ROLLBACK');
        await client.query('DISCARD ALL');
      } catch {
        destroyClient = true;
      }

      client.release(destroyClient);
    }
  }

  async getSchemas(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<DatabaseSchema[]> {
    return this.withClient(connection, password, async (client) => {
      const result = await client.query(`
        SELECT
          schema_name AS name
        FROM information_schema.schemata
        WHERE schema_name NOT IN (
          'pg_catalog',
          'information_schema'
        )
        AND schema_name NOT LIKE 'pg_toast%'
        ORDER BY schema_name
      `);

      return result.rows as DatabaseSchema[];
    });
  }

  async getTables(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    return this.withClient(connection, password, async (client) => {
      const result = await client.query(
        `
          SELECT
            table_name AS name,
            table_schema AS schema,
            CASE
              WHEN table_type = 'VIEW' THEN 'view'
              ELSE 'table'
            END AS type
          FROM information_schema.tables
          WHERE table_schema = $1
            AND table_type IN ('BASE TABLE', 'VIEW')
          ORDER BY table_name
        `,
        [schema],
      );

      return result.rows as DatabaseTable[];
    });
  }

  async getColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseColumn[]> {
    return this.withClient(connection, password, async (client) => {
      const result = await client.query(
        `
          SELECT
            c.column_name AS name,
            c.data_type AS "dataType",
            (c.is_nullable = 'YES') AS nullable,
            c.column_default AS "defaultValue",

            EXISTS (
              SELECT 1
              FROM information_schema.table_constraints tc
              INNER JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.constraint_schema = kcu.constraint_schema
                AND tc.table_schema = kcu.table_schema
                AND tc.table_name = kcu.table_name
              WHERE tc.constraint_type = 'PRIMARY KEY'
                AND tc.table_schema = c.table_schema
                AND tc.table_name = c.table_name
                AND kcu.column_name = c.column_name
            ) AS "isPrimaryKey",

            EXISTS (
              SELECT 1
              FROM information_schema.table_constraints tc
              INNER JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.constraint_schema = kcu.constraint_schema
                AND tc.table_schema = kcu.table_schema
                AND tc.table_name = kcu.table_name
              WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_schema = c.table_schema
                AND tc.table_name = c.table_name
                AND kcu.column_name = c.column_name
            ) AS "isForeignKey",

            c.ordinal_position AS position

          FROM information_schema.columns c

          WHERE c.table_schema = $1
            AND c.table_name = $2

          ORDER BY c.ordinal_position
        `,
        [schema, table],
      );

      return result.rows.map((row) => ({
        name: row.name,
        dataType: row.dataType,
        nullable: row.nullable,
        defaultValue: row.defaultValue,
        isPrimaryKey: row.isPrimaryKey,
        isForeignKey: row.isForeignKey,
        position: Number(row.position),
      }));
    });
  }

  release(connectionId: string): Promise<void> {
    return this.pools.release(connectionId);
  }

  releaseAll(): Promise<void> {
    return this.pools.releaseAll();
  }
}
