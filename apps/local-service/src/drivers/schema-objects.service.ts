
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApplyChangesResponse,
  ErDiagramResponse,
  ErTable,
  ExplainResponse,
  RoutineDefinitionResponse,
  RoutinesResponse,
  RowChange,
  TableDetailsResponse,
} from '@tukaka/contracts';

import { QueryHistoryService } from '../queries/query-history.service';
import { ConnectionContextService } from './connection-context.service';
import {
  ApplyChangesDto,
  ExplainDto,
  RoutineDefinitionDto,
} from './dto/schema-objects.dto';
import { renderStatement } from './sql-dialects';
import {
  buildRowChangeStatements,
  RowChangeError,
} from './table-data/row-changes';

/** ER diyagramında gösterilecek en fazla tablo. */
const MAX_ER_TABLES = 150;

const isScalar = (value: unknown) =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

@Injectable()
export class SchemaObjectsService {
  private readonly logger = new Logger(SchemaObjectsService.name);

  constructor(
    private readonly contextService: ConnectionContextService,
    private readonly history: QueryHistoryService,
  ) {}

  async getTableDetails(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<TableDetailsResponse> {
    const { connection, password, driver } =
      await this.contextService.resolve(connectionId);

    return this.upstream('Table details', async () => {
      const [indexes, foreignKeys, ddl] = await Promise.all([
        driver.getIndexes(connection, password, schema, table),
        driver.getForeignKeys(connection, password, schema, table),
        driver.getTableDdl(connection, password, schema, table),
      ]);

      return {
        success: true,
        connectionId,
        schema,
        table,
        indexes,
        foreignKeys,
        ddl,
      };
    });
  }

  async getRoutines(
    connectionId: string,
    schema: string,
  ): Promise<RoutinesResponse> {
    const { connection, password, driver } =
      await this.contextService.resolve(connectionId);

    return this.upstream('Routines', async () => ({
      success: true,
      connectionId,
      schema,
      routines: await driver.getRoutines(connection, password, schema),
    }));
  }

  async getRoutineDefinition(
    connectionId: string,
    schema: string,
    routineId: string,
    dto: RoutineDefinitionDto,
  ): Promise<RoutineDefinitionResponse> {
    const { connection, password, driver } =
      await this.contextService.resolve(connectionId);

    return this.upstream('Routine definition', async () => ({
      success: true,
      connectionId,
      definition: await driver.getRoutineDefinition(connection, password, schema, {
        id: routineId,
        name: dto.name,
        type: dto.type,
      }),
    }));
  }

  async explain(connectionId: string, dto: ExplainDto): Promise<ExplainResponse> {
    const { connection, password, driver } =
      await this.contextService.resolve(connectionId);

    try {
      const plan = await driver.explain(connection, password, dto.sql);

      return { success: true, connectionId, ...plan };
    } catch (error) {
      // Plan alınamaması genellikle sorgunun kendisindeki hatadır.
      throw new BadRequestException(errorText(error));
    }
  }

  async getErDiagram(
    connectionId: string,
    schema: string,
  ): Promise<ErDiagramResponse> {
    const { connection, password, driver } =
      await this.contextService.resolve(connectionId);

    return this.upstream('ER diagram', async () => {
      const [tables, columns, foreignKeys] = await Promise.all([
        driver.getTables(connection, password, schema),
        driver.getSchemaColumns(connection, password, schema),
        driver.getForeignKeys(connection, password, schema),
      ]);

      // İlişkisi olan tablolar önce gelsin; sınır aşılırsa onlar kalsın.
      const related = new Set(
        foreignKeys.flatMap((key) => [key.table, key.referencedTable]),
      );
      const selected = [...tables]
        .sort((a, b) => Number(related.has(b.name)) - Number(related.has(a.name)))
        .slice(0, MAX_ER_TABLES);
      const selectedNames = new Set(selected.map((table) => table.name));

      const fkColumns = new Set(
        foreignKeys.flatMap((key) => key.columns.map((column) => `${key.table}.${column}`)),
      );

      const columnsByTable = new Map<string, ErTable['columns']>();

      for (const column of columns) {
        if (!selectedNames.has(column.table)) continue;

        const list = columnsByTable.get(column.table) ?? [];
        list.push({
          name: column.name,
          dataType: column.dataType,
          nullable: column.nullable,
          isPrimaryKey: column.isPrimaryKey,
          isForeignKey: fkColumns.has(`${column.table}.${column.name}`),
        });
        columnsByTable.set(column.table, list);
      }

      return {
        success: true,
        connectionId,
        schema,
        tables: selected
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((table) => ({
            name: table.name,
            type: table.type,
            columns: columnsByTable.get(table.name) ?? [],
          })),
        relationships: foreignKeys.filter(
          (key) =>
            selectedNames.has(key.table) &&
            key.referencedSchema === schema &&
            selectedNames.has(key.referencedTable),
        ),
        truncated: tables.length > selected.length,
      };
    });
  }

  async applyChanges(
    connectionId: string,
    schema: string,
    table: string,
    dto: ApplyChangesDto,
  ): Promise<ApplyChangesResponse> {
    const { connection, password, driver } =
      await this.contextService.resolve(connectionId);

    const changes = dto.changes.map((change): RowChange => {
      const values = change.values ?? {};
      const key = change.key ?? {};

      if (![...Object.values(values), ...Object.values(key)].every(isScalar)) {
        throw new BadRequestException(
          'Cell values must be text, numbers, booleans or NULL.',
        );
      }

      return change.type === 'insert'
        ? { type: 'insert', values }
        : change.type === 'update'
          ? { type: 'update', key, values }
          : { type: 'delete', key };
    });

    const columns = await this.upstream('Table columns', () =>
      driver.getColumns(connection, password, schema, table),
    );

    if (columns.length === 0) {
      throw new NotFoundException(`Table ${schema}.${table} not found.`);
    }

    let statements;

    try {
      statements = buildRowChangeStatements(
        driver.dialect,
        schema,
        table,
        columns,
        changes,
      );
    } catch (error) {
      if (error instanceof RowChangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const previews = statements.map((statement) =>
      renderStatement(driver.dialect, statement.sql, statement.parameters),
    );

    if (dto.dryRun) {
      return { success: true, statements: previews, affectedRows: null };
    }

    const startedAt = performance.now();

    try {
      const affectedRows = await driver.executeInTransaction(
        connection,
        password,
        statements,
      );

      this.recordHistory(connectionId, connection.name, previews, 'success', null, startedAt);

      return { success: true, statements: previews, affectedRows };
    } catch (error) {
      const message = errorText(error);

      this.recordHistory(connectionId, connection.name, previews, 'error', message, startedAt);
      this.logger.warn(`Row changes failed on ${schema}.${table}: ${message}`);

      throw new BadRequestException(message);
    }
  }

  private recordHistory(
    connectionId: string,
    connectionName: string,
    statements: string[],
    status: 'success' | 'error',
    errorMessage: string | null,
    startedAt: number,
  ) {
    try {
      this.history.record({
        connectionId,
        connectionName,
        sql: statements.map((statement) => `${statement};`).join('\n'),
        status,
        errorMessage,
        rowCount: status === 'success' ? statements.length : null,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      this.logger.warn(`Query history could not be recorded: ${errorText(error)}`);
    }
  }

  /** Hedef veritabanı hatalarını 502 olarak bildirir. */
  private async upstream<T>(operation: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const message = errorText(error);
      this.logger.warn(`${operation} failed: ${message}`);
      throw new BadGatewayException(message);
    }
  }
}

function errorText(error: unknown): string {
  return String((error as { message?: unknown })?.message ?? error);
}
