
import { Logger } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

export interface JdbcQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  affected: number;
  statementCount: number;
}

export class JdbcBridgeError extends Error {
  constructor(
    message: string,
    readonly sqlState: string | null = null,
    readonly code: number | null = null,
  ) {
    super(message);
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface JdbcBridgeLocation {
  java: string;
  classpath: string[];
}

const BRIDGE_JAR = 'tukaka-jdbc-bridge.jar';
const MAIN_CLASS = 'com.tukaka.bridge.JdbcBridge';

/**
 * Java ve köprü jar'larının yerini bulur.
 *
 * - Java: TUKAKA_JAVA_HOME (paketlenmiş uygulamadaki gömülü JRE), JAVA_HOME,
 *   sonra PATH'teki `java`.
 * - Jar'lar: TUKAKA_JAVA_DIR (paketlenmiş uygulama), yoksa servis klasöründeki
 *   `java/` (geliştirme). `dist/` köprüyü, `lib/` JDBC sürücülerini içerir.
 *   TUKAKA_JDBC_CLASSPATH ile ek sürücüler (ör. testlerde sqlite-jdbc) eklenebilir.
 */
export function locateBridge(env: NodeJS.ProcessEnv = process.env): JdbcBridgeLocation {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const javaHome = env.TUKAKA_JAVA_HOME || env.JAVA_HOME;
  const java = javaHome ? path.join(javaHome, 'bin', exe) : exe;

  const javaDir = env.TUKAKA_JAVA_DIR
    ? path.resolve(env.TUKAKA_JAVA_DIR)
    : path.resolve(process.cwd(), 'java');

  const bridgeJar = [path.join(javaDir, 'dist', BRIDGE_JAR), path.join(javaDir, BRIDGE_JAR)].find(
    (candidate) => existsSync(candidate),
  );

  if (!bridgeJar) {
    throw new JdbcBridgeError(
      'IBM i support is not installed: the JDBC bridge was not found. ' +
        'Run "pnpm --filter local-service build:java" (requires a JDK).',
    );
  }

  const libDir = path.join(javaDir, 'lib');
  const drivers = existsSync(libDir)
    ? readdirSync(libDir)
        .filter((file) => file.endsWith('.jar'))
        .map((file) => path.join(libDir, file))
    : [];

  const extra = (env.TUKAKA_JDBC_CLASSPATH ?? '')
    .split(path.delimiter)
    .filter(Boolean);

  return { java, classpath: [bridgeJar, ...drivers, ...extra] };
}

/**
 * Java JDBC köprüsü süreciyle konuşan istemci (satır başına bir JSON mesajı).
 * Süreç ilk istekte başlatılır; çökerse bir sonraki istekte yeniden başlatılır.
 */
export class JdbcBridge {
  private readonly logger = new Logger(JdbcBridge.name);

  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;

  constructor(private readonly locate: () => JdbcBridgeLocation = () => locateBridge()) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;

    const { java, classpath } = this.locate();

    this.ready = new Promise<void>((resolve, reject) => {
      const child = spawn(
        java,
        [
          '-Xmx512m',
          '-Dfile.encoding=UTF-8',
          '-Djava.awt.headless=true',
          '-cp',
          classpath.join(path.delimiter),
          MAIN_CLASS,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );

      this.child = child;
      let started = false;

      // Eski (durdurulmuş) bir sürecin gecikmeli olayları yeni süreci etkilemesin.
      const isCurrent = () => this.child === child;

      child.on('error', (error: NodeJS.ErrnoException) => {
        const message =
          error.code === 'ENOENT'
            ? 'Java runtime not found. IBM i connections need Java 11 or newer: install it or set JAVA_HOME.'
            : `JDBC bridge could not start: ${error.message}`;

        if (isCurrent()) this.fail(new JdbcBridgeError(message));
        if (!started) reject(new JdbcBridgeError(message));
      });

      child.on('exit', (code) => {
        if (isCurrent()) {
          this.fail(new JdbcBridgeError(`JDBC bridge exited unexpectedly (code ${code}).`));
        }
        if (!started) reject(new JdbcBridgeError(`JDBC bridge exited during startup (code ${code}).`));
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data: string) => {
        for (const line of data.split('\n').filter(Boolean)) {
          this.logger.debug(`[java] ${line}`);
        }
      });

      createInterface({ input: child.stdout }).on('line', (line) => {
        let message: {
          id?: number;
          event?: string;
          ok?: boolean;
          result?: unknown;
          error?: { message: string; sqlState?: string | null; code?: number | null };
        };

        try {
          message = JSON.parse(line);
        } catch {
          this.logger.warn(`Unexpected output from JDBC bridge: ${line.slice(0, 200)}`);
          return;
        }

        if (message.event === 'ready') {
          started = true;
          resolve();
          return;
        }

        const pending = message.id !== undefined ? this.pending.get(message.id) : undefined;
        if (!pending) return;

        this.pending.delete(message.id!);

        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(
            new JdbcBridgeError(
              message.error?.message ?? 'Unknown JDBC error.',
              message.error?.sqlState ?? null,
              message.error?.code ?? null,
            ),
          );
        }
      });
    });

    // Başlatma başarısız olursa bir sonraki istekte yeniden denensin.
    const current = this.ready;
    current.catch(() => {
      if (this.ready === current) {
        this.ready = null;
        this.child = null;
      }
    });

    return this.ready;
  }

  /** Süreç durunca bekleyen tüm istekleri hatayla sonlandırır. */
  private fail(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.child = null;
    this.ready = null;
  }

  async request<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    await this.start();

    const child = this.child;
    if (!child) throw new JdbcBridgeError('JDBC bridge is not running.');

    const id = ++this.nextId;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      child.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`);
    });
  }

  open(options: {
    url: string;
    user?: string | null;
    password?: string | null;
    properties?: Record<string, string>;
    driverClass?: string;
    poolSize?: number;
  }) {
    return this.request<{ handle: string }>('open', options);
  }

  query(options: {
    handle: string;
    sql: string;
    params?: unknown[];
    maxRows?: number;
    timeoutSeconds?: number;
    queryId?: string;
  }) {
    return this.request<JdbcQueryResult>('query', options);
  }

  batch(options: {
    handle: string;
    statements: Array<{ sql: string; params: unknown[]; expectedRows?: number }>;
  }) {
    return this.request<{ affected: number[] }>('batch', options);
  }

  cancel(queryId: string) {
    return this.request<{ cancelled: boolean }>('cancel', { queryId });
  }

  close(handle: string) {
    return this.request<Record<string, never>>('close', { handle });
  }

  /** Köprü sürecini durdurur (servis kapanırken). */
  stop(): void {
    const child = this.child;
    this.fail(new JdbcBridgeError('JDBC bridge stopped.'));

    if (child) {
      child.stdin.end();
      child.kill();
    }
  }
}
