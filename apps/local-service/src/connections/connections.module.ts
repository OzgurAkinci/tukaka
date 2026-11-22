
import { Module } from '@nestjs/common';

import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { CredentialModule } from '../credentials/credential.module';
import { CredentialController } from './credential.controller';

@Module({
  imports: [CredentialModule],
  controllers: [
    ConnectionsController,
    CredentialController,
  ],
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
