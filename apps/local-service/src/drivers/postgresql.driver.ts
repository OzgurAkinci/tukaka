
import { Client } from 'pg';
import {
  ConnectionProfile,
} from '../connections/connections.service';
import {
  DatabaseDriver,
  DatabaseSchema,
  DatabaseTable,
  QueryResult,
} from './database-driver.interface';

export class PostgreSqlDriver implements DatabaseDriver {
  private createClient(
    connection: ConnectionProfile,
    password: string | null,
  ): Client {
    if (!connection.host || !connection.port || !connection.username) {
      throw new Error('Invalid PostgreSQL connection configuration.');
    }

    if (!password) {
      throw new Error('PostgreSQL password is required.');
    }

    return new Client({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password,
      connectionTimeoutMillis: 10000,
      application_name: 'TUKAKA Database Studio',
      ssl: { rejectUnauthorized: false },
    });
  }

  async testConnection(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<void> {
    const client = this.createClient(connection, password);

    try {
      await client.connect();
      await client.query('SELECT 1');
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async executeQuery(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
    parameters: unknown[] = [],
  ): Promise<QueryResult> {
    const client = this.createClient(connection, password);

    const startedAt = performance.now();

    try {
      await client.connect();

      const result = await client.query(
        sql,
        parameters as any[],
      );

      const durationMs = Math.round(
        performance.now() - startedAt,
      );

      return {
        columns: result.fields.map((field) => field.name),
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? result.rows.length,
        durationMs,
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async getSchemas(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<DatabaseSchema[]> {
    const client = this.createClient(connection, password);

    try {
      await client.connect();

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
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async getTables(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    const client = this.createClient(connection, password);

    try {
      await client.connect();

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
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
