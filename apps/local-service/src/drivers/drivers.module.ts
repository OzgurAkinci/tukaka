
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
import { SchemaObjectsService } from './schema-objects.service';
import { SshController } from './ssh.controller';
import { SshTunnelService } from './ssh-tunnel.service';
import { TableDataService } from './table-data/table-data.service';

@Module({
  imports: [ConnectionsModule, CredentialModule, QueriesModule],
  controllers: [ConnectionTestController, QueryCancelController, SshController],
  providers: [
    DriverFactory,
    ConnectionContextService,
    ConnectionTestService,
    ConnectionQueryService,
    DatabaseExplorerService,
    RunningQueriesService,
    SchemaObjectsService,
    SshTunnelService,
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
