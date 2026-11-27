
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';

import { AppModule } from './app.module';

/**
 * Electron `utilityProcess` içinde çalışırken ana süreçle mesajlaşma kanalı.
 * Normal Node.js altında tanımsızdır.
 */
interface ParentPort {
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort })
  .parentPort;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Servis kapanırken açık veritabanı havuzlarını düzgünce kapat.
  app.enableShutdownHooks();

  // Ek geliştirme origin'leri virgülle ayrılarak verilebilir
  // (ör. TUKAKA_ALLOWED_ORIGINS=http://127.0.0.1:5273).
  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(process.env.TUKAKA_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ];

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 0 verilirse işletim sistemi boş bir port seçer (paketlenmiş uygulama).
  const requestedPort = Number(process.env.LOCAL_SERVICE_PORT ?? 4317);

  await app.listen(requestedPort, '127.0.0.1');

  const { port } = app.getHttpServer().address() as AddressInfo;

  console.log(`TUKAKA Local Service running at http://127.0.0.1:${port}`);

  // Electron ana sürecine hazır olduğunu ve gerçek portu bildir.
  parentPort?.postMessage({ type: 'ready', port });

  watchOwnerProcess(() => void app.close().finally(() => process.exit(0)));
}

const OWNER_CHECK_INTERVAL_MS = 2000;

/**
 * Geliştirmede servisi Electron başlatır (pnpm → nest --watch → node zinciri).
 * Electron beklenmedik şekilde kapanırsa (ör. terminalde Ctrl+C) bu zincir
 * sahipsiz kalıp portu tutmaya devam edebilir; bu yüzden servis, kendisini
 * başlatan sürecin hâlâ yaşadığını düzenli olarak kontrol eder.
 */
function watchOwnerProcess(shutdown: () => void) {
  const ownerPid = Number(process.env.TUKAKA_OWNER_PID);

  if (!Number.isInteger(ownerPid) || ownerPid <= 0) return;

  const timer = setInterval(() => {
    try {
      // Sinyal 0 yalnızca sürecin var olup olmadığını sınar.
      process.kill(ownerPid, 0);
    } catch (error) {
      // EPERM: süreç var ama sinyal izni yok, yani hâlâ yaşıyor.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;

      clearInterval(timer);
      console.log(`Owner process ${ownerPid} is gone; stopping TUKAKA Local Service.`);
      shutdown();
    }
  }, OWNER_CHECK_INTERVAL_MS);

  timer.unref();
}

bootstrap().catch((error: unknown) => {
  console.error('TUKAKA Local Service failed to start:', error);

  parentPort?.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });

  process.exit(1);
});
