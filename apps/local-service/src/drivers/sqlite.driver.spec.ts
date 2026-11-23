import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SqliteDriver } from './sqlite.driver';
import { makeProfile } from './test-helpers';

describe('SqliteDriver', () => {
  let directory: string;
  let driver: SqliteDriver;
  let profile: ReturnType<typeof makeProfile>;

  const options = { maxRows: 1000, timeoutMs: 30_000 };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tukaka-sqlite-'));
    const file = path.join(directory, 'test.sqlite');

    const seed = new Database(file);
    seed.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title TEXT
      );
    `);
    const insert = seed.prepare('INSERT INTO users (name) VALUES (?)');
    for (let i = 1; i <= 25; i++) insert.run(`user ${i}`);
    seed.close();

    driver = new SqliteDriver();
    profile = makeProfile({ database: file });
  });

  afterEach(async () => {
    await driver.releaseAll();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('runs a SELECT and returns columns and rows', async () => {
    const result = await driver.executeQuery(
      profile,
      null,
      'SELECT id, name FROM users WHERE id = ?',
      [3],
      options,
    );

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows).toEqual([{ id: 3, name: 'user 3' }]);
    expect(result.truncated).toBe(false);
  });

  it('limits rows and flags truncation', async () => {
    const result = await driver.executeQuery(
      profile,
      null,
      'SELECT * FROM users',
      [],
      { ...options, maxRows: 10 },
    );

    expect(result.rows).toHaveLength(10);
    expect(result.rowCount).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it('returns affected rows for writes', async () => {
    const result = await driver.executeQuery(
      profile,
      null,
      "UPDATE users SET name = 'x' WHERE id <= 5",
      [],
      options,
    );

    expect(result.columns).toEqual([]);
    expect(result.rowCount).toBe(5);
  });

  it('runs multi-statement scripts atomically', async () => {
    const result = await driver.executeQuery(
      profile,
      null,
      "INSERT INTO users (name) VALUES ('a'); INSERT INTO users (name) VALUES ('b');",
      [],
      options,
    );

    expect(result.rowCount).toBe(2);
    expect(result.statementCount).toBe(2);

    await expect(
      driver.executeQuery(
        profile,
        null,
        "INSERT INTO users (name) VALUES ('c'); INSERT INTO missing VALUES (1);",
        [],
        options,
      ),
    ).rejects.toThrow(/no such table/);

    const count = await driver.executeQuery(
      profile,
      null,
      'SELECT COUNT(*) AS total FROM users',
      [],
      options,
    );

    // 25 seed + 2; 'c' geri alınmış olmalı.
    expect(count.rows[0]).toEqual({ total: 27 });
  });

  it('returns the rows of the last SELECT in a script', async () => {
    const result = await driver.executeQuery(
      profile,
      null,
      "-- comment; with semicolon\nINSERT INTO users (name) VALUES ('semi;colon');\nSELECT name FROM users WHERE name LIKE '%;%';",
      [],
      options,
    );

    expect(result.statementCount).toBe(2);
    expect(result.columns).toEqual(['name']);
    expect(result.rows).toEqual([{ name: 'semi;colon' }]);
  });

  it('keeps trigger bodies together in scripts', async () => {
    await driver.executeQuery(
      profile,
      null,
      `CREATE TABLE audit (msg TEXT);
       CREATE TRIGGER users_ai AFTER INSERT ON users BEGIN
         INSERT INTO audit VALUES ('added ' || NEW.name);
       END;
       INSERT INTO users (name) VALUES ('zed');
       SELECT msg FROM audit;`,
      [],
      options,
    );

    const audit = await driver.executeQuery(
      profile,
      null,
      'SELECT msg FROM audit',
      [],
      options,
    );

    expect(audit.rows).toEqual([{ msg: 'added zed' }]);
  });

  it('respects explicit transaction control in scripts', async () => {
    const result = await driver.executeQuery(
      profile,
      null,
      "BEGIN; INSERT INTO users (name) VALUES ('t1'); COMMIT; SELECT COUNT(*) AS n FROM users;",
      [],
      options,
    );

    expect(result.rows).toEqual([{ n: 26 }]);
  });

  it('lists schemas, tables and columns', async () => {
    expect(await driver.getSchemas(profile, null)).toEqual([{ name: 'main' }]);

    expect(await driver.getTables(profile, null, 'main')).toEqual([
      { name: 'posts', schema: 'main', type: 'table' },
      { name: 'users', schema: 'main', type: 'table' },
    ]);

    const columns = await driver.getColumns(profile, null, 'main', 'posts');

    expect(columns.map((c) => [c.name, c.isPrimaryKey, c.isForeignKey])).toEqual(
      [
        ['id', true, false],
        ['user_id', false, true],
        ['title', false, false],
      ],
    );
  });

  it('reports indexes, foreign keys and DDL', async () => {
    await driver.executeQuery(
      profile,
      null,
      'CREATE UNIQUE INDEX users_name_idx ON users(name)',
      [],
      options,
    );

    const indexes = await driver.getIndexes(profile, null, 'main', 'users');
    expect(indexes).toEqual([
      { name: 'PRIMARY KEY', columns: ['id'], unique: true, primary: true },
      { name: 'users_name_idx', columns: ['name'], unique: true, primary: false },
    ]);

    expect(await driver.getForeignKeys(profile, null, 'main')).toEqual([
      {
        name: 'fk_posts_0',
        table: 'posts',
        columns: ['user_id'],
        referencedSchema: 'main',
        referencedTable: 'users',
        referencedColumns: ['id'],
      },
    ]);

    const ddl = await driver.getTableDdl(profile, null, 'main', 'users');
    expect(ddl).toContain('CREATE TABLE users');
    expect(ddl).toContain('CREATE UNIQUE INDEX users_name_idx');
    expect(await driver.getTableDdl(profile, null, 'main', 'missing')).toBeNull();

    const columns = await driver.getSchemaColumns(profile, null, 'main');
    expect(columns.filter((c) => c.table === 'posts').map((c) => c.name)).toEqual([
      'id',
      'user_id',
      'title',
    ]);
  });

  it('explains a query as a tree without running it', async () => {
    const plan = await driver.explain(
      profile,
      null,
      'SELECT * FROM posts p JOIN users u ON u.id = p.user_id WHERE u.name = 1;',
    );

    expect(plan.nodes.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan.nodes)).toMatch(/SCAN|SEARCH/);

    await expect(
      driver.explain(profile, null, 'SELECT 1; DELETE FROM users'),
    ).rejects.toThrow(/more than one statement/);

    const count = await driver.executeQuery(profile, null, 'SELECT COUNT(*) AS n FROM users', [], options);
    expect(count.rows[0]).toEqual({ n: 25 });
  });

  it('rolls back a transaction when a row count check fails', async () => {
    await expect(
      driver.executeInTransaction(profile, null, [
        { sql: "UPDATE users SET name = 'changed' WHERE id = ?", parameters: [1], expectedRows: 1 },
        { sql: 'DELETE FROM users WHERE id = ?', parameters: [9999], expectedRows: 1 },
      ]),
    ).rejects.toThrow(/affected 0 row/);

    const row = await driver.executeQuery(profile, null, 'SELECT name FROM users WHERE id = 1', [], options);
    expect(row.rows[0]).toEqual({ name: 'user 1' });

    await expect(
      driver.executeInTransaction(profile, null, [
        { sql: "UPDATE users SET name = 'changed' WHERE id = ?", parameters: [1], expectedRows: 1 },
      ]),
    ).resolves.toEqual([1]);
  });

  it('fails for a missing database file', async () => {
    await expect(
      driver.testConnection(
        makeProfile({ id: 'missing', database: path.join(directory, 'nope.db') }),
        null,
      ),
    ).rejects.toThrow();
  });
});
