
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConnectionsService } from '../connections/connections.service';
import { CredentialService } from '../credentials/credential.service';
import { DriverFactory } from './driver.factory';

@Injectable()
export class ConnectionTestService {
  private readonly logger = new Logger(ConnectionTestService.name);

  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly credentialService: CredentialService,
    private readonly driverFactory: DriverFactory,
  ) {}

  async testConnection(id: string) {
    const connection = this.connectionsService.findOne(id);

    const password =
      connection.type === 'sqlite'
        ? null
        : this.credentialService.getPassword(id);

    if (connection.type !== 'sqlite' && !password) {
      throw new ServiceUnavailableException(
        'No saved password found for this connection.',
      );
    }

    const driver = this.driverFactory.getDriver(connection);

    try {
      await driver.testConnection(connection, password);

      this.logger.log(
        `Connection test successful: ${connection.name}`,
      );

      return {
        success: true,
        message: 'Connection established successfully.',
        connectionId: connection.id,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown connection error.';

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
