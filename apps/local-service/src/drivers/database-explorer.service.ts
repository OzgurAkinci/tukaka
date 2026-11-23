
import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { ConnectionContextService } from './connection-context.service';

@Injectable()
export class DatabaseExplorerService {
  private readonly logger = new Logger(DatabaseExplorerService.name);

  constructor(private readonly contextService: ConnectionContextService) {}

  async getSchemas(connectionId: string) {
    const { connection, password, driver } =
      this.contextService.resolve(connectionId);

    const schemas = await this.run(connection.name, 'Schema retrieval', () =>
      driver.getSchemas(connection, password),
    );

    return {
      success: true,
      connectionId,
      schemas,
    };
  }

  async getTables(connectionId: string, schema: string) {
    const { connection, password, driver } =
      this.contextService.resolve(connectionId);

    const tables = await this.run(
      connection.name,
      `Table retrieval (schema: ${schema})`,
      () => driver.getTables(connection, password, schema),
    );

    return {
      success: true,
      connectionId,
      schema,
      tables,
    };
  }

  async getColumns(connectionId: string, schema: string, table: string) {
    const { connection, password, driver } =
      this.contextService.resolve(connectionId);

    const columns = await this.run(
      connection.name,
      `Column retrieval (${schema}.${table})`,
      () => driver.getColumns(connection, password, schema, table),
    );

    return {
      success: true,
      connectionId,
      schema,
      table,
      columns,
    };
  }

  private async run<T extends unknown[]>(
    connectionName: string,
    operation: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await work();

      this.logger.log(
        `${operation} succeeded. Connection: ${connectionName}, Count: ${result.length}`,
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `${operation} failed. Connection: ${connectionName}, Error: ${message}`,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      // Hedef veritabanından gelen hata: upstream hatası olarak bildir.
      throw new BadGatewayException(message);
    }
  }
}
