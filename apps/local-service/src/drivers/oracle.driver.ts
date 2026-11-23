
import { Logger } from '@nestjs/common';
import oracledb from 'oracledb';
import type { Connection, Pool } from 'oracledb';
import { randomBytes } from 'node:crypto';

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
import { oracleDialect } from './sql-dialects';
import { splitOracleScript, stripTrailingSemicolons } from './sql-splitter';

type Row = Record<string, unknown>;

// CLOB/NCLOB kolonları akış (Lob) yerine metin olarak gelsin.
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB];

/** Zaman aşımı sonrası bağlantı kullanılamaz; havuza geri verilmez. */
const CALL_TIMEOUT = /DPI-1067|NJS-123|call timeout/i;

/**
 * Easy Connect dizgesi: `[tcps://]host:port/service?…`.
 * `database` alanı servis adıdır (ör. FREEPDB1, ORCLPDB1).
 */
export function oracleConnectString(connection: ConnectionProfile): string {
  const secure = ['require', 'verify-ca', 'verify-full'].includes(connection.ssl_mode);
  const params = ['connect_timeout=10'];

  if (secure) {
    params.push(`ssl_server_dn_match=${connection.ssl_mode === 'verify-full' ? 'true' : 'false'}`);
  }

  return `${secure ? 'tcps://' : ''}${connection.host}:${connection.port}/${connection.database}?${params.join('&')}`;
}

interface PlanRow {
  id: number;
  parentId: number | null;
  operation: string;
  options: string | null;
  objectName: string | null;
  cost: number | null;
  cardinality: number | null;
  accessPredicates: string | null;
  filterPredicates: string | null;
}

/** PLAN_TABLE satırlarını (ID/PARENT_ID) ağaca çevirir. */
export function planRowsToNodes(rows: PlanRow[]): ExplainPlanNode[] {
  const nodes = new Map<number, ExplainPlanNode>();
  const roots: ExplainPlanNode[] = [];

  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const label = [row.operation, row.options].filter(Boolean).join(' ');
    const details = [
      row.accessPredicates ? `access: ${row.accessPredicates}` : null,
      row.filterPredicates ? `filter: ${row.filterPredicates}` : null,
    ].filter(Boolean);

    const node: ExplainPlanNode = {
      id: String(row.id),
      label: row.objectName ? `${label} ${row.objectName}` : label,
      detail: details.length ? details.join(' · ') : null,
      cost: row.cost,
      rows: row.cardinality,
      children: [],
    };

    nodes.set(row.id, node);

    const parent = row.parentId !== null ? nodes.get(row.parentId) : undefined;

    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

export class OracleDriver implements DatabaseDriver {
  private readonly logger = new Logger(OracleDriver.name);

  readonly dialect = oracleDialect;

  readonly supportsCancel = true;

  private readonly pools = new PoolRegistry<Pool>((pool) => pool.close(0));

  private getPool(connection: ConnectionProfile, password: string | null) {
    return this.pools.get(connection, password, async () => {
      if (!connection.host || !connection.port || !connection.username) {
        throw new Error('Invalid Oracle connection configuration.');
      }

      const pool = await oracledb.createPool({
        user: connection.username,
        password: password ?? '',
        connectString: oracleConnectString(connection),
        poolMin: 0,
        poolMax: 5,
        poolIncrement: 1,
        poolTimeout: 60,
      });

      // Bağlantı bilgilerini havuz kurulurken doğrula.
      const probe = await pool.getConnection();
      await probe.close();

      return pool;
    });
  }

  private async withConnection<T>(
    connection: ConnectionProfile,
    password: string | null,
    work: (conn: Connection) => Promise<T>,
  ): Promise<T> {
    const pool = await this.getPool(connection, password);
    const conn = await pool.getConnection();

    try {
      return await work(conn);
    } finally {
      await conn.close().catch(() => undefined);
    }
  }

  /** Metadata sorguları: adlandırılmış bağlama, nesne biçiminde satırlar. */
  private rows<T extends Row>(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
    binds: Record<string, unknown> = {},
  ): Promise<T[]> {
    return this.withConnection(connection, password, async (conn) => {
      const result = await conn.execute<T>(sql, binds as oracledb.BindParameters, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      return result.rows ?? [];
    });
  }

  async testConnection(connection: ConnectionProfile, password: string | null): Promise<void> {
    await this.rows(connection, password, 'SELECT 1 AS "ok" FROM DUAL');
  }

  async executeQuery(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
    parameters: unknown[],
    options: QueryOptions,
  ): Promise<QueryResult> {
    const statements = splitOracleScript(sql);

    if (statements.length === 0) {
      throw new Error('SQL query cannot be empty.');
    }

    if (parameters.length > 0 && statements.length > 1) {
      throw new Error('Parameters can only be used with a single statement.');
    }

    const pool = await this.getPool(connection, password);
    const conn = await pool.getConnection();
    conn.callTimeout = options.timeoutMs;

    let active = true;
    let drop = false;

    options.onCancelAvailable?.(async () => {
      if (active) await conn.break();
    });

    const startedAt = performance.now();

    try {
      let last: QueryResult | null = null;
      let affectedTotal = 0;

      for (const statement of statements) {
        const result = await conn.execute<Row>(
          statement,
          parameters as oracledb.BindParameters,
          {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            // Diğer veritabanlarıyla tutarlı: her ifade kendi başına kalıcı olur.
            autoCommit: true,
            // Fazlası veritabanından hiç alınmaz.
            maxRows: options.maxRows + 1,
          },
        );

        if (result.metaData) {
          const allRows = result.rows ?? [];
          const rows = allRows.slice(0, options.maxRows);

          last = {
            columns: result.metaData.map((column) => column.name),
            rows,
            rowCount: rows.length,
            durationMs: 0,
            truncated: allRows.length > rows.length,
            statementCount: statements.length,
          };
        } else {
          affectedTotal += result.rowsAffected ?? 0;

          // Okuma sonucu varsa onu koru; yoksa toplam etkilenen satırı göster.
          if (last && last.columns.length > 0) continue;

          last = {
            columns: [],
            rows: [],
            rowCount: affectedTotal,
            durationMs: 0,
            truncated: false,
            statementCount: statements.length,
          };
        }
      }

      return { ...last!, durationMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      if (CALL_TIMEOUT.test(String((error as Error)?.message))) {
        drop = true;
        throw new Error(`Query timed out after ${options.timeoutMs} ms and was cancelled.`);
      }
      throw error;
    } finally {
      active = false;

      if (drop) {
        await conn.close({ drop: true }).catch(() => undefined);
      } else {
        await conn.rollback().catch(() => undefined);
        await conn.close().catch(() => undefined);
      }
    }
  }

  async getSchemas(connection: ConnectionProfile, password: string | null): Promise<DatabaseSchema[]> {
    return this.rows<DatabaseSchema & Row>(
      connection,
      password,
      `
        SELECT u.username AS "name"
        FROM all_users u
        WHERE u.oracle_maintained = 'N'
          AND (
            u.username = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
            OR EXISTS (SELECT 1 FROM all_objects o WHERE o.owner = u.username)
          )
        ORDER BY u.username
      `,
    );
  }

  async getTables(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]> {
    const rows = await this.rows<{ name: string; type: 'table' | 'view' }>(
      connection,
      password,
      `
        SELECT table_name AS "name", 'table' AS "type"
        FROM all_tables WHERE owner = :owner AND nested = 'NO' AND secondary = 'N'
        UNION ALL
        SELECT view_name AS "name", 'view' AS "type"
        FROM all_views WHERE owner = :owner
        ORDER BY 1
      `,
      { owner: schema },
    );

    return rows.map((row) => ({ name: row.name, schema, type: row.type }));
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
          c.column_name AS "name",
          c.data_type ||
            CASE
              WHEN c.data_type IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR', 'RAW') THEN '(' || c.char_length || ')'
              WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN '(' || c.data_precision || ',' || NVL(c.data_scale, 0) || ')'
              ELSE ''
            END AS "dataType",
          c.nullable AS "nullable",
          c.data_default AS "defaultValue",
          c.column_id AS "position",
          CASE WHEN EXISTS (
            SELECT 1 FROM all_constraints k
            JOIN all_cons_columns kc ON kc.owner = k.owner AND kc.constraint_name = k.constraint_name
            WHERE k.constraint_type = 'P' AND k.owner = c.owner AND k.table_name = c.table_name
              AND kc.column_name = c.column_name
          ) THEN 1 ELSE 0 END AS "isPrimaryKey",
          CASE WHEN EXISTS (
            SELECT 1 FROM all_constraints k
            JOIN all_cons_columns kc ON kc.owner = k.owner AND kc.constraint_name = k.constraint_name
            WHERE k.constraint_type = 'R' AND k.owner = c.owner AND k.table_name = c.table_name
              AND kc.column_name = c.column_name
          ) THEN 1 ELSE 0 END AS "isForeignKey"
        FROM all_tab_columns c
        WHERE c.owner = :owner AND c.table_name = :tbl
        ORDER BY c.column_id
      `,
      { owner: schema, tbl: table },
    );

    return rows.map((row) => ({
      name: String(row.name),
      dataType: String(row.dataType),
      nullable: row.nullable === 'Y',
      // DATA_DEFAULT (LONG) çoğunlukla sonunda boşluk/yeni satır taşır.
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
      `SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS "name" FROM DUAL`,
    );

    const rows = await this.rows<{ schema: string; table: string; column: string }>(
      connection,
      password,
      `
        SELECT owner AS "schema", table_name AS "table", column_name AS "column"
        FROM all_tab_columns
        WHERE owner IN (SELECT username FROM all_users WHERE oracle_maintained = 'N')
        ORDER BY owner, table_name, column_id
        FETCH FIRST :n ROWS ONLY
      `,
      { n: maxColumns + 1 },
    );

    return { defaultSchema: current?.name ?? null, ...groupCompletionRows(rows, maxColumns) };
  }

  async getIndexes(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseIndex[]> {
    const rows = await this.rows<{ name: string; uniqueness: string; column: string; isPrimary: number }>(
      connection,
      password,
      `
        SELECT
          i.index_name AS "name",
          i.uniqueness AS "uniqueness",
          c.column_name AS "column",
          CASE WHEN EXISTS (
            SELECT 1 FROM all_constraints k
            WHERE k.owner = i.table_owner AND k.table_name = i.table_name
              AND k.constraint_type = 'P' AND k.index_name = i.index_name
          ) THEN 1 ELSE 0 END AS "isPrimary"
        FROM all_indexes i
        JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name
        WHERE i.table_owner = :owner AND i.table_name = :tbl
        ORDER BY 4 DESC, i.index_name, c.column_position
      `,
      { owner: schema, tbl: table },
    );

    const indexes = new Map<string, DatabaseIndex>();

    for (const row of rows) {
      const index = indexes.get(row.name) ?? {
        name: row.name,
        columns: [],
        unique: row.uniqueness === 'UNIQUE',
        primary: Number(row.isPrimary) === 1,
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
          c.constraint_name AS "name",
          c.table_name AS "table",
          cc.column_name AS "column",
          r.owner AS "referencedSchema",
          r.table_name AS "referencedTable",
          rc.column_name AS "referencedColumn"
        FROM all_constraints c
        JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
        JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name
        JOIN all_cons_columns rc
          ON rc.owner = r.owner AND rc.constraint_name = r.constraint_name AND rc.position = cc.position
        WHERE c.constraint_type = 'R'
          AND c.owner = :owner
          AND (:tbl IS NULL OR c.table_name = :tbl)
        ORDER BY c.table_name, c.constraint_name, cc.position
      `,
      { owner: schema, tbl: table ?? null },
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
          c.table_name AS "table",
          c.column_name AS "name",
          c.data_type AS "dataType",
          c.nullable AS "nullable",
          CASE WHEN pk.column_name IS NULL THEN 0 ELSE 1 END AS "isPrimaryKey"
        FROM all_tab_columns c
        LEFT JOIN (
          SELECT kc.table_name, kc.column_name
          FROM all_constraints k
          JOIN all_cons_columns kc ON kc.owner = k.owner AND kc.constraint_name = k.constraint_name
          WHERE k.constraint_type = 'P' AND k.owner = :owner
        ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
        WHERE c.owner = :owner
        ORDER BY c.table_name, c.column_id
      `,
      { owner: schema },
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
      `SELECT object_type AS "type" FROM all_objects
       WHERE owner = :owner AND object_name = :name AND object_type IN ('TABLE', 'VIEW')`,
      { owner: schema, name: table },
    );

    if (!object) return null;

    try {
      return await this.withConnection(connection, password, async (conn) => {
        // Depolama ayrıntılarını (TABLESPACE, STORAGE…) çıktıdan çıkar.
        await conn.execute(`
          BEGIN
            DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SEGMENT_ATTRIBUTES', FALSE);
            DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'STORAGE', FALSE);
            DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE);
          END;
        `);

        const result = await conn.execute<{ ddl: string }>(
          `SELECT DBMS_METADATA.GET_DDL(:type, :name, :owner) AS "ddl" FROM DUAL`,
          { type: object.type, name: table, owner: schema },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );

        return result.rows?.[0]?.ddl?.trim() ?? null;
      });
    } catch (error) {
      // Başka şemanın nesneleri için DBMS_METADATA yetki ister; kolonlardan üret.
      this.logger.debug(`DBMS_METADATA failed for ${schema}.${table}: ${String(error)}`);

      if (object.type === 'VIEW') return null;

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
  }

  async getRoutines(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseRoutine[]> {
    const rows = await this.rows<{ id: number; name: string; type: string }>(
      connection,
      password,
      `SELECT object_id AS "id", object_name AS "name", object_type AS "type"
       FROM all_objects
       WHERE owner = :owner AND object_type IN ('FUNCTION', 'PROCEDURE')
       ORDER BY object_name`,
      { owner: schema },
    );

    return rows.map((row) => ({
      id: String(row.id),
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
    const lines = await this.rows<{ text: string }>(
      connection,
      password,
      `SELECT text AS "text" FROM all_source
       WHERE owner = :owner AND name = :name AND type = :type
       ORDER BY line`,
      { owner: schema, name: routine.name, type: routine.type === 'procedure' ? 'PROCEDURE' : 'FUNCTION' },
    );

    if (lines.length === 0) {
      throw new Error('Routine source is not available (it may be wrapped or require privileges).');
    }

    return `CREATE OR REPLACE ${lines.map((line) => line.text).join('').trimEnd()}\n/`;
  }

  async explain(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
  ): Promise<ExplainResult> {
    const statements = splitOracleScript(sql);

    if (statements.length !== 1) {
      throw new Error('EXPLAIN supports exactly one statement.');
    }

    // Kimlik sunucuda üretilir; sabit olarak yazılabilir (kullanıcı girdisi değil).
    const statementId = `tukaka_${randomBytes(6).toString('hex')}`;

    return this.withConnection(connection, password, async (conn) => {
      conn.callTimeout = 30_000;

      try {
        // EXPLAIN PLAN sorguyu ÇALIŞTIRMAZ; yalnızca planı PLAN_TABLE'a yazar.
        await conn.execute(
          `EXPLAIN PLAN SET STATEMENT_ID = '${statementId}' FOR ${stripTrailingSemicolons(statements[0])}`,
        );

        const result = await conn.execute<PlanRow>(
          `
            SELECT
              id AS "id", parent_id AS "parentId", operation AS "operation",
              options AS "options", object_name AS "objectName", cost AS "cost",
              cardinality AS "cardinality", access_predicates AS "accessPredicates",
              filter_predicates AS "filterPredicates"
            FROM plan_table
            WHERE statement_id = :id
            ORDER BY id
          `,
          { id: statementId },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );

        const rows = result.rows ?? [];

        return {
          nodes: planRowsToNodes(rows),
          raw: rows
            .map(
              (row) =>
                `${row.id}\t${row.parentId ?? ''}\t${row.operation} ${row.options ?? ''} ${row.objectName ?? ''}\tcost=${row.cost ?? ''}\trows=${row.cardinality ?? ''}`,
            )
            .join('\n'),
        };
      } finally {
        // PLAN_TABLE'a yazılan satırları geri al.
        await conn.rollback().catch(() => undefined);
      }
    });
  }

  async executeInTransaction(
    connection: ConnectionProfile,
    password: string | null,
    statements: ParameterizedStatement[],
  ): Promise<number[]> {
    return this.withConnection(connection, password, async (conn) => {
      try {
        const affected: number[] = [];

        for (const [index, statement] of statements.entries()) {
          const result = await conn.execute(
            statement.sql,
            statement.parameters as oracledb.BindParameters,
            { autoCommit: false },
          );
          const count = result.rowsAffected ?? 0;

          assertAffectedRows(statement, count, index);
          affected.push(count);
        }

        await conn.commit();
        return affected;
      } catch (error) {
        await conn.rollback().catch(() => undefined);
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
