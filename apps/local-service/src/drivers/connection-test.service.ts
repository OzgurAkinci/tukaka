
import { Injectable, Logger } from '@nestjs/common';

import { ConnectionContextService } from './connection-context.service';

@Injectable()
export class ConnectionTestService {
  private readonly logger = new Logger(ConnectionTestService.name);

  constructor(private readonly contextService: ConnectionContextService) {}

  async testConnection(id: string) {
    const { connection, password, driver } = this.contextService.resolve(id);

    try {
      await driver.testConnection(connection, password);

      this.contextService.markConnected(connection.id);

      this.logger.log(`Connection test successful: ${connection.name}`);

      return {
        success: true,
        message: 'Connection established successfully.',
        connectionId: connection.id,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown connection error.';

      this.logger.warn(
        `Connection test failed for ${connection.name}: ${message}`,
      );

      return {
        success: false,
        message,
        connectionId: connection.id,
      };
    }
  }
}
