import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AppModule } from './../src/app.module';

const TOKEN = 'e2e-test-token';

describe('Local service (e2e)', () => {
  let app: INestApplication<App>;
  let dataDirectory: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tukaka-e2e-'));
    process.env.TUKAKA_DATA_DIR = dataDirectory;
    process.env.TUKAKA_SESSION_TOKEN = TOKEN;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    process.env = { ...originalEnv };
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  it('/health is public', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('ok');
      });
  });

  it('rejects requests without the session token', () => {
    return request(app.getHttpServer()).get('/connections').expect(401);
  });

  it('rejects requests with a wrong session token', () => {
    return request(app.getHttpServer())
      .get('/connections')
      .set('Authorization', 'Bearer nope')
      .expect(401);
  });

  it('returns 400 for a non-UUID connection id', () => {
    return request(app.getHttpServer())
      .post('/connections/not-a-uuid/test')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(400);
  });

  it('creates a SQLite connection and runs a limited query', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${TOKEN}` };

    const sqliteFile = path.join(dataDirectory, 'sample.sqlite');
    fs.writeFileSync(sqliteFile, '');

    const created = await request(server)
      .post('/connections')
      .set(auth)
      .send({ name: 'Sample', type: 'sqlite', database: sqliteFile })
      .expect(201);

    const id = created.body.id as string;

    await request(server)
      .post(`/connections/${id}/query`)
      .set(auth)
      .send({
        sql: 'CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1),(2),(3),(4),(5);',
      })
      .expect(201);

    const result = await request(server)
      .post(`/connections/${id}/query`)
      .set(auth)
      .send({ sql: 'SELECT n FROM t ORDER BY n', maxRows: 2 })
      .expect(201);

    expect(result.body).toMatchObject({
      success: true,
      columns: ['n'],
      rows: [{ n: 1 }, { n: 2 }],
      truncated: true,
    });

    const syntaxError = await request(server)
      .post(`/connections/${id}/query`)
      .set(auth)
      .send({ sql: 'SELEC 1' })
      .expect(400);

    expect(syntaxError.body.message).toMatch(/syntax error/);

    const profile = await request(server)
      .get(`/connections/${id}`)
      .set(auth)
      .expect(200);

    expect(profile.body.last_connected_at).not.toBeNull();

    await request(server).delete(`/connections/${id}`).set(auth).expect(200);
  });

  it('browses table data, completion, history and saved queries', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${TOKEN}` };

    const sqliteFile = path.join(dataDirectory, 'shop.sqlite');
    fs.writeFileSync(sqliteFile, '');

    const { body: connection } = await request(server)
      .post('/connections')
      .set(auth)
      .send({ name: 'Shop', type: 'sqlite', database: sqliteFile })
      .expect(201);

    const values = Array.from(
      { length: 30 },
      (_, i) => `(${i + 1}, 'item ${i + 1}', ${i % 2 === 0 ? 'NULL' : i})`,
    ).join(',');

    await request(server)
      .post(`/connections/${connection.id}/query`)
      .set(auth)
      .send({
        sql: `CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, stock INTEGER); INSERT INTO products VALUES ${values};`,
      })
      .expect(201);

    const dataUrl = `/connections/${connection.id}/schemas/main/tables/products/data`;

    const page = await request(server)
      .post(dataUrl)
      .set(auth)
      .send({
        limit: 5,
        offset: 5,
        sort: { column: 'id', direction: 'desc' },
      })
      .expect(201);

    expect(page.body).toMatchObject({
      totalCount: 30,
      hasMore: true,
      columns: ['id', 'name', 'stock'],
    });
    expect(page.body.rows.map((row: { id: number }) => row.id)).toEqual([
      25, 24, 23, 22, 21,
    ]);

    const filtered = await request(server)
      .post(dataUrl)
      .set(auth)
      .send({
        filters: [
          { column: 'stock', operator: 'isNotNull' },
          { column: 'name', operator: 'contains', value: 'ITEM 1' },
        ],
      })
      .expect(201);

    // stock dolu olanlar çift id'ler; adında 'item 1' geçenler: 10, 12, 14, 16, 18.
    expect(filtered.body.totalCount).toBe(5);
    expect(filtered.body.hasMore).toBe(false);

    await request(server)
      .post(dataUrl)
      .set(auth)
      .send({ sort: { column: 'nope', direction: 'asc' } })
      .expect(400);

    await request(server)
      .post(`/connections/${connection.id}/schemas/main/tables/missing/data`)
      .set(auth)
      .send({})
      .expect(404);

    const completion = await request(server)
      .get(`/connections/${connection.id}/completion`)
      .set(auth)
      .expect(200);

    expect(completion.body).toMatchObject({
      defaultSchema: 'main',
      schemas: { main: { products: ['id', 'name', 'stock'] } },
      truncated: false,
    });

    const history = await request(server)
      .get('/history')
      .query({ connectionId: connection.id })
      .set(auth)
      .expect(200);

    // Data Viewer sorguları geçmişe yazılmaz; yalnızca editörden çalışan sorgu.
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      status: 'success',
      connectionName: 'Shop',
    });

    const savedQuery = await request(server)
      .post('/saved-queries')
      .set(auth)
      .send({
        name: 'Low stock',
        sql: 'SELECT * FROM products WHERE stock < 5',
        connectionId: connection.id,
      })
      .expect(201);

    await request(server)
      .patch(`/saved-queries/${savedQuery.body.id}`)
      .set(auth)
      .send({ name: 'Very low stock' })
      .expect(200);

    const savedList = await request(server)
      .get('/saved-queries')
      .set(auth)
      .expect(200);

    expect(savedList.body).toEqual([
      expect.objectContaining({ name: 'Very low stock' }),
    ]);

    await request(server)
      .post('/queries/44444444-4444-4444-8444-444444444444/cancel')
      .set(auth)
      .expect(201)
      .expect((response) => {
        expect(response.body.cancelled).toBe(false);
      });
  });
});
