
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Entry } from '@napi-rs/keyring';

type SecretKind = 'password' | 'ssh';

/**
 * Bağlantı şifrelerini ve SSH sırlarını işletim sisteminin güvenli kasasında
 * (macOS Keychain, Windows Credential Manager, Secret Service) saklar.
 */
@Injectable()
export class CredentialService {
  private readonly logger = new Logger(CredentialService.name);

  private readonly serviceName = 'tukaka-database-studio';

  private getEntry(connectionId: string, kind: SecretKind): Entry {
    // Veritabanı şifresinin hesap adı geriye dönük uyumluluk için aynı kalır.
    const account =
      kind === 'password' ? `connection-${connectionId}` : `connection-${connectionId}-ssh`;

    return new Entry(this.serviceName, account);
  }

  private save(connectionId: string, kind: SecretKind, secret: string): void {
    if (!secret) {
      throw new BadRequestException('Secret cannot be empty.');
    }

    this.getEntry(connectionId, kind).setPassword(secret);
    this.logger.log(`Credential (${kind}) saved for connection ${connectionId}.`);
  }

  private get(connectionId: string, kind: SecretKind): string | null {
    return this.getEntry(connectionId, kind).getPassword();
  }

  private delete(connectionId: string, kind: SecretKind): void {
    try {
      this.getEntry(connectionId, kind).deletePassword();
      this.logger.log(`Credential (${kind}) deleted for connection ${connectionId}.`);
    } catch {
      this.logger.debug(`No ${kind} credential found for connection ${connectionId}.`);
    }
  }

  savePassword(connectionId: string, password: string): void {
    this.save(connectionId, 'password', password);
  }

  getPassword(connectionId: string): string | null {
    return this.get(connectionId, 'password');
  }

  deletePassword(connectionId: string): void {
    this.delete(connectionId, 'password');
  }

  saveSshSecret(connectionId: string, secret: string): void {
    this.save(connectionId, 'ssh', secret);
  }

  getSshSecret(connectionId: string): string | null {
    return this.get(connectionId, 'ssh');
  }

  deleteSshSecret(connectionId: string): void {
    this.delete(connectionId, 'ssh');
  }
}
