
import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Injectable()
export class AppService {
  constructor(
    private readonly databaseService: DatabaseService,
  ) {}

  getHello(): string {
    return 'TUKAKA Database Studio Local Service';
  }

  getHealth() {
    const result = this.databaseService
      .getDatabase()
      .prepare('SELECT 1 AS result')
      .get() as { result: number };

    return {
      status: 'ok',
      service: 'local-service',
      database: result.result === 1 ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }
}
