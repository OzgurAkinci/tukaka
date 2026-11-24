import type { DatabaseColumn } from '@tukaka/contracts';

import { Db2iDriver, db2iJdbcConfig } from './db2i.driver';
import type { JdbcBridge } from './jdbc/jdbc-bridge';
import { db2iDialect, renderStatement } from './sql-dialects';
import { buildRowChangeStatements } from './table-data/row-changes';
import { buildTableDataQuery } from './table-data/table-data-query';
import { makeProfile } from './test-helpers';

const profile = (overrides = {}) =>
  makeProfile({
    type: 'db2i',
    host: 'pub400.example.com',
    port: 8471,
    database: 'MYLIB',
    username: 'DEVUSER',
    ssl_mode: 'prefer',
    ...overrides,
  });

/** Sahte köprü: istekleri kaydeder, önceden tanımlı yanıtları döner. */
function fakeBridge(responses: Array<Record<string, unknown>> = []) {
  const calls: Array<{ op: string; payload: Record<string, unknown> }> = [];
  const record = (op: string) => async (payload: Record<string, unknown> = {}) => {
    calls.push({ op, payload });
    if (op === 'open') return { handle: 's1' };
    if (op === 'cancel') return { cancelled: true };
    if (op === 'close') return {};
    return (
      responses.shift() ?? { columns: [], rows: [], truncated: false, affected: 0, statementCount: 1 }
    );
  };

  const bridge = {
    open: record('open'),
    query: record('query'),
    batch: record('batch'),
    cancel: (queryId: string) => record('cancel')({ queryId }),
    close: (handle: string) => record('close')({ handle }),
    stop: () => calls.push({ op: 'stop', payload: {} }),
  };

  return { bridge: bridge as unknown as JdbcBridge, calls };
}

describe('IBM i (Db2 for i) support', () => {
  it('builds the jt400 URL and connection properties', () => {
    expect(db2iJdbcConfig(profile())).toEqual({
      url: 'jdbc:as400://pub400.example.com/MYLIB',
      properties: expect.objectContaining({
        naming: 'sql',
        prompt: 'false',
        'query timeout mechanism': 'cancel',
        secure: 'false',
      }),
    });

    // Varsayılan dışı port URL'ye yazılır; TLS secure=true yapar.
    expect(db2iJdbcConfig(profile({ port: 12345, ssl_mode: 'require' }))).toMatchObject({
      url: 'jdbc:as400://pub400.example.com:12345/MYLIB',
      properties: { secure: 'true' },
    });
    expect(db2iJdbcConfig(profile({ port: 9471, database: '' })).url).toBe(
      'jdbc:as400://pub400.example.com',
    );
  });

  it('pages with OFFSET/FETCH and casts LIKE parameters (no untyped ? in functions)', () => {
    const query = buildTableDataQuery(db2iDialect, {
      schema: 'MYLIB',
      table: 'CUSTOMERS',
      limit: 100,
      offset: 200,
      filters: [{ column: 'CUSNAM', operator: 'contains', value: 'ab' }],
    });

    expect(query.dataSql).toBe(
      `SELECT * FROM "MYLIB"."CUSTOMERS" WHERE UPPER(CAST("CUSNAM" AS VARCHAR(4000))) LIKE UPPER(CAST(? AS VARCHAR(4000))) ESCAPE '!' OFFSET 200 ROWS FETCH FIRST 101 ROWS ONLY`,
    );
  });

  it('builds row changes with ? markers', () => {
    const column = (name: string, isPrimaryKey = false): DatabaseColumn => ({
      name, dataType: 'CHAR(10)', nullable: !isPrimaryKey, defaultValue: null, isPrimaryKey, isForeignKey: false, position: 1,
    });

    const [update] = buildRowChangeStatements(db2iDialect, 'MYLIB', 'CUST', [column('CUSNUM', true), column('CUSNAM')], [
      { type: 'update', key: { CUSNUM: 42 }, values: { CUSNAM: 'ACME' } },
    ]);

    expect(update.sql).toBe('UPDATE "MYLIB"."CUST" SET "CUSNAM" = ? WHERE "CUSNUM" = ?');
    expect(renderStatement(db2iDialect, update.sql, update.parameters)).toBe(
      `UPDATE "MYLIB"."CUST" SET "CUSNAM" = 'ACME' WHERE "CUSNUM" = 42`,
    );
  });

  it('opens a jt400 data source once and runs scripts statement by statement', async () => {
    const { bridge, calls } = fakeBridge([
      { columns: [], rows: [], truncated: false, affected: 3, statementCount: 1 },
      { columns: ['N'], rows: [{ N: 3 }], truncated: false, affected: 0, statementCount: 1 },
    ]);
    const driver = new Db2iDriver(bridge);

    const result = await driver.executeQuery(
      profile(),
      'secret',
      "UPDATE T SET A = 1;\nSELECT COUNT(*) AS N FROM T;",
      [],
      { maxRows: 50, timeoutMs: 4500 },
    );

    expect(result).toMatchObject({ columns: ['N'], rows: [{ N: 3 }], statementCount: 2 });

    const open = calls.filter((call) => call.op === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].payload).toMatchObject({
      url: 'jdbc:as400://pub400.example.com/MYLIB',
      user: 'DEVUSER',
      password: 'secret',
      driverClass: 'com.ibm.as400.access.AS400JDBCDriver',
    });

    const queries = calls.filter((call) => call.op === 'query').map((call) => call.payload);
    expect(queries.map((query) => query.sql)).toEqual(['UPDATE T SET A = 1', 'SELECT COUNT(*) AS N FROM T']);
    expect(queries[0]).toMatchObject({ maxRows: 50, timeoutSeconds: 5 });
    expect(typeof queries[0].queryId).toBe('string');
  });

  it('keeps SQL PL blocks together and strips the final semicolon', async () => {
    const { bridge, calls } = fakeBridge();
    const driver = new Db2iDriver(bridge);

    await driver.executeQuery(
      profile(),
      'secret',
      'CREATE OR REPLACE PROCEDURE P1() BEGIN\n  UPDATE T SET A = 1;\n  UPDATE T SET B = 2;\nEND;\n/\nCALL P1()',
      [],
      { maxRows: 10, timeoutMs: 1000 },
    );

    expect(calls.filter((call) => call.op === 'query').map((call) => call.payload.sql)).toEqual([
      'CREATE OR REPLACE PROCEDURE P1() BEGIN\n  UPDATE T SET A = 1;\n  UPDATE T SET B = 2;\nEND',
      'CALL P1()',
    ]);
  });

  it('forwards cancellation to the running statement', async () => {
    const { bridge, calls } = fakeBridge();
    const driver = new Db2iDriver(bridge);
    let cancel: (() => Promise<void>) | undefined;

    const running = driver.executeQuery(profile(), 'secret', 'SELECT 1 FROM SYSIBM.SYSDUMMY1', [], {
      maxRows: 10,
      timeoutMs: 1000,
      onCancelAvailable: (fn) => (cancel = fn),
    });

    await running;
    await cancel?.();

    const cancelCall = calls.find((call) => call.op === 'cancel');
    const queryCall = calls.find((call) => call.op === 'query');
    expect(cancelCall?.payload.queryId).toBe(queryCall?.payload.queryId);
  });

  it('sends row changes as one transactional batch', async () => {
    const { bridge, calls } = fakeBridge([{ affected: [1, 1] }]);
    const driver = new Db2iDriver(bridge);

    const affected = await driver.executeInTransaction(profile(), 'secret', [
      { sql: 'UPDATE T SET A = ? WHERE K = ?', parameters: [1, 2], expectedRows: 1 },
      { sql: 'DELETE FROM T WHERE K = ?', parameters: [3], expectedRows: 1 },
    ]);

    expect(affected).toEqual([1, 1]);
    expect(calls.find((call) => call.op === 'batch')?.payload).toEqual({
      handle: 's1',
      statements: [
        { sql: 'UPDATE T SET A = ? WHERE K = ?', params: [1, 2], expectedRows: 1 },
        { sql: 'DELETE FROM T WHERE K = ?', params: [3], expectedRows: 1 },
      ],
    });
  });

  it('explains that EXPLAIN is not available', async () => {
    const driver = new Db2iDriver(fakeBridge().bridge);
    await expect(driver.explain()).rejects.toThrow(/Visual Explain/);
  });
});
