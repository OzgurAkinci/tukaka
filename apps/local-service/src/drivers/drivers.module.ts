
import { Module } from '@nestjs/common';

import { ConnectionsModule } from '../connections/connections.module';
import { CredentialModule } from '../credentials/credential.module';
import { QueriesModule } from '../queries/queries.module';

import { ConnectionContextService } from './connection-context.service';
import { ConnectionQueryService } from './connection-query.service';
import { ConnectionTestController } from './connection-test.controller';
import { ConnectionTestService } from './connection-test.service';
import { DatabaseExplorerService } from './database-explorer.service';
import { DriverFactory } from './driver.factory';
import { QueryCancelController } from './query-cancel.controller';
import { RunningQueriesService } from './running-queries.service';
import { TableDataService } from './table-data/table-data.service';

@Module({
  imports: [ConnectionsModule, CredentialModule, QueriesModule],
  controllers: [ConnectionTestController, QueryCancelController],
  providers: [
    DriverFactory,
    ConnectionContextService,
    ConnectionTestService,
    ConnectionQueryService,
    DatabaseExplorerService,
    RunningQueriesService,
    TableDataService,
  ],
  exports: [
    DriverFactory,
    ConnectionTestService,
    ConnectionQueryService,
    DatabaseExplorerService,
  ],
})
export class DriversModule {}
