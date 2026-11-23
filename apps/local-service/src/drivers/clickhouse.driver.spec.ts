import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  ClickHouseDriver,
  explainLinesToNodes,
  isReadStatement,
} from './clickhouse.driver';
import { makeProfile } from './test-helpers';

interface Captured {
  query: string;
  params: URLSearchParams;
}

/**
 * ClickHouse HTTP arayüzünü taklit eden sunucu: SELECT'lere JSON döner,
 * diğer ifadelere boş gövde ve özet başlığı döner.
 */
function startFakeClickHouse(captured: Captured[]) {
  return http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
      const query = params.get('query') ?? body;
      const format = params.get('default_format');
      captured.push({ query, params });

      if (format === 'JSON') {
        const data = Array.from({ length: 5 }, (_, i) => ({ n: i + 1 }));
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({ meta: [{ name: 'n', type: 'UInt8' }], data, rows: data.length }),
        );
        return;
      }

      if (format === 'JSONEachRow') {
        response.end(`${JSON.stringify({ ok: 1 })}\n`);
        return;
      }

      response.setHeader('X-ClickHouse-Summary', JSON.stringify({ written_rows: '3' }));
      response.end('');
    });
  });
}

describe('ClickHouseDriver', () => {
  let server: http.Server;
  let captured: Captured[];
  let driver: ClickHouseDriver;
  let profile: ReturnType<typeof makeProfile>;

  beforeEach(async () => {
    captured = [];
    server = startFakeClickHouse(captured);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    driver = new ClickHouseDriver();
    profile = makeProfile({
      type: 'clickhouse',
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      database: 'analytics',
      username: 'default',
      ssl_mode: 'prefer',
    });
  });

  afterEach(async () => {
    await driver.releaseAll();
    await new Promise((resolve) => server.close(resolve));
  });

  it('runs SELECTs as JSON with a server-side row limit', async () => {
    const result = await driver.executeQuery(profile, null, 'SELECT n FROM t;', [], {
      maxRows: 3,
      timeoutMs: 5000,
    });

    expect(result.columns).toEqual(['n']);
    expect(result.rows).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(result.truncated).toBe(true);

    const request = captured[0];
    expect(request.params.get('database')).toBe('analytics');
    expect(request.params.get('max_result_rows')).toBe('4');
    expect(request.params.get('result_overflow_mode')).toBe('break');
    expect(request.params.get('max_execution_time')).toBe('5');
    expect(request.params.get('query_id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends DDL/DML through command and runs scripts statement by statement', async () => {
    const result = await driver.executeQuery(
      profile,
      null,
      'CREATE TABLE x (n UInt8) ENGINE = Memory; INSERT INTO x VALUES (1),(2),(3);',
      [],
      { maxRows: 100, timeoutMs: 5000 },
    );

    expect(captured.map((request) => request.query.trim())).toEqual([
      'CREATE TABLE x (n UInt8) ENGINE = Memory',
      'INSERT INTO x VALUES (1),(2),(3)',
    ]);
    expect(result.columns).toEqual([]);
    expect(result.rowCount).toBe(3);
    expect(result.statementCount).toBe(2);
  });

  it('passes parameters as typed query params', async () => {
    await driver.executeQuery(profile, null, 'SELECT n FROM t WHERE s = {p1:String}', ['a'], {
      maxRows: 10,
      timeoutMs: 5000,
    });

    expect(captured[0].params.get('param_p1')).toBe('a');
  });

  it('refuses transactional row editing', async () => {
    await expect(driver.executeInTransaction(profile, null, [])).rejects.toThrow(
      /does not support/,
    );
  });

  it('classifies statements', () => {
    expect(isReadStatement('  -- c\nSELECT 1')).toBe(true);
    expect(isReadStatement('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true);
    expect(isReadStatement('SHOW TABLES')).toBe(true);
    expect(isReadStatement('INSERT INTO t SELECT 1')).toBe(false);
    expect(isReadStatement('ALTER TABLE t DELETE WHERE 1')).toBe(false);
  });

  it('parses indented EXPLAIN PLAN output into a tree', () => {
    const nodes = explainLinesToNodes([
      'Expression ((Projection + Before ORDER BY))',
      '  Filter (WHERE)',
      '    ReadFromMergeTree (default.hits)',
      '    Indexes:',
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: 'Expression', detail: '(Projection + Before ORDER BY)' });
    expect(nodes[0].children[0].children.map((node) => node.label)).toEqual([
      'ReadFromMergeTree',
      'Indexes:',
    ]);
  });
});
