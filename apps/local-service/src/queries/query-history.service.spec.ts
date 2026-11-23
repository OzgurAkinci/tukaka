import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { DatabaseService } from '../database/database.service';
import {
  MAX_HISTORY_ENTRIES,
  QueryHistoryService,
  escapeLike,
} from './query-history.service';
import { SavedQueriesService } from './saved-queries.service';

describe('Query history and saved queries', () => {
  let directory: string;
  let database: DatabaseService;
  let history: QueryHistoryService;
  let saved: SavedQueriesService;
  const originalDataDir = process.env.TUKAKA_DATA_DIR;

  const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tukaka-history-'));
    process.env.TUKAKA_DATA_DIR = directory;

    database = new DatabaseService();
    database.onModuleInit();
    database
      .getDatabase()
      .prepare(
        "INSERT INTO connection_profiles (id, name, type, database) VALUES (?, 'Local', 'sqlite', '/tmp/a.db')",
      )
      .run(CONNECTION_ID);

    history = new QueryHistoryService(database);
    saved = new SavedQueriesService(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    process.env.TUKAKA_DATA_DIR = originalDataDir;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const record = (sql: string, status: 'success' | 'error' = 'success') =>
    history.record({
      connectionId: CONNECTION_ID,
      connectionName: 'Local',
      sql,
      status,
      rowCount: status === 'success' ? 1 : null,
      durationMs: 3,
      errorMessage: status === 'error' ? 'boom' : null,
    });

  it('records and returns newest first', () => {
    record('SELECT 1');
    record('SELECT 2', 'error');

    const entries = history.findAll();

    expect(entries.map((entry) => entry.sql)).toEqual(['SELECT 2', 'SELECT 1']);
    expect(entries[0]).toMatchObject({
      status: 'error',
      errorMessage: 'boom',
      connectionName: 'Local',
    });
    expect(entries[0].executedAt).toMatch(/Z$/);
  });

  it('searches with LIKE wildcards escaped', () => {
    record('SELECT 100%');
    record('SELECT 1000');

    expect(history.findAll({ search: '100%' }).map((e) => e.sql)).toEqual([
      'SELECT 100%',
    ]);
    expect(escapeLike('a%b_c!')).toBe('a!%b!_c!!');
  });

  it('keeps at most MAX_HISTORY_ENTRIES entries', () => {
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) {
      record(`SELECT ${i}`);
    }

    const all = history.findAll({ limit: 1000 });
    const total = database
      .getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM query_history')
      .get() as { n: number };

    expect(total.n).toBe(MAX_HISTORY_ENTRIES);
    expect(all[0].sql).toBe(`SELECT ${MAX_HISTORY_ENTRIES + 4}`);
  });

  it('keeps history but nulls the connection when it is deleted', () => {
    record('SELECT 1');

    database
      .getDatabase()
      .prepare('DELETE FROM connection_profiles WHERE id = ?')
      .run(CONNECTION_ID);

    expect(history.findAll()[0]).toMatchObject({
      connectionId: null,
      connectionName: 'Local',
    });
  });

  it('clears history per connection', () => {
    record('SELECT 1');
    expect(history.clear(CONNECTION_ID)).toBe(1);
    expect(history.findAll()).toEqual([]);
  });

  it('manages saved queries', () => {
    const created = saved.create({
      name: ' Active users ',
      sql: 'SELECT * FROM users',
      connectionId: CONNECTION_ID,
    });

    expect(created).toMatchObject({
      name: 'Active users',
      connectionId: CONNECTION_ID,
    });

    const updated = saved.update(created.id, { sql: 'SELECT 1' });
    expect(updated.sql).toBe('SELECT 1');
    expect(updated.name).toBe('Active users');

    expect(saved.findAll()).toHaveLength(1);

    expect(() =>
      saved.create({
        name: 'x',
        sql: 'SELECT 1',
        connectionId: '33333333-3333-4333-8333-333333333333',
      }),
    ).toThrow('Connection not found.');

    saved.remove(created.id);
    expect(saved.findAll()).toEqual([]);
  });
});
