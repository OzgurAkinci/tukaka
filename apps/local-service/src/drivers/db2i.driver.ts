
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
  ExplainResult,
  groupCompletionRows,
  ParameterizedStatement,
  QueryOptions,
  QueryResult,
  SchemaColumnRow,
} from './database-driver.interface';
import { JdbcBridge, type JdbcQueryResult } from './jdbc/jdbc-bridge';
import { PoolRegistry } from './pool-registry';
import { db2iDialect } from './sql-dialects';
import { splitOracleScript, stripTrailingSemicolons } from './sql-splitter';

type Row = Record<string, unknown>;

/** jt400 varsayılan veritabanı sunucusu portları (port eşleyici bunları bulur). */
const DEFAULT_PORTS = new Set([8471, 9471]);

/** Sistem kütüphaneleri gezginde gösterilmez (QGPL hariç). */
const SYSTEM_SCHEMA_FILTER = `(SCHEMA_NAME NOT LIKE 'Q%' OR SCHEMA_NAME = 'QGPL') AND SCHEMA_NAME NOT LIKE 'SYS%'`;

export interface Db2iJdbcConfig {
  url: string;
  properties: Record<string, string>;
}

/**
 * jt400 JDBC URL'si ve bağlantı özellikleri.
 *
 * `database` alanı varsayılan kütüphanedir (SQL şeması). Port varsayılandaysa
 * URL'ye yazılmaz; jt400 port eşleyici (449) ile doğru sunucu portunu bulur.
 */
export function db2iJdbcConfig(connection: ConnectionProfile): Db2iJdbcConfig {
  if (!connection.host) {
    throw new Error('Invalid IBM i connection configuration: host is required.');
  }

  const secure = ['require', 'verify-ca', 'verify-full'].includes(connection.ssl_mode);
  const port =
    connection.port && !DEFAULT_PORTS.has(connection.port) ? `:${connection.port}` : '';
  const library = connection.database?.trim();

  return {
    url: `jdbc:as400://${connection.host}${port}${library ? `/${library}` : ''}`,
    properties: {
      // LIB.TABLE (SQL) adlandırması; sistem adlandırması (LIB/FILE) değil.
      naming: 'sql',
      // Şifre eksikse jt400 grafik giriş penceresi açmasın.
      prompt: 'false',
      errors: 'full',
      'date format': 'iso',
      'time format': 'iso',
      // CCSID 65535 alanlarını metin olarak göster.
      'translate binary': 'true',
      // setQueryTimeout tahmini süre sınırı yerine gerçek iptal kullansın.
      'query timeout mechanism': 'cancel',
      'secure': secure ? 'true' : 'false',
      'application name': 'TUKAKA Database Studio',
    },
  };
}

/** Plan görselleştirmesi IBM i'de SQL ile alınamaz. */
const EXPLAIN_UNSUPPORTED =
  'EXPLAIN is not available for IBM i over JDBC. Use Visual Explain in IBM i Access Client Solutions.';

export class Db2iDriver implements DatabaseDriver {
  readonly dialect = db2iDialect;

  readonly supportsCancel = true;

  private readonly pools: PoolRegistry<string>;

  constructor(private readonly bridge: JdbcBridge = new JdbcBridge()) {
    this.pools = new PoolRegistry<string>((handle) =>
      this.bridge.close(handle).then(() => undefined),
    );
  }

  private getHandle(connection: ConnectionProfile, password: string | null) {
    return this.pools.get(connection, password, async () => {
      const { url, properties } = db2iJdbcConfig(connection);
      const { handle } = await this.bridge.open({
        url,
        user: connection.username,
        password,
        properties,
        driverClass: 'com.ibm.as400.access.AS400JDBCDriver',
      });
      return handle;
    });
  }

  private async rows<T extends Row>(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
    params: unknown[] = [],
    maxRows = 100_000,
  ): Promise<T[]> {
    const handle = await this.getHandle(connection, password);
    const result = await this.bridge.query({ handle, sql, params, maxRows, timeoutSeconds: 60 });
    return result.rows as T[];
  }

  async testConnection(connection: ConnectionProfile, password: string | null): Promise<void> {
    await this.rows(connection, password, 'SELECT 1 AS "ok" FROM SYSIBM.SYSDUMMY1');
  }

  async executeQuery(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
    parameters: unknown[],
    options: QueryOptions,
  ): Promise<QueryResult> {
    // SQL PL blokları (BEGIN…END, CREATE PROCEDURE…) "/" satırıyla biter;
    // Db2 for i ifade sonundaki ";" işaretini kabul etmez.
    const statements = splitOracleScript(sql).map(stripTrailingSemicolons);

    if (statements.length === 0) {
      throw new Error('SQL query cannot be empty.');
    }

    if (parameters.length > 0 && statements.length > 1) {
      throw new Error('Parameters can only be used with a single statement.');
    }

    const handle = await this.getHandle(connection, password);
    let currentQueryId: string | null = null;
    let cancelled = false;

    options.onCancelAvailable?.(async () => {
      cancelled = true;
      if (currentQueryId) await this.bridge.cancel(currentQueryId);
    });

    const startedAt = performance.now();
    let last: JdbcQueryResult | null = null;
    let affected = 0;

    for (const statement of statements) {
      if (cancelled) break;

      currentQueryId = randomUUID();

      const result = await this.bridge.query({
        handle,
        sql: statement,
        params: parameters,
        maxRows: options.maxRows,
        timeoutSeconds: Math.max(1, Math.ceil(options.timeoutMs / 1000)),
        queryId: currentQueryId,
      });

      affected += result.affected;

      // Okuma sonucu varsa onu koru.
      if (result.columns.length > 0 || !last || last.columns.length === 0) {
        last = result;
      }
    }

    if (cancelled) {
      throw new Error('Query was cancelled.');
    }

    const isRead = last!.columns.length > 0;

    return {
      columns: last!.columns,
      rows: last!.rows,
      rowCount: isRead ? last!.rows.length : affected,
      durationMs: Math.round(performance.now() - startedAt),
      truncated: last!.truncated,
      statementCount: statements.length,
    };
  }

  async getSchemas(connection: ConnectionProfile, password: string | null): Promise<DatabaseSchema[]> {
    return this.rows<DatabaseSchema & Row>(
      connection,
      password,
      `SELECT SCHEMA_NAME AS "name" FROM QSYS2.SYSSCHEMAS
       WHERE ${SYSTEM_SCHEMA_FILTER} OR SCHEMA_NAME = CURRENT SCHEMA
       ORDER BY SCHEMA_NAME`,
    );
  }

  async getTables(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    // T: SQL tablosu, P: fiziksel dosya, V: view, L: mantıksal dosya, M: MQT.
    const rows = await this.rows<{ name: string; type: string }>(
      connection,
      password,
      `SELECT TABLE_NAME AS "name", TABLE_TYPE AS "type" FROM QSYS2.SYSTABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('T', 'P', 'V', 'L', 'M')
       ORDER BY TABLE_NAME`,
      [schema],
    );

    return rows.map((row) => ({
      name: row.name,
      schema,
      type: row.type === 'V' || row.type === 'L' ? 'view' : 'table',
    }));
  }

  async getColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseColumn[]> {
    const rows = await this.rows<Row>(
      connection,
      password,
      `
        SELECT
          c.COLUMN_NAME AS "name",
          c.DATA_TYPE ||
            CASE
              WHEN c.DATA_TYPE IN ('CHAR', 'VARCHAR', 'GRAPHIC', 'VARGRAPHIC', 'BINARY', 'VARBINARY')
                THEN '(' || TRIM(CHAR(c.LENGTH)) || ')'
              WHEN c.DATA_TYPE IN ('DECIMAL', 'NUMERIC')
                THEN '(' || TRIM(CHAR(c.LENGTH)) || ',' || TRIM(CHAR(COALESCE(c.NUMERIC_SCALE, 0))) || ')'
              ELSE ''
            END AS "dataType",
          c.IS_NULLABLE AS "nullable",
          c.COLUMN_DEFAULT AS "defaultValue",
          c.ORDINAL_POSITION AS "position",
          CASE WHEN EXISTS (
            SELECT 1 FROM QSYS2.SYSCST k
            JOIN QSYS2.SYSKEYCST kc
              ON kc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND kc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            WHERE k.CONSTRAINT_TYPE = 'PRIMARY KEY'
              AND k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
              AND kc.COLUMN_NAME = c.COLUMN_NAME
          ) THEN 1 ELSE 0 END AS "isPrimaryKey",
          CASE WHEN EXISTS (
            SELECT 1 FROM QSYS2.SYSCST k
            JOIN QSYS2.SYSKEYCST kc
              ON kc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND kc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            WHERE k.CONSTRAINT_TYPE = 'FOREIGN KEY'
              AND k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
              AND kc.COLUMN_NAME = c.COLUMN_NAME
          ) THEN 1 ELSE 0 END AS "isForeignKey"
        FROM QSYS2.SYSCOLUMNS c
        WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
        ORDER BY c.ORDINAL_POSITION
      `,
      [schema, table],
    );

    return rows.map((row) => ({
      name: String(row.name),
      dataType: String(row.dataType),
      nullable: row.nullable === 'Y',
      defaultValue: typeof row.defaultValue === 'string' ? row.defaultValue.trim() || null : null,
      isPrimaryKey: Number(row.isPrimaryKey) === 1,
      isForeignKey: Number(row.isForeignKey) === 1,
      position: Number(row.position),
    }));
  }

  async getCompletionData(
    connection: ConnectionProfile,
    password: string | null,
    maxColumns: number,
  ): Promise<CompletionData> {
    const [current] = await this.rows<{ name: string }>(
      connection,
      password,
      'SELECT CURRENT SCHEMA AS "name" FROM SYSIBM.SYSDUMMY1',
    );

    const limit = Math.max(1, Math.floor(maxColumns)) + 1;
    const rows = await this.rows<{ schema: string; table: string; column: string }>(
      connection,
      password,
      `SELECT TABLE_SCHEMA AS "schema", TABLE_NAME AS "table", COLUMN_NAME AS "column"
       FROM QSYS2.SYSCOLUMNS
       WHERE TABLE_SCHEMA IN (
         SELECT SCHEMA_NAME FROM QSYS2.SYSSCHEMAS
         WHERE ${SYSTEM_SCHEMA_FILTER} OR SCHEMA_NAME = CURRENT SCHEMA
       )
       ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
       FETCH FIRST ${limit} ROWS ONLY`,
      [],
      limit,
    );

    return { defaultSchema: current?.name ?? null, ...groupCompletionRows(rows, maxColumns) };
  }

  async getIndexes(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseIndex[]> {
    const constraints = await this.rows<{ name: string; type: string; column: string }>(
      connection,
      password,
      `SELECT k.CONSTRAINT_NAME AS "name", k.CONSTRAINT_TYPE AS "type", kc.COLUMN_NAME AS "column"
       FROM QSYS2.SYSCST k
       JOIN QSYS2.SYSKEYCST kc
         ON kc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND kc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
       ORDER BY k.CONSTRAINT_TYPE, k.CONSTRAINT_NAME, kc.ORDINAL_POSITION`,
      [schema, table],
    );

    const indexes = await this.rows<{ name: string; unique: string; column: string }>(
      connection,
      password,
      `SELECT i.INDEX_NAME AS "name", i.IS_UNIQUE AS "unique", k.COLUMN_NAME AS "column"
       FROM QSYS2.SYSINDEXES i
       JOIN QSYS2.SYSKEYS k ON k.INDEX_SCHEMA = i.INDEX_SCHEMA AND k.INDEX_NAME = i.INDEX_NAME
       WHERE i.TABLE_SCHEMA = ? AND i.TABLE_NAME = ?
       ORDER BY i.INDEX_NAME, k.ORDINAL_POSITION`,
      [schema, table],
    );

    const result = new Map<string, DatabaseIndex>();

    for (const row of constraints) {
      const entry = result.get(row.name) ?? {
        name: row.name,
        columns: [],
        unique: true,
        primary: row.type === 'PRIMARY KEY',
      };
      entry.columns.push(row.column);
      result.set(row.name, entry);
    }

    for (const row of indexes) {
      const key = `index:${row.name}`;
      const entry = result.get(key) ?? {
        name: row.name,
        columns: [],
        // U: benzersiz, V: NULL olmayanlarda benzersiz, D: tekrara izin verir.
        unique: row.unique === 'U' || row.unique === 'V',
        primary: false,
      };
      entry.columns.push(row.column);
      result.set(key, entry);
    }

    return [...result.values()].sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  async getForeignKeys(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table?: string,
  ): Promise<DatabaseForeignKey[]> {
    const rows = await this.rows<{
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
          c.CONSTRAINT_NAME AS "name",
          c.TABLE_NAME AS "table",
          kc.COLUMN_NAME AS "column",
          u.TABLE_SCHEMA AS "referencedSchema",
          u.TABLE_NAME AS "referencedTable",
          ukc.COLUMN_NAME AS "referencedColumn"
        FROM QSYS2.SYSCST c
        JOIN QSYS2.SYSREFCST r
          ON r.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = c.CONSTRAINT_NAME
        JOIN QSYS2.SYSKEYCST kc
          ON kc.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA AND kc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
        JOIN QSYS2.SYSCST u
          ON u.CONSTRAINT_SCHEMA = r.UNIQUE_CONSTRAINT_SCHEMA AND u.CONSTRAINT_NAME = r.UNIQUE_CONSTRAINT_NAME
        JOIN QSYS2.SYSKEYCST ukc
          ON ukc.CONSTRAINT_SCHEMA = u.CONSTRAINT_SCHEMA AND ukc.CONSTRAINT_NAME = u.CONSTRAINT_NAME
          AND ukc.ORDINAL_POSITION = kc.ORDINAL_POSITION
        WHERE c.CONSTRAINT_TYPE = 'FOREIGN KEY' AND c.TABLE_SCHEMA = ?
          ${table ? 'AND c.TABLE_NAME = ?' : ''}
        ORDER BY c.TABLE_NAME, c.CONSTRAINT_NAME, kc.ORDINAL_POSITION
      `,
      table ? [schema, table] : [schema],
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
    const rows = await this.rows<Row>(
      connection,
      password,
      `
        SELECT
          c.TABLE_NAME AS "table",
          c.COLUMN_NAME AS "name",
          c.DATA_TYPE AS "dataType",
          c.IS_NULLABLE AS "nullable",
          CASE WHEN pk.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS "isPrimaryKey"
        FROM QSYS2.SYSCOLUMNS c
        LEFT JOIN (
          SELECT k.TABLE_NAME, kc.COLUMN_NAME
          FROM QSYS2.SYSCST k
          JOIN QSYS2.SYSKEYCST kc
            ON kc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND kc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
          WHERE k.CONSTRAINT_TYPE = 'PRIMARY KEY' AND k.TABLE_SCHEMA = ?
        ) pk ON pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.TABLE_SCHEMA = ?
        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
      `,
      [schema, schema],
    );

    return rows.map((row) => ({
      table: String(row.table),
      name: String(row.name),
      dataType: String(row.dataType),
      nullable: row.nullable === 'Y',
      isPrimaryKey: Number(row.isPrimaryKey) === 1,
      isForeignKey: false,
    }));
  }

  async getTableDdl(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<string | null> {
    const [object] = await this.rows<{ type: string }>(
      connection,
      password,
      'SELECT TABLE_TYPE AS "type" FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [schema, table],
    );

    if (!object) return null;

    const objectType = object.type === 'V' ? 'VIEW' : object.type === 'L' ? 'INDEX' : 'TABLE';

    try {
      // IBM'in yerleşik DDL üreticisi; sonucu satır satır (SRCDTA) döner.
      const lines = await this.rows<Row>(
        connection,
        password,
        `CALL QSYS2.GENERATE_SQL(
           DATABASE_OBJECT_NAME => ?, DATABASE_OBJECT_LIBRARY_NAME => ?,
           DATABASE_OBJECT_TYPE => ?, CREATE_OR_REPLACE_OPTION => '1', HEADER_OPTION => '0')`,
        [table, schema, objectType],
      );

      const text = lines
        .map((line) => {
          const value = Object.values(line)[0];
          return typeof value === 'string' ? value.trimEnd() : '';
        })
        .join('\n')
        .trim();

      if (text) return text;
    } catch {
      // Eski sürümlerde ya da yetki yoksa kolonlardan üret.
    }

    if (objectType !== 'TABLE') return null;

    const columns = await this.getColumns(connection, password, schema, table);
    const quote = this.dialect.quoteIdentifier;
    const lines = columns.map(
      (column) =>
        `  ${quote(column.name)} ${column.dataType}${column.defaultValue ? ` DEFAULT ${column.defaultValue}` : ''}${column.nullable ? '' : ' NOT NULL'}`,
    );
    const keys = columns.filter((column) => column.isPrimaryKey).map((column) => quote(column.name));

    if (keys.length) lines.push(`  PRIMARY KEY (${keys.join(', ')})`);

    return `CREATE TABLE ${quote(schema)}.${quote(table)} (\n${lines.join(',\n')}\n);`;
  }

  async getRoutines(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseRoutine[]> {
    const rows = await this.rows<{ id: string; name: string; type: string }>(
      connection,
      password,
      `SELECT SPECIFIC_NAME AS "id", ROUTINE_NAME AS "name", ROUTINE_TYPE AS "type"
       FROM QSYS2.SYSROUTINES
       WHERE ROUTINE_SCHEMA = ?
       ORDER BY ROUTINE_NAME, SPECIFIC_NAME`,
      [schema],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      schema,
      type: row.type === 'PROCEDURE' ? 'procedure' : 'function',
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
    const [row] = await this.rows<{ definition: string | null; body: string; external: string | null }>(
      connection,
      password,
      `SELECT ROUTINE_DEFINITION AS "definition", ROUTINE_BODY AS "body", EXTERNAL_NAME AS "external"
       FROM QSYS2.SYSROUTINES
       WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ?`,
      [schema, routine.id],
    );

    if (!row) throw new Error('Routine not found.');

    if (row.definition) {
      const kind = routine.type === 'procedure' ? 'PROCEDURE' : 'FUNCTION';
      return `-- ${kind} ${schema}.${routine.name} (body)\n${row.definition}`;
    }

    return `-- ${routine.name} is an external routine (${row.body}).\n-- Program: ${row.external ?? 'unknown'}`;
  }

  async explain(): Promise<ExplainResult> {
    throw new Error(EXPLAIN_UNSUPPORTED);
  }

  async executeInTransaction(
    connection: ConnectionProfile,
    password: string | null,
    statements: ParameterizedStatement[],
  ): Promise<number[]> {
    const handle = await this.getHandle(connection, password);

    // Commitment control gerektirir: tablolar günlüklenmiş (journaled) olmalıdır.
    const { affected } = await this.bridge.batch({
      handle,
      statements: statements.map((statement) => ({
        sql: statement.sql,
        params: statement.parameters,
        expectedRows: statement.expectedRows,
      })),
    });

    return affected;
  }

  release(connectionId: string): Promise<void> {
    return this.pools.release(connectionId);
  }

  async releaseAll(): Promise<void> {
    await this.pools.releaseAll();
    this.bridge.stop();
  }
}
