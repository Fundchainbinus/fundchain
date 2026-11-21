import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { apiDocsEnabled, env, insecureDefaultWarnings } from './common/env';
import { validationExceptionFactory } from './common/http';

/** Konfigurasi bersama untuk server lokal (main.ts) dan Vercel Function (serverless.ts). */
export function configureApp(app: INestApplication) {
  const cfg = env();
  const logger = new Logger('Bootstrap');
  for (const warning of insecureDefaultWarnings()) logger.warn(`WARNING: ${warning}`);

  app.setGlobalPrefix('api/v1');
  (app as NestExpressApplication).set('trust proxy', cfg.isProduction ? 1 : 'loopback');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.enableCors({
    origin: cfg.webUrl.split(','),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'Authorization'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  if (apiDocsEnabled()) setupApiDocs(app);
}

/**
 * OpenAPI di /api/v1/docs (UI) dan /api/v1/docs-json (spec). Diberi prefix global supaya
 * ikut ter-rewrite ke Vercel Function (`/api/(.*)`). Modul swagger di-require secara lazy
 * agar cold start production (docs mati) tidak ikut memuatnya.
 */
function setupApiDocs(app: INestApplication) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger') as typeof import('@nestjs/swagger');
  const config = new DocumentBuilder()
    .setTitle('FundChain API')
    .setDescription('REST API FundChain. Login lewat POST /auth/google, lalu kirim token sebagai Authorization: Bearer <token>.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Token sesi dari POST /auth/google' }, 'bearer')
    .addSecurityRequirements('bearer')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
}
