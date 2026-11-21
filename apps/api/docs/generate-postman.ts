/**
 * Membuat ulang docs/fundchain.postman_collection.json dari dokumen OpenAPI controller.
 *
 *   cd apps/api && pnpm exec ts-node --transpile-only docs/generate-postman.ts
 *
 * AMAN dijalankan tanpa database: AppModule TIDAK di-import (tidak ada ConfigModule/.env,
 * Prisma, worker, atau blockchain). Semua dependency controller diganti stub kosong —
 * hanya metadata route yang dibaca.
 */
import 'reflect-metadata';
import { Module, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AdminCampaignsController, CampaignsController } from '../src/modules/campaigns/campaigns.controller';
import { DisbursementsController } from '../src/modules/disbursements/disbursements.controller';
import { DonationsController } from '../src/modules/donations/donations.controller';
import { IntegrityController } from '../src/modules/integrity/integrity.controller';
import { UsersController } from '../src/modules/users/users.controller';

const controllers: Type[] = [
  UsersController,
  CampaignsController,
  AdminCampaignsController,
  DonationsController,
  IntegrityController,
  DisbursementsController,
];

/** Contoh body untuk endpoint utama (DTO tidak memakai dekorator @ApiProperty). */
const EXAMPLE_BODIES: Record<string, unknown> = {
  'POST /auth/google': { accessToken: '<google-access-token>' },
};

const deps = new Set<unknown>();
for (const c of controllers) for (const d of Reflect.getMetadata('design:paramtypes', c) ?? []) deps.add(d);

@Module({
  controllers,
  providers: [...deps].map((token) => ({ provide: token as Type, useValue: {} })),
})
class DocsModule {}

type PostmanItem = { name: string; item?: PostmanItem[]; request?: unknown };

function toPostman(doc: OpenAPIObject) {
  const folders = new Map<string, PostmanItem[]>();
  for (const [route, ops] of Object.entries(doc.paths)) {
    const rel = route.replace(/^\/api\/v1/, '');
    for (const [method, op] of Object.entries(ops as Record<string, { tags?: string[]; parameters?: any[] }>)) {
      const segments = rel.split('/').filter(Boolean);
      const folder = segments[0] === 'admin' ? 'admin' : segments[0] ?? 'root';
      const params = op.parameters ?? [];
      const key = `${method.toUpperCase()} ${rel}`;
      const isPublicish = ['/health', '/config', '/auth/google'].includes(rel) || rel.startsWith('/public');
      const request: Record<string, unknown> = {
        method: method.toUpperCase(),
        header: [] as unknown[],
        url: {
          raw: `{{baseUrl}}${rel.replace(/\{(\w+)\}/g, ':$1')}`,
          host: ['{{baseUrl}}'],
          path: segments.map((s) => s.replace(/^\{(\w+)\}$/, ':$1')),
          variable: params.filter((p) => p.in === 'path').map((p) => ({ key: p.name, value: '' })),
          query: params.filter((p) => p.in === 'query').map((p) => ({ key: p.name, value: '', disabled: true })),
        },
        ...(isPublicish ? { auth: { type: 'noauth' } } : {}),
      };
      if (EXAMPLE_BODIES[key] !== undefined || ['post', 'patch', 'put'].includes(method)) {
        const body = EXAMPLE_BODIES[key];
        (request.header as unknown[]).push({ key: 'Content-Type', value: 'application/json' });
        if (body !== undefined) request.body = { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } };
      }
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder)!.push({ name: key, request });
    }
  }
  return {
    info: {
      name: 'FundChain API',
      description:
        'Dibuat dari OpenAPI (docs/generate-postman.ts). Jalankan "POST /auth/google", lalu salin data.token ke variable collection `token`.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:3000/api/v1' },
      { key: 'token', value: '' },
    ],
    item: [...folders.entries()].map(([name, item]) => ({ name, item })),
  };
}

async function main() {
  const app = await NestFactory.create(DocsModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('FundChain API').setVersion('1.0').addBearerAuth(undefined, 'bearer').addSecurityRequirements('bearer').build(),
  );
  const out = path.resolve(__dirname);
  fs.writeFileSync(path.join(out, 'fundchain.postman_collection.json'), JSON.stringify(toPostman(document), null, 2) + '\n');
  await app.close();
  console.log(`OK: ${Object.keys(document.paths).length} path → docs/fundchain.postman_collection.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
