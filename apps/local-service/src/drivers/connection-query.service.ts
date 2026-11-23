
import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { ConnectionContextService } from './connection-context.service';
import { DEFAULT_QUERY_OPTIONS } from './database-driver.interface';
import { ExecuteQueryDto } from './dto/execute-query.dto';

@Injectable()
export class ConnectionQueryService {
  private readonly logger = new Logger(ConnectionQueryService.name);

  constructor(private readonly contextService: ConnectionContextService) {}

  async executeQuery(connectionId: string, dto: ExecuteQueryDto) {
    const { connection, password, driver } =
      this.contextService.resolve(connectionId);

    const options = {
      maxRows: dto.maxRows ?? DEFAULT_QUERY_OPTIONS.maxRows,
      timeoutMs: dto.timeoutMs ?? DEFAULT_QUERY_OPTIONS.timeoutMs,
    };

    try {
      const result = await driver.executeQuery(
        connection,
        password,
        dto.sql,
        dto.parameters ?? [],
        options,
      );

      this.contextService.markConnected(connectionId);

      this.logger.log(
        `Query executed successfully. Connection: ${connection.name}, Duration: ${result.durationMs}ms, Rows: ${result.rowCount}${result.truncated ? ' (truncated)' : ''}`,
      );

      return {
        success: true,
        connectionId,
        ...result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Query execution failed.';

      this.logger.warn(
        `Query execution failed. Connection: ${connection.name}, Error: ${message}`,
      );

      // Veritabanından gelen SQL hataları kullanıcı hatasıdır; 500 değil 400 dön.
      throw new BadRequestException(message);
    }
  }
}
