
import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  ConnectionProfile,
  ConnectionsService,
  parseOptions,
} from '../connections/connections.service';
import { CredentialService } from '../credentials/credential.service';
import { DatabaseDriver } from './database-driver.interface';
import { DriverFactory } from './driver.factory';
import { SshTunnelService } from './ssh-tunnel.service';

export interface ConnectionContext {
  /** SSH tüneli varsa host/port yerel tünel ucunu gösterir. */
  connection: ConnectionProfile;
  password: string | null;
  driver: DatabaseDriver;
}

/** Şifresiz bağlanabilen veritabanları (ör. ClickHouse `default` kullanıcısı). */
const PASSWORD_OPTIONAL: ReadonlyArray<ConnectionProfile['type']> = ['sqlite', 'clickhouse'];

/**
 * Bir bağlantı için profil, şifre, sürücü ve (gerekirse) SSH tünelini tek
 * noktadan çözer.
 */
@Injectable()
export class ConnectionContextService {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly credentialService: CredentialService,
    private readonly driverFactory: DriverFactory,
    private readonly tunnels: SshTunnelService,
  ) {}

  async resolve(connectionId: string): Promise<ConnectionContext> {
    const profile = this.connectionsService.findOne(connectionId);
    const driver = this.driverFactory.getDriver(profile);

    const password =
      profile.type === 'sqlite'
        ? null
        : this.credentialService.getPassword(connectionId);

    if (!PASSWORD_OPTIONAL.includes(profile.type) && !password) {
      throw new ServiceUnavailableException(
        'No saved password found for this connection.',
      );
    }

    const ssh = parseOptions(profile.options_json).ssh;
    let connection = profile;

    if (ssh?.enabled) {
      try {
        connection = await this.tunnels.apply(
          profile,
          ssh,
          this.credentialService.getSshSecret(connectionId),
        );
      } catch (error) {
        throw new BadGatewayException(
          `SSH tunnel failed: ${String((error as { message?: unknown })?.message ?? error)}`,
        );
      }
    }

    return { connection, password, driver };
  }

  markConnected(connectionId: string): void {
    this.connectionsService.markConnected(connectionId);
  }
}
