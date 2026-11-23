
import { Module } from '@nestjs/common';

import { ConnectionsModule } from '../connections/connections.module';
import { CredentialModule } from '../credentials/credential.module';

import { DriverFactory } from './driver.factory';
import { ConnectionTestService } from './connection-test.service';
import { ConnectionTestController } from './connection-test.controller';
import { ConnectionQueryService } from './connection-query.service';
import { DatabaseExplorerService } from './database-explorer.service';
import { ConnectionContextService } from './connection-context.service';

@Module({
  imports: [
    ConnectionsModule,
    CredentialModule,
  ],
  controllers: [
    ConnectionTestController,
  ],
  providers: [
    DriverFactory,
    ConnectionContextService,
    ConnectionTestService,
    ConnectionQueryService,
    DatabaseExplorerService,
  ],
  exports: [
    DriverFactory,
    ConnectionTestService,
    ConnectionQueryService,
    DatabaseExplorerService,
  ],
})
export class DriversModule {}
