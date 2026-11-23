
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type {
  PoolClient,
  QueryConfig,
  QueryResult as PgQueryResult,
} from 'pg';

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
import { postgresDialect } from './sql-dialects';
import { stripTrailingSemicolons } from './sql-splitter';

/** EXPLAIN (FORMAT JSON) çıktısındaki plan düğümü (kullanılan alanlar). */
interface PgPlan {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'CTE Name'?: string;
  'Join Type'?: string;
  'Hash Cond'?: string;
  'Merge Cond'?: string;
  'Index Cond'?: string;
  'Join Filter'?: string;
  Filter?: string;
  'Sort Key'?: string[];
  'Total Cost'?: number;
  'Plan Rows'?: number;
  Plans?: PgPlan[];
}
import { PoolRegistry } from './pool-registry';
import { resolveSsl } from './ssl-options';

const NO_SSL_SUPPORT = /does not support SSL/i;

export class PostgreSqlDriver implements DatabaseDriver {
  private readonly logger = new Logger(PostgreSqlDriver.name);

  readonly dialect = postgresDialect;

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
    let active = true;

    try {
      await client.query(
        `SET statement_timeout = ${Math.max(0, Math.floor(options.timeoutMs))}`,
      );

      const backendPid = (client as unknown as { processID?: number })
        .processID;

      if (backendPid && options.onCancelAvailable) {
        // İptal, havuzdaki başka bir bağlantı üzerinden gönderilir.
        options.onCancelAvailable(async () => {
          if (active) {
            await pool.query('SELECT pg_cancel_backend($1)', [backendPid]);
          }
        });
      }

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
      active = false;

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

  async getCompletionData(
    connection: ConnectionProfile,
    password: string | null,
    maxColumns: number,
  ): Promise<CompletionData> {
    return this.withClient(connection, password, async (client) => {
      const current = await client.query<{ name: string }>(
        'SELECT current_schema() AS name',
      );

      const result = await client.query<{
        schema: string;
        table: string;
        column: string;
      }>(
        `
          SELECT
            table_schema AS schema,
            table_name AS "table",
            column_name AS "column"
          FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            AND table_schema NOT LIKE 'pg_toast%'
          ORDER BY table_schema, table_name, ordinal_position
          LIMIT $1
        `,
        [maxColumns + 1],
      );

      return {
        defaultSchema: current.rows[0]?.name ?? null,
        ...groupCompletionRows(result.rows, maxColumns),
      };
    });
  }

  async getIndexes(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseIndex[]> {
    return this.withClient(connection, password, async (client) => {
      const result = await client.query<DatabaseIndex>(
        `
          SELECT
            i.relname AS name,
            ix.indisunique AS unique,
            ix.indisprimary AS primary,
            array_agg(COALESCE(a.attname::text, '(expression)') ORDER BY k.ord) AS columns
          FROM pg_index ix
          JOIN pg_class t ON t.oid = ix.indrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
          LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          WHERE n.nspname = $1 AND t.relname = $2
          GROUP BY i.relname, ix.indisunique, ix.indisprimary
          ORDER BY ix.indisprimary DESC, i.relname
        `,
        [schema, table],
      );

      return result.rows;
    });
  }

  async getForeignKeys(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table?: string,
  ): Promise<DatabaseForeignKey[]> {
    return this.withClient(connection, password, async (client) => {
      const result = await client.query<DatabaseForeignKey>(
        `
          SELECT
            c.conname AS name,
            cl.relname AS "table",
            rn.nspname AS "referencedSchema",
            rc.relname AS "referencedTable",
            ARRAY(
              SELECT a.attname::text
              FROM unnest(c.conkey) WITH ORDINALITY k(num, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num
              ORDER BY k.ord
            ) AS columns,
            ARRAY(
              SELECT a.attname::text
              FROM unnest(c.confkey) WITH ORDINALITY k(num, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num
              ORDER BY k.ord
            ) AS "referencedColumns"
          FROM pg_constraint c
          JOIN pg_class cl ON cl.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = cl.relnamespace
          JOIN pg_class rc ON rc.oid = c.confrelid
          JOIN pg_namespace rn ON rn.oid = rc.relnamespace
          WHERE c.contype = 'f'
            AND n.nspname = $1
            AND ($2::text IS NULL OR cl.relname = $2)
          ORDER BY cl.relname, c.conname
        `,
        [schema, table ?? null],
      );

      return result.rows;
    });
  }

  async getSchemaColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<SchemaColumnRow[]> {
    return this.withClient(connection, password, async (client) => {
      const result = await client.query<SchemaColumnRow>(
        `
          SELECT
            c.table_name AS "table",
            c.column_name AS name,
            c.data_type AS "dataType",
            (c.is_nullable = 'YES') AS nullable,
            EXISTS (
              SELECT 1
              FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.constraint_schema = kcu.constraint_schema
                AND tc.table_name = kcu.table_name
              WHERE tc.constraint_type = 'PRIMARY KEY'
                AND tc.table_schema = c.table_schema
                AND tc.table_name = c.table_name
                AND kcu.column_name = c.column_name
            ) AS "isPrimaryKey",
            false AS "isForeignKey"
          FROM information_schema.columns c
          WHERE c.table_schema = $1
          ORDER BY c.table_name, c.ordinal_position
        `,
        [schema],
      );

      return result.rows;
    });
  }

  async getTableDdl(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<string | null> {
    return this.withClient(connection, password, async (client) => {
      const relation = await client.query<{ oid: number; relkind: string }>(
        `
          SELECT c.oid, c.relkind
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2
        `,
        [schema, table],
      );

      const target = relation.rows[0];

      if (!target) return null;

      const quote = this.dialect.quoteIdentifier;
      const tableRef = `${quote(schema)}.${quote(table)}`;

      if (target.relkind === 'v' || target.relkind === 'm') {
        const view = await client.query<{ definition: string }>(
          'SELECT pg_get_viewdef($1::oid, true) AS definition',
          [target.oid],
        );
        const kind = target.relkind === 'm' ? 'MATERIALIZED VIEW' : 'VIEW';

        return `CREATE ${kind} ${tableRef} AS\n${view.rows[0]?.definition.trim() ?? ''}`;
      }

      const columns = await client.query<{
        name: string;
        type: string;
        notnull: boolean;
        default: string | null;
        identity: string;
      }>(
        `
          SELECT
            a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull AS notnull,
            pg_get_expr(d.adbin, d.adrelid) AS default,
            a.attidentity AS identity
          FROM pg_attribute a
          LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum
        `,
        [target.oid],
      );

      const constraints = await client.query<{ name: string; definition: string }>(
        `
          SELECT conname AS name, pg_get_constraintdef(oid, true) AS definition
          FROM pg_constraint
          WHERE conrelid = $1
          ORDER BY contype = 'p' DESC, conname
        `,
        [target.oid],
      );

      const indexes = await client.query<{ definition: string }>(
        `
          SELECT pg_get_indexdef(i.indexrelid) AS definition
          FROM pg_index i
          WHERE i.indrelid = $1
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint c
              WHERE c.conindid = i.indexrelid AND c.contype IN ('p', 'u', 'x')
            )
          ORDER BY 1
        `,
        [target.oid],
      );

      const lines = [
        ...columns.rows.map((column) => {
          const parts = [`  ${quote(column.name)} ${column.type}`];

          if (column.identity === 'a') parts.push('GENERATED ALWAYS AS IDENTITY');
          else if (column.identity === 'd') parts.push('GENERATED BY DEFAULT AS IDENTITY');
          else if (column.default !== null) parts.push(`DEFAULT ${column.default}`);

          if (column.notnull) parts.push('NOT NULL');

          return parts.join(' ');
        }),
        ...constraints.rows.map(
          (constraint) => `  CONSTRAINT ${quote(constraint.name)} ${constraint.definition}`,
        ),
      ];

      return [
        `CREATE TABLE ${tableRef} (\n${lines.join(',\n')}\n);`,
        ...indexes.rows.map((index) => `${index.definition};`),
      ].join('\n\n');
    });
  }

  async getRoutines(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseRoutine[]> {
    return this.withClient(connection, password, async (client) => {
      const result = await client.query<DatabaseRoutine>(
        `
          SELECT
            p.oid::text AS id,
            p.proname AS name,
            n.nspname AS schema,
            CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS type,
            pg_get_function_identity_arguments(p.oid) AS arguments,
            CASE WHEN p.prokind = 'p' THEN NULL ELSE pg_get_function_result(p.oid) END AS "returnType"
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1
            AND p.prokind IN ('f', 'p')
            -- Eklentilerin (extension) fonksiyonlarını gizle.
            AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
            )
          ORDER BY p.proname, p.oid
        `,
        [schema],
      );

      return result.rows;
    });
  }

  async getRoutineDefinition(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    routine: Pick<DatabaseRoutine, 'id' | 'name' | 'type'>,
  ): Promise<string> {
    if (!/^\d+$/.test(routine.id)) {
      throw new Error('Invalid routine id.');
    }

    return this.withClient(connection, password, async (client) => {
      const result = await client.query<{ definition: string }>(
        `
          SELECT pg_get_functiondef(p.oid) AS definition
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.oid = $1::oid AND n.nspname = $2
        `,
        [routine.id, schema],
      );

      const definition = result.rows[0]?.definition;

      if (!definition) throw new Error('Routine not found.');

      return definition;
    });
  }

  async explain(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
  ): Promise<ExplainResult> {
    return this.withClient(connection, password, async (client) => {
      await client.query('SET statement_timeout = 30000');

      try {
        // "extended" protokol birden fazla ifadeye izin vermez; böylece
        // EXPLAIN'in arkasına eklenmiş ikinci bir ifade asla çalışmaz.
        // `queryMode` pg 8.x'te desteklenir ama @types/pg'de tanımlı değildir.
        const config = {
          text: `EXPLAIN (FORMAT JSON) ${stripTrailingSemicolons(sql)}`,
          values: [],
          queryMode: 'extended',
        } as QueryConfig;
        const result = await client.query(config);

        const raw = result.rows[0]?.['QUERY PLAN'] as unknown;
        const plans = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<{
          Plan: PgPlan;
        }>;

        let counter = 0;
        const toNode = (plan: PgPlan): ExplainPlanNode => {
          const target = plan['Relation Name'] ?? plan['Index Name'] ?? plan['CTE Name'];
          const details = [
            plan['Index Name'] && plan['Relation Name'] ? `index ${plan['Index Name']}` : null,
            plan['Join Type'] ? `${plan['Join Type']} join` : null,
            plan['Hash Cond'] ?? plan['Merge Cond'] ?? plan['Index Cond'] ?? plan['Join Filter'] ?? null,
            plan['Filter'] ? `filter: ${plan['Filter']}` : null,
            plan['Sort Key'] ? `sort: ${plan['Sort Key'].join(', ')}` : null,
          ].filter(Boolean);

          return {
            id: String(++counter),
            label: target ? `${plan['Node Type']} on ${target}` : plan['Node Type'],
            detail: details.length ? details.join(' · ') : null,
            cost: plan['Total Cost'] ?? null,
            rows: plan['Plan Rows'] ?? null,
            children: (plan.Plans ?? []).map(toNode),
          };
        };

        return {
          nodes: plans.map((entry) => toNode(entry.Plan)),
          raw: JSON.stringify(plans, null, 2),
        };
      } finally {
        await client.query('RESET statement_timeout').catch(() => undefined);
      }
    });
  }

  async executeInTransaction(
    connection: ConnectionProfile,
    password: string | null,
    statements: ParameterizedStatement[],
  ): Promise<number[]> {
    return this.withClient(connection, password, async (client) => {
      await client.query('BEGIN');

      try {
        const affected: number[] = [];

        for (const [index, statement] of statements.entries()) {
          const result = await client.query(statement.sql, statement.parameters);
          assertAffectedRows(statement, result.rowCount ?? 0, index);
          affected.push(result.rowCount ?? 0);
        }

        await client.query('COMMIT');
        return affected;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
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
