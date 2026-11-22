
import { createConnection } from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';

import { ConnectionProfile } from '../connections/connections.service';
import {
  DatabaseDriver,
  DatabaseSchema,
  DatabaseTable,
  QueryResult,
} from './database-driver.interface';

export class MySqlDriver implements DatabaseDriver {
  private async createClient(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<Connection> {
    if (
      !connection.host ||
      !connection.port ||
      !connection.username
    ) {
      throw new Error('Invalid MySQL connection configuration.');
    }

    const ssl =
      connection.ssl_mode === 'require'
        ? { rejectUnauthorized: true }
        : undefined;

    return createConnection({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: password ?? '',
      connectTimeout: 10000,
      ssl,
    });
  }

  async testConnection(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<void> {
    const client = await this.createClient(connection, password);

    try {
      await client.query('SELECT 1');
    } finally {
      await client.end();
    }
  }

  async executeQuery(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
    parameters: unknown[] = [],
  ): Promise<QueryResult> {
    const client = await this.createClient(connection, password);

    const startedAt = performance.now();

    try {
      const [result, fields] = await client.query(
        sql,
        parameters as any[],
      );

      const durationMs = Math.round(
        performance.now() - startedAt,
      );

      const rows = Array.isArray(result)
        ? result as Record<string, unknown>[]
        : [];

      const columns = fields
        ? fields.map((field) => field.name)
        : [];

      const rowCount =
        !Array.isArray(result) && 'affectedRows' in result
          ? result.affectedRows
          : rows.length;

      return {
        columns,
        rows,
        rowCount,
        durationMs,
      };
    } finally {
      await client.end();
    }
  }

  async getSchemas(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<DatabaseSchema[]> {
    const client = await this.createClient(connection, password);

    try {
      const [rows] = await client.query(`
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
    } finally {
      await client.end();
    }
  }

  async getTables(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    const client = await this.createClient(connection, password);

    try {
      const [rows] = await client.execute(
        `
          SELECT
            TABLE_NAME AS name,
            TABLE_SCHEMA AS schema,
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
    } finally {
      await client.end();
    }
  }
}
