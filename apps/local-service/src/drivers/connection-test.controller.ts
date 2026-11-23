
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { ConnectionTestService } from './connection-test.service';
import { ExecuteQueryDto } from './dto/execute-query.dto';
import { ConnectionQueryService } from './connection-query.service';
import { DatabaseExplorerService } from './database-explorer.service';

@Controller('connections')
export class ConnectionTestController {
  constructor(
    private readonly connectionTestService: ConnectionTestService,
    private readonly connectionQueryService: ConnectionQueryService,
    private readonly databaseExplorerService: DatabaseExplorerService,
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

}
