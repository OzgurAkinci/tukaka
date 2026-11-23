
import { createHash } from 'node:crypto';

import { ConnectionProfile } from '../connections/connections.service';

/**
 * Bağlantı ayarlarından ve şifreden bir parmak izi üretir.
 * Ayarlar ya da şifre değiştiğinde parmak izi değişir ve havuz yeniden kurulur.
 */
export function connectionFingerprint(
  connection: ConnectionProfile,
  password: string | null,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        connection.type,
        connection.host,
        connection.port,
        connection.database,
        connection.username,
        connection.ssl_mode,
        connection.options_json,
        password ?? '',
      ]),
    )
    .digest('hex');
}

interface PoolEntry<TPool> {
  fingerprint: string;
  pool: Promise<TPool>;
}

/**
 * Bağlantı başına tek bir havuz tutar. Havuz oluşturma asenkron olduğundan
 * aynı anda gelen istekler aynı Promise'i paylaşır.
 */
export class PoolRegistry<TPool> {
  private readonly entries = new Map<string, PoolEntry<TPool>>();

  constructor(
    private readonly closePool: (pool: TPool) => Promise<void>,
  ) {}

  async get(
    connection: ConnectionProfile,
    password: string | null,
    create: () => Promise<TPool>,
  ): Promise<TPool> {
    const fingerprint = connectionFingerprint(connection, password);
    const existing = this.entries.get(connection.id);

    if (existing && existing.fingerprint === fingerprint) {
      return existing.pool;
    }

    if (existing) {
      this.entries.delete(connection.id);
      void this.closeEntry(existing);
    }

    const pool = create();
    const entry: PoolEntry<TPool> = { fingerprint, pool };

    this.entries.set(connection.id, entry);

    // Havuz kurulamadıysa kaydı sil ki bir sonraki istek tekrar denesin.
    pool.catch(() => {
      if (this.entries.get(connection.id) === entry) {
        this.entries.delete(connection.id);
      }
    });

    return pool;
  }

  async release(connectionId: string): Promise<void> {
    const entry = this.entries.get(connectionId);

    if (!entry) {
      return;
    }

    this.entries.delete(connectionId);
    await this.closeEntry(entry);
  }

  async releaseAll(): Promise<void> {
    const entries = [...this.entries.values()];

    this.entries.clear();
    await Promise.all(entries.map((entry) => this.closeEntry(entry)));
  }

  private async closeEntry(entry: PoolEntry<TPool>): Promise<void> {
    try {
      await this.closePool(await entry.pool);
    } catch {
      // Kurulamamış ya da zaten kapanmış havuz; yok say.
    }
  }
}
