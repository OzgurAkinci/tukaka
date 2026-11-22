
import { Injectable, Logger } from '@nestjs/common';
import { Entry } from '@napi-rs/keyring';

@Injectable()
export class CredentialService {
  private readonly logger = new Logger(CredentialService.name);

  private readonly serviceName = 'tukaka-database-studio';

  private getEntry(connectionId: string): Entry {
    return new Entry(
      this.serviceName,
      `connection-${connectionId}`,
    );
  }

  savePassword(
    connectionId: string,
    password: string,
  ): void {
    if (!password) {
      throw new Error('Password cannot be empty.');
    }

    const entry = this.getEntry(connectionId);

    entry.setPassword(password);

    this.logger.log(
      `Credential saved for connection ${connectionId}.`,
    );
  }

  getPassword(connectionId: string): string | null {
    const entry = this.getEntry(connectionId);

    return entry.getPassword();
  }

  deletePassword(connectionId: string): void {
    const entry = this.getEntry(connectionId);

    try {
      entry.deletePassword();

      this.logger.log(
        `Credential deleted for connection ${connectionId}.`,
      );
    } catch {
      this.logger.debug(
        `No credential found for connection ${connectionId}.`,
      );
    }
  }
}
