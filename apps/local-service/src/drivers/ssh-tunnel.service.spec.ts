import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { Server, utils } from 'ssh2';

import { ConnectionEventsService } from '../connections/connection-events.service';
import { DatabaseService } from '../database/database.service';
import { SshHostKeyMismatchError, SshTunnelService } from './ssh-tunnel.service';
import { makeProfile } from './test-helpers';

const listen = (server: net.Server | Server) =>
  new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
  });

/** Gelen her satıra "pong:<satır>" ile yanıt veren hedef sunucu. */
function startEchoServer() {
  const server = net.createServer((socket) => {
    socket.on('data', (data) => socket.write(`pong:${data.toString()}`));
  });
  return server;
}

/** Şifreyle kimlik doğrulayan ve direct-tcpip kanallarını aktaran SSH sunucusu. */
function startSshServer(hostKey: string) {
  return new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'tunnel' && ctx.password === 'secret') {
        ctx.accept();
      } else {
        ctx.reject(['password']);
      }
    });

    client.on('ready', () => {
      client.on('tcpip', (accept, reject, info) => {
        const socket = net.connect(info.destPort, info.destIP, () => {
          const stream = accept();
          socket.pipe(stream).pipe(socket);
        });
        socket.on('error', () => reject());
      });
    });

    client.on('error', () => undefined);
  });
}

function roundTrip(port: number, message: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(message));
    socket.once('data', (data) => {
      resolve(data.toString());
      socket.end();
    });
    socket.once('error', reject);
  });
}

describe('SshTunnelService', () => {
  let directory: string;
  let database: DatabaseService;
  let events: ConnectionEventsService;
  let service: SshTunnelService;
  let echo: net.Server;
  let echoPort: number;
  let ssh: Server;
  let sshPort: number;
  const originalDataDir = process.env.TUKAKA_DATA_DIR;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tukaka-ssh-'));
    process.env.TUKAKA_DATA_DIR = directory;

    database = new DatabaseService();
    database.onModuleInit();
    events = new ConnectionEventsService();
    service = new SshTunnelService(database, events);

    echo = startEchoServer();
    echoPort = await listen(echo);

    ssh = startSshServer(utils.generateKeyPairSync('ed25519').private);
    sshPort = await listen(ssh);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    events.onModuleDestroy();
    await new Promise((resolve) => ssh.close(resolve));
    await new Promise((resolve) => echo.close(resolve));
    database.onModuleDestroy();
    process.env.TUKAKA_DATA_DIR = originalDataDir;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const profile = () =>
    makeProfile({ type: 'postgresql', host: '127.0.0.1', port: echoPort, database: 'db' });

  const sshConfig = () => ({
    enabled: true,
    host: '127.0.0.1',
    port: sshPort,
    username: 'tunnel',
    authMethod: 'password' as const,
  });

  it('forwards traffic through the SSH server', async () => {
    const tunneled = await service.apply(profile(), sshConfig(), 'secret');

    expect(tunneled.host).toBe('127.0.0.1');
    expect(tunneled.port).not.toBe(echoPort);
    await expect(roundTrip(tunneled.port!, 'ping')).resolves.toBe('pong:ping');

    // Aynı ayarlarla ikinci çağrı aynı tüneli kullanır.
    const again = await service.apply(profile(), sshConfig(), 'secret');
    expect(again.port).toBe(tunneled.port);
  });

  it('leaves the profile untouched when the tunnel is disabled', async () => {
    const original = profile();
    await expect(
      service.apply(original, { ...sshConfig(), enabled: false }, null),
    ).resolves.toBe(original);
  });

  it('rejects a wrong password', async () => {
    await expect(service.apply(profile(), sshConfig(), 'wrong')).rejects.toThrow(
      /authentication/i,
    );
  });

  it('closes the tunnel when the connection is invalidated', async () => {
    const tunneled = await service.apply(profile(), sshConfig(), 'secret');

    events.invalidate(tunneled.id);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(roundTrip(tunneled.port!, 'ping')).rejects.toThrow();
  });

  it('pins the host key on first use and rejects a changed key', () => {
    const first = utils.parseKey(utils.generateKeyPairSync('ed25519').public);
    const second = utils.parseKey(utils.generateKeyPairSync('ed25519').public);

    if (first instanceof Error || second instanceof Error) throw new Error('key');

    const firstKey = (Array.isArray(first) ? first[0] : first).getPublicSSH();
    const secondKey = (Array.isArray(second) ? second[0] : second).getPublicSSH();

    expect(service.verifyHostKey('bastion', 22, firstKey)).toBe(true);
    expect(service.verifyHostKey('bastion', 22, firstKey)).toBe(true);
    expect(() => service.verifyHostKey('bastion', 22, secondKey)).toThrow(
      SshHostKeyMismatchError,
    );

    expect(service.forgetHostKey('bastion', 22)).toBe(true);
    expect(service.verifyHostKey('bastion', 22, secondKey)).toBe(true);
  });
});
