
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConnectionsService } from '../connections/connections.service';
import { CredentialService } from '../credentials/credential.service';
import { DriverFactory } from './driver.factory';
import { ExecuteQueryDto } from './dto/execute-query.dto';

@Injectable()
export class ConnectionQueryService {
  private readonly logger = new Logger(ConnectionQueryService.name);

  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly credentialService: CredentialService,
    private readonly driverFactory: DriverFactory,
  ) {}

  async executeQuery(
    connectionId: string,
    dto: ExecuteQueryDto,
  ) {
    const connection = this.connectionsService.findOne(connectionId);

    const password =
      connection.type === 'sqlite'
        ? null
        : this.credentialService.getPassword(connectionId);

    if (connection.type !== 'sqlite' && !password) {
      throw new ServiceUnavailableException(
        'No saved password found for this connection.',
      );
    }

    const driver = this.driverFactory.getDriver(connection);

    const startedAt = Date.now();

    try {
      const result = await driver.executeQuery(
        connection,
        password,
        dto.sql,
        dto.parameters ?? [],
      );

      this.logger.log(
        `Query executed successfully. Connection: ${connection.name}, Duration: ${Date.now() - startedAt}ms`,
      );

      return {
        success: true,
        connectionId,
        ...result,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Query execution failed.';

      this.logger.warn(
        `Query execution failed. Connection: ${connection.name}, Error: ${message}`,
      );

      throw error;
    }
  }
}
