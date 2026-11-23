import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { DatabaseService } from './database.service';
import { migrations } from './migrations';

describe('DatabaseService migrations', () => {
  let directory: string;
  const originalDataDir = process.env.TUKAKA_DATA_DIR;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tukaka-db-'));
    process.env.TUKAKA_DATA_DIR = directory;
  });

  afterEach(() => {
    process.env.TUKAKA_DATA_DIR = originalDataDir;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const latest = Math.max(...migrations.map((migration) => migration.version));

  it('creates a fresh database at the latest version', () => {
    const service = new DatabaseService();
    service.onModuleInit();

    const db = service.getDatabase();

    expect(db.pragma('user_version', { simple: true })).toBe(latest);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual(
      expect.arrayContaining([
        'app_metadata',
        'connection_profiles',
        'query_history',
        'saved_queries',
      ]),
    );

    service.onModuleDestroy();
  });

  it('upgrades a pre-migration database without losing data', () => {
    // Geçiş sisteminden önceki sürüm: user_version = 0, yalnızca eski tablolar.
    const legacy = new Database(path.join(directory, 'studio.sqlite'));
    legacy.exec(migrations[0].up);
    legacy
      .prepare(
        "INSERT INTO connection_profiles (id, name, type, database) VALUES ('x', 'Legacy', 'sqlite', '/tmp/a.db')",
      )
      .run();
    legacy.close();

    const service = new DatabaseService();
    service.onModuleInit();

    const db = service.getDatabase();

    expect(db.pragma('user_version', { simple: true })).toBe(latest);
    expect(db.prepare('SELECT name FROM connection_profiles').get()).toEqual({
      name: 'Legacy',
    });

    service.onModuleDestroy();
  });
});
