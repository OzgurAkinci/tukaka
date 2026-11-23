
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
import { MssqlDriver } from './mssql.driver';
import { ClickHouseDriver } from './clickhouse.driver';
import { OracleDriver } from './oracle.driver';

import { ConnectionProfile } from '../connections/connections.service';
import { ConnectionEventsService } from '../connections/connection-events.service';

@Injectable()
export class DriverFactory implements OnModuleDestroy {
  private readonly logger = new Logger(DriverFactory.name);

  private readonly drivers: Record<ConnectionProfile['type'], DatabaseDriver> =
    (() => {
    const mysql = new MySqlDriver();

    return {
      postgresql: new PostgreSqlDriver(),
      mysql,
      // MariaDB, MySQL protokolüyle uyumludur.
      mariadb: mysql,
      sqlite: new SqliteDriver(),
      mssql: new MssqlDriver(),
      clickhouse: new ClickHouseDriver(),
      oracle: new OracleDriver(),
    };
  })();

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
      this.uniqueDrivers().map((driver) =>
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
      this.uniqueDrivers().map((driver) =>
        driver.releaseAll().catch(() => undefined),
      ),
    );
  }

  private uniqueDrivers(): DatabaseDriver[] {
    return [...new Set(Object.values(this.drivers))];
  }
}
