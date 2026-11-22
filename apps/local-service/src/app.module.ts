
import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { ConnectionsModule } from './connections/connections.module';
import { CredentialModule } from './credentials/credential.module';
import { DriversModule } from './drivers/drivers.module';

@Module({
  imports: [
    DatabaseModule,
    ConnectionsModule,
    CredentialModule,
    DriversModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
