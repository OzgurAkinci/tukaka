
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';

import { DatabaseDriver } from './database-driver.interface';
import { PostgreSqlDriver } from './postgresql.driver';
import { MySqlDriver } from './mysql.driver';
import { SqliteDriver } from './sqlite.driver';

import { ConnectionProfile } from '../connections/connections.service';
import { ConnectionEventsService } from '../connections/connection-events.service';

@Injectable()
export class DriverFactory implements OnModuleDestroy {
  private readonly logger = new Logger(DriverFactory.name);

  private readonly drivers: Record<ConnectionProfile['type'], DatabaseDriver> =
    {
      postgresql: new PostgreSqlDriver(),
      mysql: new MySqlDriver(),
      sqlite: new SqliteDriver(),
    };

  private readonly subscription: Subscription;

  constructor(connectionEvents: ConnectionEventsService) {
    this.subscription = connectionEvents.invalidated$.subscribe(
      (connectionId) => {
        void this.release(connectionId);
      },
    );
  }

  getDriver(connection: ConnectionProfile): DatabaseDriver {
    const driver = this.drivers[connection.type];

    if (!driver) {
      throw new BadRequestException(
        `Unsupported database type: ${connection.type}`,
      );
    }

    return driver;
  }

  async release(connectionId: string): Promise<void> {
    await Promise.all(
      Object.values(this.drivers).map((driver) =>
        driver.release(connectionId).catch((error: unknown) => {
          this.logger.warn(
            `Pool release failed for ${connectionId}: ${String(error)}`,
          );
        }),
      ),
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.subscription.unsubscribe();

    await Promise.all(
      Object.values(this.drivers).map((driver) =>
        driver.releaseAll().catch(() => undefined),
      ),
    );
  }
}
