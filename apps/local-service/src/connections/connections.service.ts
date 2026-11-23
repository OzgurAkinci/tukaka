
import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { DatabaseService } from '../database/database.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { CredentialService } from '../credentials/credential.service';
import { ConnectionEventsService } from './connection-events.service';


export interface ConnectionProfile {
    id: string;
    name: string;
    type: 'postgresql' | 'mysql' | 'sqlite';
    host: string | null;
    port: number | null;
    database: string;
    username: string | null;
    credential_key: string | null;
    ssl_mode: string;
    options_json: string;
    created_at: string;
    updated_at: string;
    last_connected_at: string | null;
}

@Injectable()
export class ConnectionsService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly credentialService: CredentialService,
        private readonly connectionEvents: ConnectionEventsService,
    ) { }

    create(dto: CreateConnectionDto): ConnectionProfile {
        const database = this.databaseService.getDatabase();
        const id = randomUUID();

        const result = database
            .prepare(`
        INSERT INTO connection_profiles (
          id,
          name,
          type,
          host,
          port,
          database,
          username,
          ssl_mode
        )
        VALUES (
          @id,
          @name,
          @type,
          @host,
          @port,
          @database,
          @username,
          @ssl_mode
        )
      `)
            .run({
                id,
                name: dto.name.trim(),
                type: dto.type,
                host: dto.host ?? null,
                port: dto.port ?? null,
                database: dto.database.trim(),
                username: dto.username ?? null,
                ssl_mode: dto.sslMode ?? 'prefer',
            });

        if (result.changes !== 1) {
            throw new InternalServerErrorException('Connection profile could not be created.');
        }

        return this.findOne(id);
    }

    findAll(): ConnectionProfile[] {
        return this.databaseService
            .getDatabase()
            .prepare(`
        SELECT *
        FROM connection_profiles
        ORDER BY name COLLATE NOCASE ASC
      `)
            .all() as ConnectionProfile[];
    }

    findOne(id: string): ConnectionProfile {
        const profile = this.databaseService
            .getDatabase()
            .prepare(`
        SELECT *
        FROM connection_profiles
        WHERE id = ?
      `)
            .get(id) as ConnectionProfile | undefined;

        if (!profile) {
            throw new NotFoundException('Connection profile not found.');
        }

        return profile;
    }


    update(id: string, dto: UpdateConnectionDto): ConnectionProfile {
        const current = this.findOne(id);

        const updated = {
            name: dto.name?.trim() ?? current.name,
            database: dto.database?.trim() ?? current.database,
            host: dto.host ?? current.host,
            port: dto.port ?? current.port,
            username: dto.username ?? current.username,
            ssl_mode: dto.sslMode ?? current.ssl_mode,
        };

        if (current.type !== 'sqlite') {
            if (
                !updated.host ||
                !updated.port ||
                !updated.username
            ) {
                throw new BadRequestException('Invalid connection configuration.');
            }
        }

        this.databaseService
            .getDatabase()
            .prepare(`
      UPDATE connection_profiles
      SET
        name = @name,
        database = @database,
        host = @host,
        port = @port,
        username = @username,
        ssl_mode = @ssl_mode,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `)
            .run({
                id,
                ...updated,
            });

        this.connectionEvents.invalidate(id);

        return this.findOne(id);
    }

    remove(id: string): void {
        this.findOne(id);

        // Önce işletim sistemi güvenli kasasındaki şifreyi sil.
        this.credentialService.deletePassword(id);

        // Ardından bağlantı profilini SQLite'tan sil.
        const result = this.databaseService
            .getDatabase()
            .prepare(`
      DELETE FROM connection_profiles
      WHERE id = ?
    `)
            .run(id);

        if (result.changes !== 1) {
            throw new InternalServerErrorException('Connection profile could not be deleted.');
        }

        this.connectionEvents.invalidate(id);
    }

    /**
     * Başarılı bir bağlantı/sorgu sonrasında son bağlantı zamanını günceller.
     */
    markConnected(id: string): void {
        this.databaseService
            .getDatabase()
            .prepare(`
      UPDATE connection_profiles
      SET last_connected_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
            .run(id);
    }

}
