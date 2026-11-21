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
const reason = { reason: 'Alasan minimal sepuluh karakter.' };
const EXAMPLE_BODIES: Record<string, unknown> = {
  'POST /auth/google': { accessToken: '<google-access-token>' },
  'POST /campaigns': {
    title: 'Beasiswa Buku Anak Desa',
    description: 'Penggalangan dana untuk membeli buku pelajaran anak-anak desa.',
    sdgCategory: 'QUALITY_EDUCATION',
    targetAmount: 5_000_000,
    deadline: '2027-06-30',
  },
  'PATCH /campaigns/{id}': { targetAmount: 7_500_000 },
  'POST /campaigns/{id}/donations': { amount: 50_000, anonymous: false },
  'POST /admin/campaigns/{id}/reject': reason,
  'POST /admin/campaigns/{id}/freeze': reason,
  'POST /admin/campaigns/{id}/unfreeze': reason,
  'POST /admin/disbursements/{id}/reject': reason,
  'POST /admin/donations/{id}/refund': { reason: 'Campaign dibekukan, dana dikembalikan.' },
  'POST /dev/payments/{donationId}/simulate': { outcome: 'settlement' },
  'POST /webhooks/payment': { order_id: '<donation-id>', status: 'settlement', amount: 50_000 },
};

/** Endpoint multipart/form-data (upload file). */
const FORM_BODIES: Record<string, { key: string; type: 'text' | 'file'; value?: string }[]> = {
  'POST /campaigns/{id}/documents': [{ key: 'file', type: 'file' }],
  'POST /campaigns/{id}/disbursements': [
    { key: 'amount', type: 'text', value: '1000000' },
    { key: 'description', type: 'text', value: 'Pembelian buku tahap 1' },
    { key: 'proof', type: 'file' },
  ],
};

const EXTRA_HEADERS: Record<string, { key: string; value: string; description?: string }[]> = {
  'POST /campaigns/{id}/donations': [{ key: 'Idempotency-Key', value: '{{$guid}}' }],
  'POST /webhooks/payment': [
    { key: 'x-fundchain-signature', value: '<hmac-sha256 body dengan MOCK_WEBHOOK_SECRET>', description: 'Hanya untuk PAYMENT_PROVIDER=mock' },
  ],
  'GET /cron/tick': [{ key: 'Authorization', value: 'Bearer {{cronSecret}}' }],
};

/** Query yang berasal dari class DTO (tidak terbaca Swagger tanpa @ApiProperty). */
const EXTRA_QUERY: Record<string, string[]> = {
  'GET /campaigns': ['status', 'sdg', 'q', 'mine', 'limit', 'cursor'],
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
      const noAuth = ['/health', '/config', '/auth/google', '/webhooks/payment', '/cron/tick'].includes(rel);
      const queryNames = [...params.filter((p) => p.in === 'query').map((p) => p.name as string), ...(EXTRA_QUERY[key] ?? [])];
      const header: unknown[] = [...(EXTRA_HEADERS[key] ?? [])];
      const request: Record<string, unknown> = {
        method: method.toUpperCase(),
        header,
        url: {
          raw: `{{baseUrl}}${rel.replace(/\{(\w+)\}/g, ':$1')}`,
          host: ['{{baseUrl}}'],
          path: segments.map((s) => s.replace(/^\{(\w+)\}$/, ':$1')),
          variable: params.filter((p) => p.in === 'path').map((p) => ({ key: p.name, value: '' })),
          query: queryNames.map((name) => ({ key: name, value: '', disabled: true })),
        },
        ...(noAuth ? { auth: { type: 'noauth' } } : {}),
      };
      if (FORM_BODIES[key]) {
        request.body = { mode: 'formdata', formdata: FORM_BODIES[key].map((f) => (f.type === 'file' ? { key: f.key, type: 'file', src: [] } : f)) };
      } else if (EXAMPLE_BODIES[key] !== undefined) {
        header.push({ key: 'Content-Type', value: 'application/json' });
        request.body = { mode: 'raw', raw: JSON.stringify(EXAMPLE_BODIES[key], null, 2), options: { raw: { language: 'json' } } };
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
      { key: 'cronSecret', value: '' },
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
