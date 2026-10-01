import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './common/env';
import { validationExceptionFactory } from './common/http';

async function bootstrap() {
  // rawBody dibutuhkan untuk verifikasi signature webhook.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const cfg = env();
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api/v1');
  app.set('trust proxy', 'loopback');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.enableCors({
    origin: cfg.webUrl.split(','),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Acting-User'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.enableShutdownHooks();

  if (cfg.isProduction && cfg.demoMode) {
    logger.warn('DEMO_MODE aktif di produksi! Siapa pun bisa berpura-pura menjadi user lain.');
  }

  await app.listen(cfg.port);
  logger.log(`FundChain API → http://localhost:${cfg.port}/api/v1 (payment: ${cfg.paymentProvider})`);
}

bootstrap();
