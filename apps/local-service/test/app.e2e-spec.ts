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
});
