
import { Module } from '@nestjs/common';

import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { CredentialModule } from '../credentials/credential.module';
import { CredentialController } from './credential.controller';
import { ConnectionEventsService } from './connection-events.service';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';

@Module({
  imports: [CredentialModule],
  controllers: [
    ConnectionsController,
    CredentialController,
    CollectionsController,
  ],
  providers: [ConnectionsService, ConnectionEventsService, CollectionsService],
  exports: [ConnectionsService, ConnectionEventsService],
})
export class ConnectionsModule {}
