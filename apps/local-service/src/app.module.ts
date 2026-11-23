
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { ConnectionsModule } from './connections/connections.module';
import { CredentialModule } from './credentials/credential.module';
import { DriversModule } from './drivers/drivers.module';
import { SessionTokenGuard } from './auth/session-token.guard';

@Module({
  imports: [
    DatabaseModule,
    ConnectionsModule,
    CredentialModule,
    DriversModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: SessionTokenGuard,
    },
  ],
})
export class AppModule {}
