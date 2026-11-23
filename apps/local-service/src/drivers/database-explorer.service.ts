
import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';

import type { CompletionMetadata } from '@tukaka/contracts';

import { ConnectionContextService } from './connection-context.service';

/** Otomatik tamamlama için en fazla kolon sayısı. */
const MAX_COMPLETION_COLUMNS = 20_000;

@Injectable()
export class DatabaseExplorerService {
  private readonly logger = new Logger(DatabaseExplorerService.name);

  constructor(private readonly contextService: ConnectionContextService) {}

  async getSchemas(connectionId: string) {
    const { connection, password, driver } =
      await this.contextService.resolve(connectionId);

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
      await this.contextService.resolve(connectionId);

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
      await this.contextService.resolve(connectionId);

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

  async getCompletion(connectionId: string): Promise<CompletionMetadata> {
    const { connection, password, driver } =
      await this.contextService.resolve(connectionId);

    const data = await this.run(
      connection.name,
      'Completion metadata',
      () =>
        driver.getCompletionData(connection, password, MAX_COMPLETION_COLUMNS),
      (result) =>
        Object.values(result.schemas).reduce(
          (total, tables) => total + Object.keys(tables).length,
          0,
        ),
    );

    return {
      success: true,
      connectionId,
      ...data,
    };
  }

  private async run<T>(
    connectionName: string,
    operation: string,
    work: () => Promise<T>,
    count: (result: T) => number = (result) =>
      Array.isArray(result) ? result.length : 0,
  ): Promise<T> {
    try {
      const result = await work();

      this.logger.log(
        `${operation} succeeded. Connection: ${connectionName}, Count: ${count(result)}`,
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
