
import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ConnectionContextService } from './connection-context.service';

@Injectable()
export class ConnectionTestService {
  private readonly logger = new Logger(ConnectionTestService.name);

  constructor(private readonly contextService: ConnectionContextService) {}

  async testConnection(id: string) {
    try {
      // SSH tüneli ve eksik şifre de test sonucunun parçasıdır.
      const { connection, password, driver } =
        await this.contextService.resolve(id);

      await driver.testConnection(connection, password);

      this.contextService.markConnected(connection.id);
      this.logger.log(`Connection test successful: ${connection.name}`);

      return {
        success: true,
        message: 'Connection established successfully.',
        connectionId: id,
      };
    } catch (error) {
      // Bilinmeyen bağlantı gerçek bir 404'tür.
      if (error instanceof NotFoundException) throw error;

      const message =
        error instanceof HttpException || error instanceof Error
          ? error.message
          : 'Unknown connection error.';

      this.logger.warn(`Connection test failed for ${id}: ${message}`);

      return {
        success: false,
        message,
        connectionId: id,
      };
    }
  }
}
