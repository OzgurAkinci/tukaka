
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import {
  ConnectionProfile,
  ConnectionsService,
} from '../connections/connections.service';
import { CredentialService } from '../credentials/credential.service';
import { DatabaseDriver } from './database-driver.interface';
import { DriverFactory } from './driver.factory';

export interface ConnectionContext {
  connection: ConnectionProfile;
  password: string | null;
  driver: DatabaseDriver;
}

/**
 * Bir bağlantı için profil, şifre ve sürücüyü tek noktadan çözer.
 */
@Injectable()
export class ConnectionContextService {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly credentialService: CredentialService,
    private readonly driverFactory: DriverFactory,
  ) {}

  resolve(connectionId: string): ConnectionContext {
    const connection = this.connectionsService.findOne(connectionId);

    const password =
      connection.type === 'sqlite'
        ? null
        : this.credentialService.getPassword(connectionId);

    if (connection.type !== 'sqlite' && !password) {
      throw new ServiceUnavailableException(
        'No saved password found for this connection.',
      );
    }

    return {
      connection,
      password,
      driver: this.driverFactory.getDriver(connection),
    };
  }

  markConnected(connectionId: string): void {
    this.connectionsService.markConnected(connectionId);
  }
}
