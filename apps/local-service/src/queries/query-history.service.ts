
import { Injectable, NotFoundException } from '@nestjs/common';
import type { QueryHistoryEntry } from '@tukaka/contracts';

import { DatabaseService } from '../database/database.service';

/** Tutulacak en fazla geçmiş kaydı; eskiler otomatik silinir. */
export const MAX_HISTORY_ENTRIES = 2000;

interface HistoryRow {
  id: number;
  connection_id: string | null;
  connection_name: string | null;
  sql: string;
  status: 'success' | 'error';
  error_message: string | null;
  row_count: number | null;
  duration_ms: number | null;
  executed_at: string;
}

export interface RecordHistoryInput {
  connectionId: string;
  connectionName: string;
  sql: string;
  status: 'success' | 'error';
  errorMessage?: string | null;
  rowCount?: number | null;
  durationMs?: number | null;
}

export interface FindHistoryOptions {
  connectionId?: string;
  search?: string;
  limit?: number;
}

function toEntry(row: HistoryRow): QueryHistoryEntry {
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    sql: row.sql,
    status: row.status,
    errorMessage: row.error_message,
    rowCount: row.row_count,
    durationMs: row.duration_ms,
    executedAt: row.executed_at,
  };
}

/** LIKE desenindeki özel karakterleri `!` ile kaçırır. */
export function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

@Injectable()
export class QueryHistoryService {
  constructor(private readonly databaseService: DatabaseService) {}

  record(input: RecordHistoryInput): void {
    const database = this.databaseService.getDatabase();

    database.transaction(() => {
      database
        .prepare(
          `
          INSERT INTO query_history (
            connection_id, connection_name, sql, status,
            error_message, row_count, duration_ms
          )
          VALUES (
            @connectionId, @connectionName, @sql, @status,
            @errorMessage, @rowCount, @durationMs
          )
        `,
        )
        .run({
          connectionId: input.connectionId,
          connectionName: input.connectionName,
          sql: input.sql,
          status: input.status,
          errorMessage: input.errorMessage ?? null,
          rowCount: input.rowCount ?? null,
          durationMs: input.durationMs ?? null,
        });

      database
        .prepare(
          `
          DELETE FROM query_history
          WHERE id <= (
            SELECT id FROM query_history
            ORDER BY id DESC
            LIMIT 1 OFFSET ?
          )
        `,
        )
        .run(MAX_HISTORY_ENTRIES);
    })();
  }

  findAll(options: FindHistoryOptions = {}): QueryHistoryEntry[] {
    const conditions: string[] = [];
    const parameters: Record<string, unknown> = {
      limit: Math.min(Math.max(options.limit ?? 200, 1), 1000),
    };

    if (options.connectionId) {
      conditions.push('connection_id = @connectionId');
      parameters.connectionId = options.connectionId;
    }

    if (options.search?.trim()) {
      conditions.push("sql LIKE @search ESCAPE '!'");
      parameters.search = `%${escapeLike(options.search.trim())}%`;
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const rows = this.databaseService
      .getDatabase()
      .prepare(
        `
        SELECT *
        FROM query_history
        ${where}
        ORDER BY id DESC
        LIMIT @limit
      `,
      )
      .all(parameters) as HistoryRow[];

    return rows.map(toEntry);
  }

  remove(id: number): void {
    const result = this.databaseService
      .getDatabase()
      .prepare('DELETE FROM query_history WHERE id = ?')
      .run(id);

    if (result.changes === 0) {
      throw new NotFoundException('History entry not found.');
    }
  }

  clear(connectionId?: string): number {
    const database = this.databaseService.getDatabase();

    const result = connectionId
      ? database
          .prepare('DELETE FROM query_history WHERE connection_id = ?')
          .run(connectionId)
      : database.prepare('DELETE FROM query_history').run();

    return result.changes;
  }
}
