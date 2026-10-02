import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { env } from './common/env';

async function bootstrap() {
  // rawBody dibutuhkan untuk verifikasi signature webhook.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const cfg = env();
  const logger = new Logger('Bootstrap');

  configureApp(app);
  app.enableShutdownHooks();

  if (cfg.isProduction && cfg.demoMode) {
    logger.warn('DEMO_MODE aktif di produksi! Siapa pun bisa berpura-pura menjadi user lain.');
  }

  await app.listen(cfg.port);
  logger.log(`FundChain API → http://localhost:${cfg.port}/api/v1 (payment: ${cfg.paymentProvider})`);
}

bootstrap();
