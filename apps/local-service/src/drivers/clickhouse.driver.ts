
import { createClient } from '@clickhouse/client';
import type { ClickHouseClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';

import { ConnectionProfile } from '../connections/connections.service';
import {
  CompletionData,
  DatabaseColumn,
  DatabaseDriver,
  DatabaseForeignKey,
  DatabaseIndex,
  DatabaseRoutine,
  DatabaseSchema,
  DatabaseTable,
  ExplainPlanNode,
  ExplainResult,
  groupCompletionRows,
  ParameterizedStatement,
  QueryOptions,
  QueryResult,
  SchemaColumnRow,
} from './database-driver.interface';
import { PoolRegistry } from './pool-registry';
import { clickhouseDialect } from './sql-dialects';
import { isBlankSql, splitSqlSegments, stripTrailingSemicolons } from './sql-splitter';

type Row = Record<string, unknown>;

/** Sonuç döndüren ifadeler (FORMAT JSON eklenebilir); diğerleri `command` ile. */
const READ_STATEMENT = /^\s*(?:\(\s*)?(SELECT|WITH|SHOW|DESCRIBE|DESC|EXISTS|EXPLAIN|CHECK)\b/i;

export function isReadStatement(sql: string): boolean {
  return READ_STATEMENT.test(sql.replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*/, ''));
}

const SYSTEM_DATABASES = ['system', 'INFORMATION_SCHEMA', 'information_schema'];

/**
 * EXPLAIN PLAN çıktısını (her satır 2 boşluk girintili) ağaca çevirir.
 */
export function explainLinesToNodes(lines: string[]): ExplainPlanNode[] {
  const roots: ExplainPlanNode[] = [];
  const stack: Array<{ depth: number; node: ExplainPlanNode }> = [];
  let counter = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    const depth = line.length - line.trimStart().length;
    const text = line.trim();

    // "Expression ((Projection + Before ORDER BY))" gibi satırlarda açıklamayı ayır.
    const match = /^([^(]+?)\s*\((.*)\)$/.exec(text);
    const node: ExplainPlanNode = {
      id: String(++counter),
      label: match ? match[1] : text,
      detail: match ? match[2] : null,
      cost: null,
      rows: null,
      children: [],
    };

    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();

    (stack[stack.length - 1]?.node.children ?? roots).push(node);
    stack.push({ depth, node });
  }

  return roots;
}

export class ClickHouseDriver implements DatabaseDriver {
  readonly dialect = clickhouseDialect;

  readonly supportsCancel = true;

  private readonly clients = new PoolRegistry<ClickHouseClient>((client) => client.close());

  private getClient(connection: ConnectionProfile, password: string | null) {
    return this.clients.get(connection, password, async () => {
      if (!connection.host || !connection.port) {
        throw new Error('Invalid ClickHouse connection configuration.');
      }

      // HTTP arayüzü: SSL kapalı/tercihli ise http, zorunlu ise https.
      const protocol = ['require', 'verify-ca', 'verify-full'].includes(connection.ssl_mode)
        ? 'https'
        : 'http';

      return createClient({
        url: `${protocol}://${connection.host}:${connection.port}`,
        username: connection.username ?? 'default',
        password: password ?? '',
        database: connection.database || 'default',
        request_timeout: 600_000,
        application: 'TUKAKA Database Studio',
      });
    });
  }

  private async rows<T extends Row>(
    connection: ConnectionProfile,
    password: string | null,
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const client = await this.getClient(connection, password);
    const result = await client.query({ query, format: 'JSONEachRow', query_params: params });
    return result.json<T>();
  }

  async testConnection(connection: ConnectionProfile, password: string | null): Promise<void> {
    await this.rows(connection, password, 'SELECT 1 AS ok');
  }

  async executeQuery(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
    parameters: unknown[],
    options: QueryOptions,
  ): Promise<QueryResult> {
    const client = await this.getClient(connection, password);
    const statements = splitSqlSegments(sql)
      .filter((part) => !isBlankSql(part))
      .map(stripTrailingSemicolons);

    if (statements.length === 0) {
      throw new Error('SQL query cannot be empty.');
    }

    const queryParams = Object.fromEntries(
      parameters.map((value, index) => [`p${index + 1}`, value]),
    );

    const controller = new AbortController();
    let currentQueryId: string | null = null;
    let cancelled = false;

    options.onCancelAvailable?.(async () => {
      cancelled = true;
      if (currentQueryId) {
        await client.command({
          query: 'KILL QUERY WHERE query_id = {id:String} ASYNC',
          query_params: { id: currentQueryId },
        });
      }
      controller.abort();
    });

    const settings = {
      max_execution_time: Math.max(1, Math.ceil(options.timeoutMs / 1000)),
    };

    const startedAt = performance.now();
    let last: QueryResult | null = null;

    for (const statement of statements) {
      if (cancelled) break;

      currentQueryId = randomUUID();

      if (isReadStatement(statement)) {
        const result = await client.query({
          query: statement,
          format: 'JSON',
          query_id: currentQueryId,
          query_params: queryParams,
          abort_signal: controller.signal,
          clickhouse_settings: {
            ...settings,
            // Fazlası sunucuda kesilir; böylece büyük sonuçlar belleğe alınmaz.
            max_result_rows: String(options.maxRows + 1),
            result_overflow_mode: 'break',
          },
        });

        const body = await result.json<Row>();
        const allRows = body.data;
        const rows = allRows.slice(0, options.maxRows);

        last = {
          columns: body.meta?.map((column) => column.name) ?? [],
          rows,
          rowCount: rows.length,
          durationMs: 0,
          truncated: allRows.length > rows.length,
          statementCount: statements.length,
        };
      } else {
        const summary = await client.command({
          query: statement,
          query_id: currentQueryId,
          query_params: queryParams,
          abort_signal: controller.signal,
          clickhouse_settings: settings,
        });

        // Okuma sonucu varsa onu koru; yoksa yazma özetini göster.
        if (!last || last.columns.length === 0) {
          last = {
            columns: [],
            rows: [],
            rowCount: Number(summary.summary?.written_rows ?? 0),
            durationMs: 0,
            truncated: false,
            statementCount: statements.length,
          };
        }
      }
    }

    if (cancelled) {
      throw new Error('Query was cancelled.');
    }

    return { ...last!, durationMs: Math.round(performance.now() - startedAt) };
  }

  async getSchemas(connection: ConnectionProfile, password: string | null): Promise<DatabaseSchema[]> {
    return this.rows<DatabaseSchema & Row>(
      connection,
      password,
      'SELECT name FROM system.databases WHERE name NOT IN {skip:Array(String)} ORDER BY name',
      { skip: SYSTEM_DATABASES },
    );
  }

  async getTables(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    const rows = await this.rows<{ name: string; engine: string }>(
      connection,
      password,
      `SELECT name, engine FROM system.tables
       WHERE database = {db:String} AND NOT is_temporary
       ORDER BY name`,
      { db: schema },
    );

    return rows.map((row) => ({
      name: row.name,
      schema,
      type: row.engine.endsWith('View') ? 'view' : 'table',
    }));
  }

  async getColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseColumn[]> {
    const rows = await this.rows<{
      name: string;
      type: string;
      default_expression: string;
      is_in_primary_key: number;
      position: number;
    }>(
      connection,
      password,
      `SELECT name, type, default_expression, is_in_primary_key, position
       FROM system.columns
       WHERE database = {db:String} AND table = {table:String}
       ORDER BY position`,
      { db: schema, table },
    );

    return rows.map((row) => ({
      name: row.name,
      dataType: row.type,
      nullable: row.type.startsWith('Nullable('),
      defaultValue: row.default_expression || null,
      isPrimaryKey: Boolean(Number(row.is_in_primary_key)),
      isForeignKey: false,
      position: Number(row.position),
    }));
  }

  async getCompletionData(
    connection: ConnectionProfile,
    password: string | null,
    maxColumns: number,
  ): Promise<CompletionData> {
    const rows = await this.rows<{ schema: string; table: string; column: string }>(
      connection,
      password,
      `SELECT database AS schema, table, name AS column
       FROM system.columns
       WHERE database NOT IN {skip:Array(String)}
       ORDER BY database, table, position
       LIMIT {limit:UInt32}`,
      { skip: SYSTEM_DATABASES, limit: maxColumns + 1 },
    );

    return {
      defaultSchema: connection.database || 'default',
      ...groupCompletionRows(rows, maxColumns),
    };
  }

  async getIndexes(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseIndex[]> {
    const [info] = await this.rows<{ primary_key: string; sorting_key: string }>(
      connection,
      password,
      `SELECT primary_key, sorting_key FROM system.tables
       WHERE database = {db:String} AND name = {table:String}`,
      { db: schema, table },
    );

    const skipping = await this.rows<{ name: string; expr: string; type: string }>(
      connection,
      password,
      `SELECT name, expr, type FROM system.data_skipping_indices
       WHERE database = {db:String} AND table = {table:String}`,
      { db: schema, table },
    );

    const split = (value: string | undefined) =>
      (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);

    return [
      ...(info?.primary_key
        ? [{ name: 'PRIMARY KEY', columns: split(info.primary_key), unique: false, primary: true }]
        : []),
      ...(info?.sorting_key && info.sorting_key !== info.primary_key
        ? [{ name: 'ORDER BY', columns: split(info.sorting_key), unique: false, primary: false }]
        : []),
      ...skipping.map((index) => ({
        name: `${index.name} (${index.type})`,
        columns: [index.expr],
        unique: false,
        primary: false,
      })),
    ];
  }

  async getForeignKeys(): Promise<DatabaseForeignKey[]> {
    // ClickHouse yabancı anahtar desteklemez.
    return [];
  }

  async getSchemaColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<SchemaColumnRow[]> {
    const rows = await this.rows<{ table: string; name: string; type: string; is_in_primary_key: number }>(
      connection,
      password,
      `SELECT table, name, type, is_in_primary_key FROM system.columns
       WHERE database = {db:String} ORDER BY table, position`,
      { db: schema },
    );

    return rows.map((row) => ({
      table: row.table,
      name: row.name,
      dataType: row.type,
      nullable: row.type.startsWith('Nullable('),
      isPrimaryKey: Boolean(Number(row.is_in_primary_key)),
      isForeignKey: false,
    }));
  }

  async getTableDdl(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<string | null> {
    const [row] = await this.rows<{ create_table_query: string }>(
      connection,
      password,
      `SELECT create_table_query FROM system.tables
       WHERE database = {db:String} AND name = {table:String}`,
      { db: schema, table },
    );

    return row?.create_table_query ?? null;
  }

  async getRoutines(): Promise<DatabaseRoutine[]> {
    return [];
  }

  async getRoutineDefinition(): Promise<string> {
    throw new Error('ClickHouse does not have schema-scoped stored routines.');
  }

  async explain(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
  ): Promise<ExplainResult> {
    const statements = splitSqlSegments(sql).filter((part) => !isBlankSql(part));

    if (statements.length !== 1) {
      throw new Error('EXPLAIN supports exactly one statement.');
    }

    const rows = await this.rows<{ explain: string }>(
      connection,
      password,
      `EXPLAIN PLAN indexes = 1 ${stripTrailingSemicolons(statements[0])}`,
    );
    const lines = rows.map((row) => row.explain);

    return { nodes: explainLinesToNodes(lines), raw: lines.join('\n') };
  }

  async executeInTransaction(
    _connection: ConnectionProfile,
    _password: string | null,
    _statements: ParameterizedStatement[],
  ): Promise<number[]> {
    throw new Error('ClickHouse does not support transactional row editing.');
  }

  release(connectionId: string): Promise<void> {
    return this.clients.release(connectionId);
  }

  releaseAll(): Promise<void> {
    return this.clients.releaseAll();
  }
}
