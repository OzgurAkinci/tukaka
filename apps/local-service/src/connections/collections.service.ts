import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ConnectionCollection } from '@tukaka/contracts';

import { DatabaseService } from '../database/database.service';
import { CreateCollectionDto, UpdateCollectionDto } from './dto/collection.dto';

@Injectable()
export class CollectionsService {
  constructor(private readonly databaseService: DatabaseService) {}

  findAll(): ConnectionCollection[] {
    return this.databaseService
      .getDatabase()
      .prepare(`
        SELECT *
        FROM connection_collections
        ORDER BY sort_order ASC, name COLLATE NOCASE ASC
      `)
      .all() as ConnectionCollection[];
  }

  findOne(id: string): ConnectionCollection {
    const collection = this.databaseService
      .getDatabase()
      .prepare('SELECT * FROM connection_collections WHERE id = ?')
      .get(id) as ConnectionCollection | undefined;

    if (!collection) {
      throw new NotFoundException('Collection not found.');
    }

    return collection;
  }

  exists(id: string): boolean {
    return Boolean(
      this.databaseService
        .getDatabase()
        .prepare('SELECT 1 FROM connection_collections WHERE id = ?')
        .get(id),
    );
  }

  create(dto: CreateCollectionDto): ConnectionCollection {
    const database = this.databaseService.getDatabase();
    const id = randomUUID();

    // Yeni koleksiyon listenin sonuna eklenir.
    const { next } = database
      .prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM connection_collections')
      .get() as { next: number };

    const result = database
      .prepare(`
        INSERT INTO connection_collections (id, name, color, sort_order)
        VALUES (@id, @name, @color, @sort_order)
      `)
      .run({
        id,
        name: dto.name.trim(),
        color: dto.color ?? null,
        sort_order: next,
      });

    if (result.changes !== 1) {
      throw new InternalServerErrorException('Collection could not be created.');
    }

    return this.findOne(id);
  }

  update(id: string, dto: UpdateCollectionDto): ConnectionCollection {
    const current = this.findOne(id);

    this.databaseService
      .getDatabase()
      .prepare(`
        UPDATE connection_collections
        SET
          name = @name,
          color = @color,
          sort_order = @sort_order,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `)
      .run({
        id,
        name: dto.name?.trim() ?? current.name,
        color: dto.color !== undefined ? dto.color : current.color,
        sort_order: dto.sortOrder ?? current.sort_order,
      });

    return this.findOne(id);
  }

  /** Koleksiyonu siler; içindeki bağlantılar silinmez, gruplanmamışa döner. */
  remove(id: string): void {
    this.findOne(id);

    const database = this.databaseService.getDatabase();

    database.transaction(() => {
      database
        .prepare('UPDATE connection_profiles SET collection_id = NULL WHERE collection_id = ?')
        .run(id);
      database.prepare('DELETE FROM connection_collections WHERE id = ?').run(id);
    })();
  }
}
