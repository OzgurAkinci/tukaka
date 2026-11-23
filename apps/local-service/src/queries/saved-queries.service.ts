
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreateSavedQueryPayload,
  SavedQuery,
  UpdateSavedQueryPayload,
} from '@tukaka/contracts';

import { DatabaseService } from '../database/database.service';

interface SavedQueryRow {
  id: string;
  name: string;
  connection_id: string | null;
  sql: string;
  created_at: string;
  updated_at: string;
}

/** Var olmayan bir bağlantıya referans verilirse 400 döndür. */
function rethrowForeignKey(error: unknown): never {
  if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    throw new BadRequestException('Connection not found.');
  }

  throw error;
}

function toSavedQuery(row: SavedQueryRow): SavedQuery {
  return {
    id: row.id,
    name: row.name,
    connectionId: row.connection_id,
    sql: row.sql,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class SavedQueriesService {
  constructor(private readonly databaseService: DatabaseService) {}

  findAll(): SavedQuery[] {
    const rows = this.databaseService
      .getDatabase()
      .prepare('SELECT * FROM saved_queries ORDER BY name COLLATE NOCASE')
      .all() as SavedQueryRow[];

    return rows.map(toSavedQuery);
  }

  findOne(id: string): SavedQuery {
    const row = this.databaseService
      .getDatabase()
      .prepare('SELECT * FROM saved_queries WHERE id = ?')
      .get(id) as SavedQueryRow | undefined;

    if (!row) {
      throw new NotFoundException('Saved query not found.');
    }

    return toSavedQuery(row);
  }

  create(payload: CreateSavedQueryPayload): SavedQuery {
    const id = randomUUID();

    try {
      this.databaseService
      .getDatabase()
      .prepare(
        `
        INSERT INTO saved_queries (id, name, connection_id, sql)
        VALUES (@id, @name, @connectionId, @sql)
      `,
      )
      .run({
        id,
        name: payload.name.trim(),
        connectionId: payload.connectionId ?? null,
        sql: payload.sql,
      });
    } catch (error) {
      rethrowForeignKey(error);
    }

    return this.findOne(id);
  }

  update(id: string, payload: UpdateSavedQueryPayload): SavedQuery {
    const current = this.findOne(id);

    try {
      this.databaseService
      .getDatabase()
      .prepare(
        `
        UPDATE saved_queries
        SET
          name = @name,
          connection_id = @connectionId,
          sql = @sql,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = @id
      `,
      )
      .run({
        id,
        name: payload.name?.trim() ?? current.name,
        connectionId:
          payload.connectionId === undefined
            ? current.connectionId
            : payload.connectionId,
        sql: payload.sql ?? current.sql,
      });
    } catch (error) {
      rethrowForeignKey(error);
    }

    return this.findOne(id);
  }

  remove(id: string): void {
    const result = this.databaseService
      .getDatabase()
      .prepare('DELETE FROM saved_queries WHERE id = ?')
      .run(id);

    if (result.changes === 0) {
      throw new NotFoundException('Saved query not found.');
    }
  }
}
