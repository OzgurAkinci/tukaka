
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConnectionsService } from '../connections/connections.service';
import { CredentialService } from '../credentials/credential.service';
import { DriverFactory } from './driver.factory';

@Injectable()
export class DatabaseExplorerService {
  private readonly logger = new Logger(DatabaseExplorerService.name);

  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly credentialService: CredentialService,
    private readonly driverFactory: DriverFactory,
  ) {}

  private getConnectionContext(connectionId: string) {
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

    return {
      connection,
      password,
      driver,
    };
  }

  async getSchemas(connectionId: string) {
    const {
      connection,
      password,
      driver,
    } = this.getConnectionContext(connectionId);

    try {
      const schemas = await driver.getSchemas(
        connection,
        password,
      );

      this.logger.log(
        `Schemas retrieved. Connection: ${connection.name}, Count: ${schemas.length}`,
      );

      return {
        success: true,
        connectionId,
        schemas,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Schema retrieval failed.';

      this.logger.warn(
        `Schema retrieval failed. Connection: ${connection.name}, Error: ${message}`,
      );

      throw error;
    }
  }

  async getTables(
    connectionId: string,
    schema: string,
  ) {
    const {
      connection,
      password,
      driver,
    } = this.getConnectionContext(connectionId);

    try {
      const tables = await driver.getTables(
        connection,
        password,
        schema,
      );

      this.logger.log(
        `Tables retrieved. Connection: ${connection.name}, Schema: ${schema}, Count: ${tables.length}`,
      );

      return {
        success: true,
        connectionId,
        schema,
        tables,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Table retrieval failed.';

      this.logger.warn(
        `Table retrieval failed. Connection: ${connection.name}, Schema: ${schema}, Error: ${message}`,
      );

      throw error;
    }
  }
}
