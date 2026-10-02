import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

// Instance Nest di-cache antar invocation (warm start) — bootstrap hanya sekali per instance.
let cached: Promise<Handler> | null = null;

async function bootstrap(): Promise<Handler> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: ['error', 'warn', 'log'],
  });
  configureApp(app);
  await app.init();
  return app.getHttpAdapter().getInstance() as Handler;
}

/** Entry Vercel Function: semua request /api/* diteruskan ke Express milik Nest. */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  cached ??= bootstrap().catch((e) => {
    cached = null;
    throw e;
  });
  const app = await cached;
  await new Promise<void>((resolve) => {
    res.once('finish', resolve);
    res.once('close', resolve);
    app(req, res);
  });
}
