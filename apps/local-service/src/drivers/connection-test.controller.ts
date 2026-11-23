
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import { ConnectionTestService } from './connection-test.service';
import { ExecuteQueryDto } from './dto/execute-query.dto';
import { ConnectionQueryService } from './connection-query.service';
import { DatabaseExplorerService } from './database-explorer.service';
import { TableDataDto } from './dto/table-data.dto';
import { TableDataService } from './table-data/table-data.service';
import {
  ApplyChangesDto,
  ExplainDto,
  RoutineDefinitionDto,
} from './dto/schema-objects.dto';
import { SchemaObjectsService } from './schema-objects.service';

@Controller('connections')
export class ConnectionTestController {
  constructor(
    private readonly connectionTestService: ConnectionTestService,
    private readonly connectionQueryService: ConnectionQueryService,
    private readonly databaseExplorerService: DatabaseExplorerService,
    private readonly tableDataService: TableDataService,
    private readonly schemaObjects: SchemaObjectsService,
  ) {}

  @Post(':id/test')
  testConnection(@Param('id', ParseUUIDPipe) id: string) {
    return this.connectionTestService.testConnection(id);
  }

  @Post(':id/query')
  executeQuery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExecuteQueryDto,
  ) {
    return this.connectionQueryService.executeQuery(id, dto);
  }

  @Get(':id/schemas')
  getSchemas(@Param('id', ParseUUIDPipe) id: string) {
    return this.databaseExplorerService.getSchemas(id);
  }

  @Get(':id/schemas/:schema/tables')
  getTables(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schema') schema: string,
  ) {
    return this.databaseExplorerService.getTables(id, schema);
  }


  @Get(':id/schemas/:schema/tables/:table/columns')
  getColumns(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
  ) {
    return this.databaseExplorerService.getColumns(
      id,
      schema,
      table,
    );
  }

  @Post(':id/schemas/:schema/tables/:table/data')
  getTableData(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Body() dto: TableDataDto,
  ) {
    return this.tableDataService.getRows(id, schema, table, dto);
  }

  @Get(':id/completion')
  getCompletion(@Param('id', ParseUUIDPipe) id: string) {
    return this.databaseExplorerService.getCompletion(id);
  }

  @Get(':id/schemas/:schema/tables/:table/details')
  getTableDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
  ) {
    return this.schemaObjects.getTableDetails(id, schema, table);
  }

  @Post(':id/schemas/:schema/tables/:table/changes')
  applyChanges(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Body() dto: ApplyChangesDto,
  ) {
    return this.schemaObjects.applyChanges(id, schema, table, dto);
  }

  @Get(':id/schemas/:schema/routines')
  getRoutines(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schema') schema: string,
  ) {
    return this.schemaObjects.getRoutines(id, schema);
  }

  @Get(':id/schemas/:schema/routines/:routineId/definition')
  getRoutineDefinition(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schema') schema: string,
    @Param('routineId') routineId: string,
    @Query() query: RoutineDefinitionDto,
  ) {
    return this.schemaObjects.getRoutineDefinition(id, schema, routineId, query);
  }

  @Get(':id/schemas/:schema/er')
  getErDiagram(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schema') schema: string,
  ) {
    return this.schemaObjects.getErDiagram(id, schema);
  }

  @Post(':id/explain')
  explain(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExplainDto) {
    return this.schemaObjects.explain(id, dto);
  }
}
