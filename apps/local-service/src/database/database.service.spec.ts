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

describe('Migration 3 (connection type constraint)', () => {
  let directory: string;
  const originalDataDir = process.env.TUKAKA_DATA_DIR;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tukaka-db3-'));
    process.env.TUKAKA_DATA_DIR = directory;
  });

  afterEach(() => {
    process.env.TUKAKA_DATA_DIR = originalDataDir;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('keeps history links when rebuilding connection_profiles', () => {
    // v2 veritabanı: bağlantı + ona bağlı geçmiş kaydı.
    const legacy = new Database(path.join(directory, 'studio.sqlite'));
    legacy.pragma('foreign_keys = ON');
    legacy.exec(migrations[0].up);
    legacy.exec(migrations[1].up);
    legacy.pragma('user_version = 2');
    legacy
      .prepare(
        "INSERT INTO connection_profiles (id, name, type, database) VALUES ('c1', 'PG', 'postgresql', 'db')",
      )
      .run();
    legacy
      .prepare(
        "INSERT INTO query_history (connection_id, connection_name, sql, status) VALUES ('c1', 'PG', 'SELECT 1', 'success')",
      )
      .run();
    legacy.close();

    const service = new DatabaseService();
    service.onModuleInit();
    const db = service.getDatabase();

    expect(db.prepare('SELECT connection_id FROM query_history').get()).toEqual({
      connection_id: 'c1',
    });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

    // Yeni tipler artık kabul edilir.
    expect(() =>
      db
        .prepare(
          "INSERT INTO connection_profiles (id, name, type, database) VALUES ('c2', 'CH', 'clickhouse', 'default'), ('c3', 'ORA', 'oracle', 'FREEPDB1')",
        )
        .run(),
    ).not.toThrow();

    // Silme hâlâ geçmişi koruyarak bağlantıyı ayırır (FK çalışıyor).
    db.prepare("DELETE FROM connection_profiles WHERE id = 'c1'").run();
    expect(db.prepare('SELECT connection_id FROM query_history').get()).toEqual({
      connection_id: null,
    });

    service.onModuleDestroy();
  });
});
