
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ConnectionProfile, SshTunnelConfig } from '@tukaka/contracts';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Subscription } from 'rxjs';
import { Client, utils, type ConnectConfig } from 'ssh2';

import { ConnectionEventsService } from '../connections/connection-events.service';
import { DatabaseService } from '../database/database.service';

interface Tunnel {
  client: Client;
  server: net.Server;
  port: number;
}

interface TunnelEntry {
  fingerprint: string;
  tunnel: Promise<Tunnel>;
}

export class SshHostKeyMismatchError extends Error {}

/** `~/.ssh/id_ed25519` gibi yolları genişletir. */
function expandHome(file: string): string {
  return file.startsWith('~') ? path.join(os.homedir(), file.slice(1)) : file;
}

/**
 * Veritabanı bağlantılarını SSH sunucusu üzerinden yönlendirir.
 *
 * Her bağlantı için 127.0.0.1 üzerinde boş bir porta yerel bir dinleyici açılır;
 * gelen her TCP bağlantısı SSH `direct-tcpip` kanalıyla hedef host:port'a
 * aktarılır. Sürücüler yalnızca host/port'u yerel adresle değiştirilmiş profili
 * görür.
 *
 * Sunucu anahtarı ilk bağlantıda kaydedilir (TOFU); sonradan değişirse
 * bağlantı reddedilir.
 */
@Injectable()
export class SshTunnelService implements OnModuleDestroy {
  private readonly logger = new Logger(SshTunnelService.name);

  private readonly tunnels = new Map<string, TunnelEntry>();

  private readonly subscription: Subscription;

  constructor(
    private readonly databaseService: DatabaseService,
    connectionEvents: ConnectionEventsService,
  ) {
    this.subscription = connectionEvents.invalidated$.subscribe((connectionId) => {
      void this.close(connectionId);
    });
  }

  /**
   * SSH tüneli etkinse host/port'u yerel tünel ucuna çevrilmiş profili döndürür;
   * değilse profili olduğu gibi döndürür.
   */
  async apply(
    connection: ConnectionProfile,
    ssh: SshTunnelConfig | undefined,
    secret: string | null,
  ): Promise<ConnectionProfile> {
    if (!ssh?.enabled) {
      return connection;
    }

    if (!connection.host || !connection.port) {
      throw new Error('SSH tunnel requires a database host and port.');
    }

    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([ssh, secret ?? '', connection.host, connection.port]),
      )
      .digest('hex');

    const existing = this.tunnels.get(connection.id);

    if (existing && existing.fingerprint !== fingerprint) {
      await this.close(connection.id);
    }

    let entry = this.tunnels.get(connection.id);

    if (!entry) {
      const tunnel = this.open(connection, ssh, secret);
      entry = { fingerprint, tunnel };
      this.tunnels.set(connection.id, entry);

      const current = entry;
      tunnel.catch(() => {
        if (this.tunnels.get(connection.id) === current) {
          this.tunnels.delete(connection.id);
        }
      });
    }

    const { port } = await entry.tunnel;

    return { ...connection, host: '127.0.0.1', port };
  }

  private async open(
    connection: ConnectionProfile,
    ssh: SshTunnelConfig,
    secret: string | null,
  ): Promise<Tunnel> {
    const config: ConnectConfig = {
      host: ssh.host,
      port: ssh.port || 22,
      username: ssh.username,
      readyTimeout: 15_000,
      keepaliveInterval: 15_000,
    };

    if (ssh.authMethod === 'privateKey') {
      if (!ssh.privateKeyPath) {
        throw new Error('SSH private key file is not set.');
      }

      config.privateKey = fs.readFileSync(expandHome(ssh.privateKeyPath));

      if (secret) config.passphrase = secret;
    } else {
      if (!secret) {
        throw new Error('No saved SSH password found for this connection.');
      }

      config.password = secret;
    }

    const client = new Client();

    await new Promise<void>((resolve, reject) => {
      let hostKeyError: Error | null = null;

      client.once('ready', () => resolve());
      client.once('error', (error) => reject(hostKeyError ?? error));
      client.connect({
        ...config,
        hostVerifier: (key: Buffer) => {
          try {
            return this.verifyHostKey(ssh.host, ssh.port || 22, key);
          } catch (error) {
            hostKeyError = error as Error;
            return false;
          }
        },
      });
    });

    const targetHost = connection.host!;
    const targetPort = connection.port!;

    const server = net.createServer((socket) => {
      client.forwardOut(
        '127.0.0.1',
        socket.remotePort ?? 0,
        targetHost,
        targetPort,
        (error, stream) => {
          if (error) {
            this.logger.warn(`SSH forward failed (${connection.name}): ${error.message}`);
            socket.destroy();
            return;
          }

          socket.pipe(stream).pipe(socket);
          socket.on('error', () => stream.destroy());
          stream.on('error', () => socket.destroy());
        },
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const { port } = server.address() as net.AddressInfo;

    // SSH bağlantısı koparsa tüneli kapat; bir sonraki istek yeniden kurar.
    client.on('close', () => {
      server.close();
      const entry = this.tunnels.get(connection.id);
      void entry?.tunnel.then((tunnel) => {
        if (tunnel.client === client) this.tunnels.delete(connection.id);
      });
    });
    client.on('error', (error) => {
      this.logger.warn(`SSH connection error (${connection.name}): ${error.message}`);
    });

    this.logger.log(
      `SSH tunnel ready for ${connection.name}: 127.0.0.1:${port} → ${ssh.host} → ${targetHost}:${targetPort}`,
    );

    return { client, server, port };
  }

  /**
   * İlk bağlantıda anahtarı kaydeder; sonraki bağlantılarda karşılaştırır.
   */
  verifyHostKey(host: string, port: number, key: Buffer): boolean {
    const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
    const parsed = utils.parseKey(key);
    const keyType = parsed instanceof Error ? 'unknown' : (Array.isArray(parsed) ? parsed[0] : parsed).type;

    const database = this.databaseService.getDatabase();
    const known = database
      .prepare('SELECT fingerprint FROM ssh_known_hosts WHERE host = ? AND port = ?')
      .get(host, port) as { fingerprint: string } | undefined;

    if (!known) {
      database
        .prepare(
          'INSERT INTO ssh_known_hosts (host, port, key_type, fingerprint) VALUES (?, ?, ?, ?)',
        )
        .run(host, port, keyType, fingerprint);

      this.logger.log(`Trusted new SSH host key for ${host}:${port} (${keyType} ${fingerprint}).`);
      return true;
    }

    if (known.fingerprint !== fingerprint) {
      throw new SshHostKeyMismatchError(
        `SSH host key for ${host}:${port} has changed (expected ${known.fingerprint}, got ${fingerprint}). ` +
          'This could be a man-in-the-middle attack. If the server key was changed on purpose, ' +
          'remove the old key from the trusted hosts and try again.',
      );
    }

    return true;
  }

  /** Kayıtlı bir sunucu anahtarını unutur (sunucu anahtarı bilerek değiştiyse). */
  forgetHostKey(host: string, port: number): boolean {
    const result = this.databaseService
      .getDatabase()
      .prepare('DELETE FROM ssh_known_hosts WHERE host = ? AND port = ?')
      .run(host, port);

    return result.changes > 0;
  }

  async close(connectionId: string): Promise<void> {
    const entry = this.tunnels.get(connectionId);
    if (!entry) return;

    this.tunnels.delete(connectionId);

    try {
      const tunnel = await entry.tunnel;
      tunnel.server.close();
      tunnel.client.end();
    } catch {
      // Kurulamamış tünel; kapatılacak bir şey yok.
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.subscription.unsubscribe();
    await Promise.all([...this.tunnels.keys()].map((id) => this.close(id)));
  }
}
