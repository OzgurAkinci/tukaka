
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ExecuteQueryResponse } from '@tukaka/contracts';

import { QueryHistoryService } from '../queries/query-history.service';
import { ConnectionContextService } from './connection-context.service';
import { DEFAULT_QUERY_OPTIONS, QueryOptions } from './database-driver.interface';
import { ExecuteQueryDto } from './dto/execute-query.dto';
import { RunningQueriesService } from './running-queries.service';

@Injectable()
export class ConnectionQueryService {
  private readonly logger = new Logger(ConnectionQueryService.name);

  constructor(
    private readonly contextService: ConnectionContextService,
    private readonly runningQueries: RunningQueriesService,
    private readonly history: QueryHistoryService,
  ) {}

  async executeQuery(
    connectionId: string,
    dto: ExecuteQueryDto,
  ): Promise<ExecuteQueryResponse> {
    const { connection, password, driver } =
      this.contextService.resolve(connectionId);

    const handle = dto.queryId
      ? this.runningQueries.start(
          dto.queryId,
          connectionId,
          driver.supportsCancel,
        )
      : null;

    const options: QueryOptions = {
      maxRows: dto.maxRows ?? DEFAULT_QUERY_OPTIONS.maxRows,
      timeoutMs: dto.timeoutMs ?? DEFAULT_QUERY_OPTIONS.timeoutMs,
      onCancelAvailable: handle
        ? (cancel) => handle.setCancel(cancel)
        : undefined,
    };

    const startedAt = performance.now();

    try {
      const result = await driver.executeQuery(
        connection,
        password,
        dto.sql,
        dto.parameters ?? [],
        options,
      );

      this.contextService.markConnected(connectionId);

      this.recordHistory({
        connectionId,
        connectionName: connection.name,
        sql: dto.sql,
        status: 'success',
        rowCount: result.rowCount,
        durationMs: result.durationMs,
      });

      this.logger.log(
        `Query executed successfully. Connection: ${connection.name}, Duration: ${result.durationMs}ms, Rows: ${result.rowCount}${result.truncated ? ' (truncated)' : ''}`,
      );

      return {
        success: true,
        connectionId,
        ...result,
      };
    } catch (error) {
      const message = handle?.cancelRequested
        ? 'Query was cancelled.'
        : error instanceof Error
          ? error.message
          : 'Query execution failed.';

      this.recordHistory({
        connectionId,
        connectionName: connection.name,
        sql: dto.sql,
        status: 'error',
        errorMessage: message,
        durationMs: Math.round(performance.now() - startedAt),
      });

      this.logger.warn(
        `Query execution failed. Connection: ${connection.name}, Error: ${message}`,
      );

      // Veritabanından gelen SQL hataları kullanıcı hatasıdır; 500 değil 400 dön.
      throw new BadRequestException(message);
    } finally {
      handle?.finish();
    }
  }

  /** Geçmiş kaydı başarısız olursa sorgu sonucu etkilenmemeli. */
  private recordHistory(
    input: Parameters<QueryHistoryService['record']>[0],
  ): void {
    try {
      this.history.record(input);
    } catch (error) {
      this.logger.warn(`Query history could not be recorded: ${String(error)}`);
    }
  }
}
