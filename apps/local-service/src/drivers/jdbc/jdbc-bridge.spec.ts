import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { JdbcBridge, JdbcBridgeError, locateBridge } from './jdbc-bridge';

const javaDir = path.resolve(__dirname, '../../../java');
const sqliteJar = path.join(javaDir, 'lib/test/sqlite-jdbc.jar');
const bridgeJar = path.join(javaDir, 'dist/tukaka-jdbc-bridge.jar');

/** Köprü derlenmemişse (JDK yok) entegrasyon testleri atlanır. */
const available = existsSync(sqliteJar) && existsSync(bridgeJar);
const describeIfBridge = available ? describe : describe.skip;

describe('locateBridge', () => {
  it('explains how to build the bridge when it is missing', () => {
    expect(() => locateBridge({ TUKAKA_JAVA_DIR: os.tmpdir() })).toThrow(/build:java/);
  });

  it('prefers the bundled JRE and adds extra classpath entries', () => {
    if (!available) return;

    const location = locateBridge({
      TUKAKA_JAVA_DIR: javaDir,
      TUKAKA_JAVA_HOME: '/opt/jre',
      JAVA_HOME: '/ignored',
      TUKAKA_JDBC_CLASSPATH: '/extra/driver.jar',
    });

    expect(location.java).toBe(path.join('/opt/jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
    expect(location.classpath[0]).toBe(bridgeJar);
    expect(location.classpath).toContain(path.join(javaDir, 'lib', 'jt400.jar'));
    expect(location.classpath.at(-1)).toBe('/extra/driver.jar');
  });

  it('reports a missing Java runtime clearly', async () => {
    const bridge = new JdbcBridge(() => ({ java: '/nonexistent/java', classpath: [] }));

    await expect(bridge.request('ping')).rejects.toThrow(/Java runtime not found/);
  });
});

describeIfBridge('JdbcBridge (with sqlite-jdbc)', () => {
  let directory: string;
  let bridge: JdbcBridge;
  let handle: string;

  beforeAll(async () => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'tukaka-jdbc-'));
    bridge = new JdbcBridge(() =>
      locateBridge({
        ...process.env,
        TUKAKA_JAVA_DIR: javaDir,
        TUKAKA_JDBC_CLASSPATH: sqliteJar,
      }),
    );

    ({ handle } = await bridge.open({ url: `jdbc:sqlite:${path.join(directory, 'test.db')}` }));

    await bridge.query({
      handle,
      sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL, data BLOB)',
    });
  }, 30_000);

  afterAll(() => {
    bridge.stop();
    rmSync(directory, { recursive: true, force: true });
  });

  it('runs parameterized writes in a transaction', async () => {
    const result = await bridge.batch({
      handle,
      statements: [
        { sql: 'INSERT INTO items (name, price) VALUES (?, ?)', params: ['Çay "demli"', 12.5], expectedRows: 1 },
        { sql: 'INSERT INTO items (name, price) VALUES (?, ?)', params: ['Simit', 7], expectedRows: 1 },
        { sql: "INSERT INTO items (name, data) VALUES ('bin', X'CAFE')", params: [], expectedRows: 1 },
      ],
    });

    expect(result.affected).toEqual([1, 1, 1]);
  });

  it('reads rows with columns in order and limits the result', async () => {
    const result = await bridge.query({
      handle,
      sql: 'SELECT id, name, price FROM items WHERE id >= ? ORDER BY id',
      params: [1],
      maxRows: 2,
    });

    expect(result.columns).toEqual(['id', 'name', 'price']);
    expect(result.rows).toEqual([
      { id: 1, name: 'Çay "demli"', price: 12.5 },
      { id: 2, name: 'Simit', price: 7 },
    ]);
    expect(result.truncated).toBe(true);
  });

  it('encodes binary values as hex', async () => {
    const result = await bridge.query({ handle, sql: "SELECT data FROM items WHERE name = 'bin'" });

    expect(result.rows[0]).toEqual({ data: '0xCAFE' });
  });

  it('rolls back when a row count check fails', async () => {
    await expect(
      bridge.batch({
        handle,
        statements: [
          { sql: 'UPDATE items SET name = ? WHERE id = ?', params: ['changed', 1], expectedRows: 1 },
          { sql: 'DELETE FROM items WHERE id = ?', params: [999], expectedRows: 1 },
        ],
      }),
    ).rejects.toThrow(/affected 0 row\(s\) instead of 1/);

    const after = await bridge.query({ handle, sql: 'SELECT name FROM items WHERE id = 1' });
    expect(after.rows[0]).toEqual({ name: 'Çay "demli"' });
  });

  it('reports SQL errors with details', async () => {
    const error = await bridge.query({ handle, sql: 'SELEC nonsense' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JdbcBridgeError);
    expect((error as Error).message).toMatch(/syntax error/);
  });

  it('handles concurrent requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        bridge.query({ handle, sql: 'SELECT ? AS n', params: [i] }),
      ),
    );

    expect(results.map((result) => result.rows[0].n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('reports update counts for writes', async () => {
    const result = await bridge.query({ handle, sql: "UPDATE items SET price = 1 WHERE name <> 'bin'" });

    expect(result.columns).toEqual([]);
    expect(result.affected).toBe(2);
  });

  it('restarts after the Java process dies', async () => {
    bridge.stop();

    // Kapanan süreçle birlikte havuz da gitti; yeniden açılabilmeli.
    const reopened = await bridge.open({ url: `jdbc:sqlite:${path.join(directory, 'test.db')}` });
    const result = await bridge.query({ handle: reopened.handle, sql: 'SELECT COUNT(*) AS n FROM items' });

    expect(result.rows[0]).toEqual({ n: 3 });
  });
});
