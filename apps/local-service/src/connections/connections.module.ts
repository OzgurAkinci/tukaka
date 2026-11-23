
import { Module } from '@nestjs/common';

import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { CredentialModule } from '../credentials/credential.module';
import { CredentialController } from './credential.controller';
import { ConnectionEventsService } from './connection-events.service';

@Module({
  imports: [CredentialModule],
  controllers: [
    ConnectionsController,
    CredentialController,
  ],
  providers: [ConnectionsService, ConnectionEventsService],
  exports: [ConnectionsService, ConnectionEventsService],
})
export class ConnectionsModule {}
