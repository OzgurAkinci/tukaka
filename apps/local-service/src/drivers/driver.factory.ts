
import { Injectable, BadRequestException } from '@nestjs/common';

import { DatabaseDriver } from './database-driver.interface';
import { PostgreSqlDriver } from './postgresql.driver';
import { MySqlDriver } from './mysql.driver';
import { SqliteDriver } from './sqlite.driver';

import { ConnectionProfile } from '../connections/connections.service';

@Injectable()
export class DriverFactory {
  private readonly drivers: Record<string, DatabaseDriver>;

  constructor() {
    this.drivers = {
      postgresql: new PostgreSqlDriver(),
      mysql: new MySqlDriver(),
      sqlite: new SqliteDriver(),
    };
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
}
