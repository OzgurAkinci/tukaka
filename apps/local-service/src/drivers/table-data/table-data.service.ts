
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { TableDataResponse } from '@tukaka/contracts';

import { ConnectionContextService } from '../connection-context.service';
import { DEFAULT_QUERY_OPTIONS } from '../database-driver.interface';
import { TableDataDto } from '../dto/table-data.dto';
import { buildTableDataQuery } from './table-data-query';

const DEFAULT_PAGE_SIZE = 100;

@Injectable()
export class TableDataService {
  private readonly logger = new Logger(TableDataService.name);

  constructor(private readonly contextService: ConnectionContextService) {}

  async getRows(
    connectionId: string,
    schema: string,
    table: string,
    dto: TableDataDto,
  ): Promise<TableDataResponse> {
    const { connection, password, driver } =
      await this.contextService.resolve(connectionId);

    const limit = dto.limit ?? DEFAULT_PAGE_SIZE;
    const offset = dto.offset ?? 0;

    try {
      const tableColumns = await driver.getColumns(
        connection,
        password,
        schema,
        table,
      );

      if (tableColumns.length === 0) {
        throw new NotFoundException(`Table ${schema}.${table} not found.`);
      }

      // Sıralama ve filtre kolonlarının tabloda gerçekten var olduğunu doğrula.
      const known = new Set(tableColumns.map((column) => column.name));
      const requested = [
        ...(dto.sort ? [dto.sort.column] : []),
        ...(dto.filters ?? []).map((filter) => filter.column),
      ];
      const unknown = requested.filter((name) => !known.has(name));

      if (unknown.length > 0) {
        throw new BadRequestException(
          `Unknown column(s): ${[...new Set(unknown)].join(', ')}`,
        );
      }

      const query = buildTableDataQuery(driver.dialect, {
        schema,
        table,
        limit,
        offset,
        sort: dto.sort,
        filters: dto.filters,
      });

      const options = {
        maxRows: limit + 1,
        timeoutMs: DEFAULT_QUERY_OPTIONS.timeoutMs,
      };

      const startedAt = performance.now();

      const data = await driver.executeQuery(
        connection,
        password,
        query.dataSql,
        query.parameters,
        options,
      );

      let totalCount: number | null = null;

      if (dto.includeTotal !== false) {
        const count = await driver.executeQuery(
          connection,
          password,
          query.countSql,
          query.parameters,
          { ...options, maxRows: 1 },
        );

        totalCount = Number(count.rows[0]?.total ?? 0);
      }

      return {
        success: true,
        connectionId,
        schema,
        table,
        columns:
          data.columns.length > 0
            ? data.columns
            : tableColumns.map((column) => column.name),
        rows: data.rows.slice(0, limit),
        limit,
        offset,
        totalCount,
        hasMore: data.rows.length > limit,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Table data retrieval failed. Connection: ${connection.name}, Table: ${schema}.${table}, Error: ${message}`,
      );

      throw new BadGatewayException(message);
    }
  }
}
