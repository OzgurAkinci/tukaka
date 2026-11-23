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
    expect(result.statementCount).toBeNull();

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

  it('fails for a missing database file', async () => {
    await expect(
      driver.testConnection(
        makeProfile({ id: 'missing', database: path.join(directory, 'nope.db') }),
        null,
      ),
    ).rejects.toThrow();
  });
});
