
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Servis kapanırken açık veritabanı havuzlarını düzgünce kapat.
  app.enableShutdownHooks();

  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
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

  const port = Number(process.env.LOCAL_SERVICE_PORT ?? 4317);

  await app.listen(port, '127.0.0.1');

  console.log(
    `TUKAKA Local Service running at http://127.0.0.1:${port}`,
  );
}

bootstrap().catch((error: unknown) => {
  console.error('TUKAKA Local Service failed to start:', error);
  process.exit(1);
});
