
import { Logger } from '@nestjs/common';
import sql from 'mssql';
import type { config as MssqlConfig, IRecordSet } from 'mssql';

import { ConnectionProfile } from '../connections/connections.service';
import {
  assertAffectedRows,
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
import { mssqlDialect } from './sql-dialects';

type Row = Record<string, unknown>;

/** SSL modunu tedious şifreleme ayarlarına çevirir. */
function encryption(mode: string): Pick<NonNullable<MssqlConfig['options']>, 'encrypt' | 'trustServerCertificate'> {
  switch (mode) {
    case 'disable':
      return { encrypt: false, trustServerCertificate: true };
    case 'verify-ca':
    case 'verify-full':
      return { encrypt: true, trustServerCertificate: false };
    case 'require':
    case 'prefer':
    default:
      return { encrypt: true, trustServerCertificate: true };
  }
}

/**
 * `mssql` çoklu sonuç kümesi döndürür; kolon sırası `columns` meta verisinden
 * alınır (nesne anahtar sırası güvenilir değildir).
 */
export function recordsetColumns(recordset: IRecordSet<Row> | undefined): string[] {
  if (!recordset?.columns) return [];

  return Object.values(recordset.columns)
    .sort((a, b) => a.index - b.index)
    .map((column) => column.name);
}

interface ShowplanRow {
  NodeId: number;
  Parent: number;
  PhysicalOp: string | null;
  LogicalOp: string | null;
  Argument: string | null;
  StmtText: string;
  EstimateRows: number | null;
  TotalSubtreeCost: number | null;
  Type: string;
}

/** SET SHOWPLAN_ALL satırlarını (NodeId/Parent) ağaca çevirir. */
export function showplanToNodes(rows: ShowplanRow[]): ExplainPlanNode[] {
  const nodes = new Map<number, ExplainPlanNode>();
  const roots: ExplainPlanNode[] = [];
  let statement = 0;

  for (const row of rows) {
    // Her ifade kendi NodeId sırasını yeniden başlatır.
    if (row.Parent === 0 && !row.PhysicalOp) statement++;

    const node: ExplainPlanNode = {
      id: `${statement}:${row.NodeId}`,
      label: row.PhysicalOp
        ? row.LogicalOp && row.LogicalOp !== row.PhysicalOp
          ? `${row.PhysicalOp} (${row.LogicalOp})`
          : row.PhysicalOp
        : row.StmtText.trim().slice(0, 200),
      detail: row.PhysicalOp ? row.Argument : null,
      cost: row.TotalSubtreeCost,
      rows: row.EstimateRows,
      children: [],
    };

    nodes.set(row.NodeId, node);

    const parent = row.Parent ? nodes.get(row.Parent) : undefined;
    (parent?.children ?? roots).push(node);
  }

  return roots;
}

export class MssqlDriver implements DatabaseDriver {
  private readonly logger = new Logger(MssqlDriver.name);

  readonly dialect = mssqlDialect;

  readonly supportsCancel = true;

  private readonly pools = new PoolRegistry<sql.ConnectionPool>((pool) => pool.close());

  private config(
    connection: ConnectionProfile,
    password: string | null,
    poolSize = 5,
  ): MssqlConfig {
    if (!connection.host || !connection.port || !connection.username) {
      throw new Error('Invalid SQL Server connection configuration.');
    }

    return {
      server: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: password ?? '',
      connectionTimeout: 10_000,
      // Sorgu zaman aşımı istek başına uygulanır (bkz. executeQuery).
      requestTimeout: 0,
      pool: { max: poolSize, min: 0, idleTimeoutMillis: 60_000 },
      options: {
        ...encryption(connection.ssl_mode),
        appName: 'TUKAKA Database Studio',
      },
    };
  }

  private getPool(connection: ConnectionProfile, password: string | null) {
    return this.pools.get(connection, password, async () => {
      const pool = new sql.ConnectionPool(this.config(connection, password));

      pool.on('error', (error: Error) => {
        this.logger.warn(`SQL Server pool error (${connection.name}): ${error.message}`);
      });

      await pool.connect();
      return pool;
    });
  }

  private async query<T extends Row>(
    connection: ConnectionProfile,
    password: string | null,
    text: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    const pool = await this.getPool(connection, password);
    const request = pool.request();

    parameters.forEach((value, index) => request.input(`p${index + 1}`, value));

    const result = await request.query<T>(text);
    return result.recordset ?? [];
  }

  async testConnection(connection: ConnectionProfile, password: string | null): Promise<void> {
    await this.query(connection, password, 'SELECT 1 AS ok');
  }

  async executeQuery(
    connection: ConnectionProfile,
    password: string | null,
    text: string,
    parameters: unknown[],
    options: QueryOptions,
  ): Promise<QueryResult> {
    const pool = await this.getPool(connection, password);
    const request = pool.request();

    parameters.forEach((value, index) => request.input(`p${index + 1}`, value));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      request.cancel();
    }, options.timeoutMs);

    options.onCancelAvailable?.(async () => request.cancel());

    const startedAt = performance.now();

    try {
      // Havuza dönen bağlantıda açık transaction kalmasın.
      const result = await request.query<Row>(
        `${text}\n;IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;`,
      );

      const durationMs = Math.round(performance.now() - startedAt);
      const recordsets = (result.recordsets ?? []) as IRecordSet<Row>[];
      const last = [...recordsets].reverse().find((set) => recordsetColumns(set).length > 0);
      const allRows = last ? [...last] : [];
      const rows = allRows.slice(0, options.maxRows);
      const affected = (result.rowsAffected ?? []).reduce((sum, count) => sum + count, 0);

      return {
        columns: recordsetColumns(last),
        rows,
        rowCount: last ? rows.length : affected,
        durationMs,
        truncated: allRows.length > rows.length,
        statementCount: Math.max(recordsets.length, result.rowsAffected?.length ?? 0) || 1,
      };
    } catch (error) {
      if (timedOut) {
        throw new Error(`Query timed out after ${options.timeoutMs} ms and was cancelled.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getSchemas(connection: ConnectionProfile, password: string | null): Promise<DatabaseSchema[]> {
    return this.query<DatabaseSchema & Row>(
      connection,
      password,
      `
        SELECT s.name
        FROM sys.schemas s
        WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
          AND s.name NOT LIKE 'db[_]%'
        ORDER BY s.name
      `,
    );
  }

  async getTables(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    return this.query<DatabaseTable & Row>(
      connection,
      password,
      `
        SELECT
          TABLE_NAME AS name,
          TABLE_SCHEMA AS [schema],
          CASE WHEN TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS type
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = @p1
        ORDER BY TABLE_NAME
      `,
      [schema],
    );
  }

  async getColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseColumn[]> {
    const rows = await this.query<Row>(
      connection,
      password,
      `
        SELECT
          c.COLUMN_NAME AS name,
          c.DATA_TYPE +
            CASE
              WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN '(max)'
              WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN '(' + CAST(c.CHARACTER_MAXIMUM_LENGTH AS varchar(10)) + ')'
              WHEN c.DATA_TYPE IN ('decimal', 'numeric') THEN '(' + CAST(c.NUMERIC_PRECISION AS varchar(10)) + ',' + CAST(c.NUMERIC_SCALE AS varchar(10)) + ')'
              ELSE ''
            END AS dataType,
          CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
          c.COLUMN_DEFAULT AS defaultValue,
          CASE WHEN EXISTS (
            SELECT 1
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
              ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
              AND tc.TABLE_SCHEMA = c.TABLE_SCHEMA AND tc.TABLE_NAME = c.TABLE_NAME
              AND k.COLUMN_NAME = c.COLUMN_NAME
          ) THEN 1 ELSE 0 END AS isPrimaryKey,
          CASE WHEN EXISTS (
            SELECT 1
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
              ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA
            WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
              AND tc.TABLE_SCHEMA = c.TABLE_SCHEMA AND tc.TABLE_NAME = c.TABLE_NAME
              AND k.COLUMN_NAME = c.COLUMN_NAME
          ) THEN 1 ELSE 0 END AS isForeignKey,
          c.ORDINAL_POSITION AS position
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_SCHEMA = @p1 AND c.TABLE_NAME = @p2
        ORDER BY c.ORDINAL_POSITION
      `,
      [schema, table],
    );

    return rows.map((row) => ({
      name: String(row.name),
      dataType: String(row.dataType),
      nullable: Boolean(row.nullable),
      defaultValue: (row.defaultValue as string | null) ?? null,
      isPrimaryKey: Boolean(row.isPrimaryKey),
      isForeignKey: Boolean(row.isForeignKey),
      position: Number(row.position),
    }));
  }

  async getCompletionData(
    connection: ConnectionProfile,
    password: string | null,
    maxColumns: number,
  ): Promise<CompletionData> {
    const [current] = await this.query<{ name: string }>(
      connection,
      password,
      'SELECT SCHEMA_NAME() AS name',
    );
    const rows = await this.query<{ schema: string; table: string; column: string }>(
      connection,
      password,
      `
        SELECT TOP (@p1)
          TABLE_SCHEMA AS [schema], TABLE_NAME AS [table], COLUMN_NAME AS [column]
        FROM INFORMATION_SCHEMA.COLUMNS
        ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
      `,
      [maxColumns + 1],
    );

    return { defaultSchema: current?.name ?? 'dbo', ...groupCompletionRows(rows, maxColumns) };
  }

  async getIndexes(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseIndex[]> {
    const rows = await this.query<{ name: string; unique: boolean; primary: boolean; column: string }>(
      connection,
      password,
      `
        SELECT i.name, i.is_unique AS [unique], i.is_primary_key AS [primary], c.name AS [column]
        FROM sys.indexes i
        JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE i.object_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2))
          AND i.name IS NOT NULL AND ic.is_included_column = 0
        ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal
      `,
      [schema, table],
    );

    const indexes = new Map<string, DatabaseIndex>();

    for (const row of rows) {
      const index = indexes.get(row.name) ?? {
        name: row.name,
        columns: [],
        unique: Boolean(row.unique),
        primary: Boolean(row.primary),
      };
      index.columns.push(row.column);
      indexes.set(row.name, index);
    }

    return [...indexes.values()];
  }

  async getForeignKeys(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table?: string,
  ): Promise<DatabaseForeignKey[]> {
    const rows = await this.query<{
      name: string;
      table: string;
      column: string;
      referencedSchema: string;
      referencedTable: string;
      referencedColumn: string;
    }>(
      connection,
      password,
      `
        SELECT
          fk.name,
          t.name AS [table],
          c.name AS [column],
          rs.name AS referencedSchema,
          rt.name AS referencedTable,
          rc.name AS referencedColumn
        FROM sys.foreign_keys fk
        JOIN sys.tables t ON t.object_id = fk.parent_object_id
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
        JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
        JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
        JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
        JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE s.name = @p1 AND (@p2 IS NULL OR t.name = @p2)
        ORDER BY t.name, fk.name, fkc.constraint_column_id
      `,
      [schema, table ?? null],
    );

    const keys = new Map<string, DatabaseForeignKey>();

    for (const row of rows) {
      const id = `${row.table}.${row.name}`;
      const key = keys.get(id) ?? {
        name: row.name,
        table: row.table,
        columns: [],
        referencedSchema: row.referencedSchema,
        referencedTable: row.referencedTable,
        referencedColumns: [],
      };
      key.columns.push(row.column);
      key.referencedColumns.push(row.referencedColumn);
      keys.set(id, key);
    }

    return [...keys.values()];
  }

  async getSchemaColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<SchemaColumnRow[]> {
    const rows = await this.query<Row>(
      connection,
      password,
      `
        SELECT
          c.TABLE_NAME AS [table],
          c.COLUMN_NAME AS name,
          c.DATA_TYPE AS dataType,
          CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
          CASE WHEN k.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS isPrimaryKey
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT k.TABLE_NAME, k.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
            ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = @p1
        ) k ON k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.TABLE_SCHEMA = @p1
        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
      `,
      [schema],
    );

    return rows.map((row) => ({
      table: String(row.table),
      name: String(row.name),
      dataType: String(row.dataType),
      nullable: Boolean(row.nullable),
      isPrimaryKey: Boolean(row.isPrimaryKey),
      isForeignKey: false,
    }));
  }

  async getTableDdl(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<string | null> {
    const quote = this.dialect.quoteIdentifier;
    const [object] = await this.query<{ type: string; definition: string | null }>(
      connection,
      password,
      `
        SELECT o.type, OBJECT_DEFINITION(o.object_id) AS definition
        FROM sys.objects o
        WHERE o.object_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2))
      `,
      [schema, table],
    );

    if (!object) return null;

    // View: tanım doğrudan saklanır.
    if (object.type.trim() === 'V') return object.definition;

    // Tablo: SQL Server CREATE TABLE üretmez; kolon ve kısıtlardan oluşturulur.
    const [columns, indexes, foreignKeys] = await Promise.all([
      this.getColumns(connection, password, schema, table),
      this.getIndexes(connection, password, schema, table),
      this.getForeignKeys(connection, password, schema, table),
    ]);

    const lines = columns.map(
      (column) =>
        `  ${quote(column.name)} ${column.dataType}${column.nullable ? ' NULL' : ' NOT NULL'}${
          column.defaultValue ? ` DEFAULT ${column.defaultValue}` : ''
        }`,
    );

    for (const index of indexes) {
      if (index.primary) {
        lines.push(`  CONSTRAINT ${quote(index.name)} PRIMARY KEY (${index.columns.map(quote).join(', ')})`);
      }
    }

    for (const key of foreignKeys) {
      lines.push(
        `  CONSTRAINT ${quote(key.name)} FOREIGN KEY (${key.columns.map(quote).join(', ')}) REFERENCES ${quote(key.referencedSchema)}.${quote(key.referencedTable)} (${key.referencedColumns.map(quote).join(', ')})`,
      );
    }

    const tableRef = `${quote(schema)}.${quote(table)}`;
    const extraIndexes = indexes
      .filter((index) => !index.primary)
      .map(
        (index) =>
          `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${tableRef} (${index.columns.map(quote).join(', ')});`,
      );

    return [`CREATE TABLE ${tableRef} (\n${lines.join(',\n')}\n);`, ...extraIndexes].join('\n\n');
  }

  async getRoutines(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseRoutine[]> {
    const rows = await this.query<{ id: number; name: string; type: string }>(
      connection,
      password,
      `
        SELECT o.object_id AS id, o.name, o.type
        FROM sys.objects o
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE s.name = @p1 AND o.type IN ('P', 'FN', 'IF', 'TF') AND o.is_ms_shipped = 0
        ORDER BY o.name
      `,
      [schema],
    );

    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      schema,
      type: row.type.trim() === 'P' ? 'procedure' : 'function',
      arguments: null,
      returnType: null,
    }));
  }

  async getRoutineDefinition(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    routine: Pick<DatabaseRoutine, 'id' | 'name' | 'type'>,
  ): Promise<string> {
    const [row] = await this.query<{ definition: string | null }>(
      connection,
      password,
      `
        SELECT OBJECT_DEFINITION(o.object_id) AS definition
        FROM sys.objects o
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.object_id = TRY_CAST(@p1 AS int) AND s.name = @p2
      `,
      [routine.id, schema],
    );

    if (!row?.definition) {
      throw new Error('Routine definition is not available (it may be encrypted or require permissions).');
    }

    return row.definition;
  }

  async explain(
    connection: ConnectionProfile,
    password: string | null,
    text: string,
  ): Promise<ExplainResult> {
    // SHOWPLAN oturum ayarıdır; tüm istekler aynı bağlantıda çalışmalı.
    // SHOWPLAN açıkken ifadeler ÇALIŞTIRILMAZ, yalnızca planları döner.
    const pool = new sql.ConnectionPool(this.config(connection, password, 1));

    try {
      await pool.connect();
      await pool.request().batch('SET SHOWPLAN_ALL ON');

      const result = await pool.request().batch<ShowplanRow>(text);
      const rows = ((result.recordsets ?? []) as IRecordSet<ShowplanRow>[]).flatMap((set) => [...set]);

      return {
        nodes: showplanToNodes(rows),
        raw: rows
          .map((row) => `${'  '.repeat(Math.max(0, row.Parent ? 1 : 0))}${row.StmtText}`)
          .join('\n'),
      };
    } finally {
      await pool.close().catch(() => undefined);
    }
  }

  async executeInTransaction(
    connection: ConnectionProfile,
    password: string | null,
    statements: ParameterizedStatement[],
  ): Promise<number[]> {
    const pool = await this.getPool(connection, password);
    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const affected: number[] = [];

      for (const [index, statement] of statements.entries()) {
        const request = new sql.Request(transaction);
        statement.parameters.forEach((value, position) =>
          request.input(`p${position + 1}`, value),
        );

        const result = await request.query(statement.sql);
        const count = (result.rowsAffected ?? []).reduce((sum, value) => sum + value, 0);

        assertAffectedRows(statement, count, index);
        affected.push(count);
      }

      await transaction.commit();
      return affected;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  release(connectionId: string): Promise<void> {
    return this.pools.release(connectionId);
  }

  releaseAll(): Promise<void> {
    return this.pools.releaseAll();
  }
}
