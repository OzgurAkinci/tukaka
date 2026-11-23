
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
  DatabaseForeignKey,
  DatabaseIndex,
  DatabaseRoutine,
  ExplainPlanNode,
  ExplainResult,
  ParameterizedStatement,
  SchemaColumnRow,
  DatabaseSchema,
  DatabaseTable,
  QueryOptions,
  QueryResult,
  assertAffectedRows,
  groupCompletionRows,
} from './database-driver.interface';
import { mysqlDialect } from './sql-dialects';
import {
  isBlankSql,
  splitSqlSegments,
  stripTrailingSemicolons,
} from './sql-splitter';
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

/** EXPLAIN FORMAT=JSON çıktısında alt düğüm olarak gezilmeyecek alanlar. */
const MYSQL_PLAN_SKIP = new Set([
  'cost_info',
  'used_columns',
  'possible_keys',
  'used_key_parts',
  'ref',
  'key',
  'key_length',
  'attached_condition',
  'message',
  'select_id',
  'filtered',
]);

let mysqlPlanCounter = 0;

const planText = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value);

/**
 * MySQL/MariaDB EXPLAIN FORMAT=JSON çıktısını genel plan ağacına çevirir.
 */
export function mysqlPlanToNode(
  value: Record<string, unknown>,
  name = 'query_block',
): ExplainPlanNode {
  if (name === 'query_block' && value.query_block) {
    return mysqlPlanToNode(value.query_block as Record<string, unknown>, name);
  }

  const cost = value.cost_info as Record<string, string> | undefined;
  const table = value.table_name as string | undefined;

  const details = [
    value.key ? `key ${planText(value.key)}` : null,
    value.attached_condition ? `filter: ${planText(value.attached_condition)}` : null,
    value.message ? planText(value.message) : null,
  ].filter(Boolean);

  const children: ExplainPlanNode[] = [];

  for (const [key, child] of Object.entries(value)) {
    if (MYSQL_PLAN_SKIP.has(key) || child === null || typeof child !== 'object') {
      continue;
    }

    const items = Array.isArray(child) ? child : [child];

    for (const item of items) {
      if (item === null || typeof item !== 'object') continue;

      const record = item as Record<string, unknown>;

      // nested_loop: [{ table: {...} }, ...]
      if (record.table && typeof record.table === 'object' && Object.keys(record).length === 1) {
        children.push(mysqlPlanToNode(record.table as Record<string, unknown>, 'table'));
      } else {
        children.push(mysqlPlanToNode(record, key));
      }
    }
  }

  const costValue = Number(cost?.query_cost ?? cost?.prefix_cost ?? cost?.read_cost);
  const rowsValue = Number(
    value.rows_examined_per_scan ?? value.rows_produced_per_join ?? value.rows,
  );

  return {
    id: String(++mysqlPlanCounter),
    label: table
      ? `${planText(value.access_type ?? 'scan').toUpperCase()} ${table}`
      : name.replace(/_/g, ' '),
    detail: details.length ? details.join(' · ') : null,
    cost: Number.isFinite(costValue) ? costValue : null,
    rows: Number.isFinite(rowsValue) ? rowsValue : null,
    children,
  };
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

  async getIndexes(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseIndex[]> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const [rows] = await poolConnection.execute(
        `
          SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName
          FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX
        `,
        [schema, table],
      );

      const indexes = new Map<string, DatabaseIndex>();

      for (const row of rows as Array<{
        name: string;
        nonUnique: number | string;
        columnName: string | null;
      }>) {
        const index = indexes.get(row.name) ?? {
          name: row.name,
          columns: [],
          unique: Number(row.nonUnique) === 0,
          primary: row.name === 'PRIMARY',
        };

        index.columns.push(row.columnName ?? '(expression)');
        indexes.set(row.name, index);
      }

      return [...indexes.values()];
    });
  }

  async getForeignKeys(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table?: string,
  ): Promise<DatabaseForeignKey[]> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const [rows] = await poolConnection.execute(
        `
          SELECT
            CONSTRAINT_NAME AS name,
            TABLE_NAME AS tableName,
            COLUMN_NAME AS columnName,
            REFERENCED_TABLE_SCHEMA AS referencedSchema,
            REFERENCED_TABLE_NAME AS referencedTable,
            REFERENCED_COLUMN_NAME AS referencedColumn
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ?
            AND REFERENCED_TABLE_NAME IS NOT NULL
            AND (? IS NULL OR TABLE_NAME = ?)
          ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
        `,
        [schema, table ?? null, table ?? null],
      );

      const keys = new Map<string, DatabaseForeignKey>();

      for (const row of rows as Array<{
        name: string;
        tableName: string;
        columnName: string;
        referencedSchema: string;
        referencedTable: string;
        referencedColumn: string;
      }>) {
        const id = `${row.tableName}.${row.name}`;
        const key = keys.get(id) ?? {
          name: row.name,
          table: row.tableName,
          columns: [],
          referencedSchema: row.referencedSchema,
          referencedTable: row.referencedTable,
          referencedColumns: [],
        };

        key.columns.push(row.columnName);
        key.referencedColumns.push(row.referencedColumn);
        keys.set(id, key);
      }

      return [...keys.values()];
    });
  }

  async getSchemaColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<SchemaColumnRow[]> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const [rows] = await poolConnection.execute(
        `
          SELECT
            TABLE_NAME AS tableName,
            COLUMN_NAME AS name,
            COLUMN_TYPE AS dataType,
            (IS_NULLABLE = 'YES') AS nullable,
            (COLUMN_KEY = 'PRI') AS isPrimaryKey
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME, ORDINAL_POSITION
        `,
        [schema],
      );

      return (rows as Array<{
        tableName: string;
        name: string;
        dataType: string;
        nullable: number;
        isPrimaryKey: number;
      }>).map((row) => ({
        table: row.tableName,
        name: row.name,
        dataType: row.dataType,
        nullable: Boolean(Number(row.nullable)),
        isPrimaryKey: Boolean(Number(row.isPrimaryKey)),
        isForeignKey: false,
      }));
    });
  }

  async getTableDdl(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<string | null> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const quote = this.dialect.quoteIdentifier;

      try {
        const [rows] = await poolConnection.query(
          `SHOW CREATE TABLE ${quote(schema)}.${quote(table)}`,
        );
        const row = (rows as Array<Record<string, string>>)[0];

        return row?.['Create Table'] ?? row?.['Create View'] ?? null;
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_NO_SUCH_TABLE') return null;
        throw error;
      }
    });
  }

  async getRoutines(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseRoutine[]> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const [rows] = await poolConnection.execute(
        `
          SELECT
            ROUTINE_NAME AS name,
            ROUTINE_SCHEMA AS \`schema\`,
            LOWER(ROUTINE_TYPE) AS type,
            DTD_IDENTIFIER AS returnType
          FROM information_schema.ROUTINES
          WHERE ROUTINE_SCHEMA = ?
          ORDER BY ROUTINE_NAME
        `,
        [schema],
      );

      return (rows as Array<Omit<DatabaseRoutine, 'id' | 'arguments'>>).map(
        (row) => ({
          ...row,
          // MySQL'de aşırı yükleme yoktur; ad yeterince benzersizdir.
          id: `${row.type}:${row.name}`,
          arguments: null,
        }),
      );
    });
  }

  async getRoutineDefinition(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    routine: Pick<DatabaseRoutine, 'id' | 'name' | 'type'>,
  ): Promise<string> {
    return this.withConnection(connection, password, async (poolConnection) => {
      const quote = this.dialect.quoteIdentifier;
      const kind = routine.type === 'procedure' ? 'PROCEDURE' : 'FUNCTION';
      const [rows] = await poolConnection.query(
        `SHOW CREATE ${kind} ${quote(schema)}.${quote(routine.name)}`,
      );
      const row = (rows as Array<Record<string, string | null>>)[0];
      const definition = row?.[`Create ${kind === 'PROCEDURE' ? 'Procedure' : 'Function'}`];

      if (!definition) {
        throw new Error(
          'Routine definition is not available (it may require additional privileges).',
        );
      }

      return definition;
    });
  }

  async explain(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
  ): Promise<ExplainResult> {
    // Havuz `multipleStatements` ile açılır; EXPLAIN'e ikinci bir ifade
    // eklenip çalıştırılmasını önlemek için tek ifade şartı koşulur.
    const statements = splitSqlSegments(sql).filter((part) => !isBlankSql(part));

    if (statements.length !== 1) {
      throw new Error('EXPLAIN supports exactly one statement.');
    }

    return this.withConnection(connection, password, async (poolConnection) => {
      const [rows] = await poolConnection.query({
        sql: `EXPLAIN FORMAT=JSON ${stripTrailingSemicolons(statements[0])}`,
        timeout: 30_000,
      });

      const raw = (rows as Array<Record<string, string>>)[0]?.EXPLAIN ?? '{}';

      return {
        nodes: [mysqlPlanToNode(JSON.parse(raw) as Record<string, unknown>)],
        raw: JSON.stringify(JSON.parse(raw), null, 2),
      };
    });
  }

  async executeInTransaction(
    connection: ConnectionProfile,
    password: string | null,
    statements: ParameterizedStatement[],
  ): Promise<number[]> {
    return this.withConnection(connection, password, async (poolConnection) => {
      await poolConnection.beginTransaction();

      try {
        const affected: number[] = [];

        for (const [index, statement] of statements.entries()) {
          const [result] = await poolConnection.query(
            statement.sql,
            statement.parameters as any[],
          );
          const count = isResultSetHeader(result) ? result.affectedRows : 0;
          assertAffectedRows(statement, count, index);
          affected.push(count);
        }

        await poolConnection.commit();
        return affected;
      } catch (error) {
        await poolConnection.rollback().catch(() => undefined);
        throw error;
      }
    });
  }

  release(connectionId: string): Promise<void> {
    return this.pools.release(connectionId);
  }

  releaseAll(): Promise<void> {
    return this.pools.releaseAll();
  }
}
