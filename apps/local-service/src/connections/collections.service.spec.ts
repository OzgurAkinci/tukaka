import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { DatabaseService } from '../database/database.service';
import { CollectionsService } from './collections.service';

describe('CollectionsService', () => {
  let directory: string;
  let database: DatabaseService;
  let service: CollectionsService;
  const originalDataDir = process.env.TUKAKA_DATA_DIR;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tukaka-collections-'));
    process.env.TUKAKA_DATA_DIR = directory;
    database = new DatabaseService();
    database.onModuleInit();
    service = new CollectionsService(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    process.env.TUKAKA_DATA_DIR = originalDataDir;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const insertConnection = (id: string, collectionId: string | null) =>
    database
      .getDatabase()
      .prepare(
        `INSERT INTO connection_profiles (id, name, type, database, collection_id)
         VALUES (?, ?, 'sqlite', ':memory:', ?)`,
      )
      .run(id, id, collectionId);

  const collectionOf = (id: string) =>
    (
      database
        .getDatabase()
        .prepare('SELECT collection_id FROM connection_profiles WHERE id = ?')
        .get(id) as { collection_id: string | null }
    ).collection_id;

  it('appends new collections in order and updates them', () => {
    const first = service.create({ name: ' Production ' });
    const second = service.create({ name: 'Staging', color: '#22c55e' });

    expect(first).toMatchObject({ name: 'Production', color: null, sort_order: 0 });
    expect(second).toMatchObject({ color: '#22c55e', sort_order: 1 });

    service.update(second.id, { sortOrder: 0, name: 'Stage' });
    service.update(first.id, { sortOrder: 1, color: null });

    expect(service.findAll().map((item) => item.name)).toEqual(['Stage', 'Production']);
  });

  it('ungroups connections when their collection is deleted', () => {
    const collection = service.create({ name: 'Analytics' });
    insertConnection('a', collection.id);
    insertConnection('b', null);

    service.remove(collection.id);

    expect(collectionOf('a')).toBeNull();
    expect(collectionOf('b')).toBeNull();
    expect(service.findAll()).toEqual([]);
    expect(() => service.findOne(collection.id)).toThrow('Collection not found.');
  });
});
