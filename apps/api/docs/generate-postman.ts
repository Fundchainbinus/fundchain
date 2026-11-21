/**
 * Membuat ulang docs/fundchain.postman_collection.json dari dokumen OpenAPI controller.
 *
 *   cd apps/api && pnpm exec ts-node --transpile-only docs/generate-postman.ts
 *
 * AMAN dijalankan tanpa database: dokumen dibuat oleh docs/openapi.ts (nest build ke
 * .openapi-build/ dengan plugin @nestjs/swagger, lalu controller dimuat dengan dependency stub;
 * AppModule, .env, Prisma, worker, dan blockchain tidak disentuh).
 */
import { type OpenAPIObject } from '@nestjs/swagger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildOpenApiDocument } from './openapi';

/**
 * Contoh body yang ditulis tangan (nilai realistis). Endpoint JSON lain mendapat contoh otomatis
 * dari skema DTO (plugin @nestjs/swagger) lewat exampleFromSchema.
 */
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
  'POST /files/upload-url': { purpose: 'campaign-document',fileName: 'proposal.pdf', contentType: 'application/pdf', size: 245_760 },
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

type Schema = {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  example?: unknown;
  minimum?: number;
  minLength?: number;
  items?: Schema;
  properties?: Record<string, Schema>;
};

/** Contoh nilai dari skema OpenAPI (dipakai bila endpoint tidak ada di EXAMPLE_BODIES). */
function exampleFromSchema(schema: Schema, doc: OpenAPIObject, name = 'value'): unknown {
  if (schema.$ref) {
    const ref = doc.components?.schemas?.[schema.$ref.split('/').pop()!] as Schema | undefined;
    return ref ? exampleFromSchema(ref, doc, name) : {};
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.enum?.length) return schema.enum[0];
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, exampleFromSchema(v, doc, k)]));
    case 'array':
      return schema.items ? [exampleFromSchema(schema.items, doc, name)] : [];
    case 'number':
    case 'integer':
      return schema.minimum ?? 1;
    case 'boolean':
      return false;
    case 'string':
      if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
      return `<${name}>`.padEnd(schema.minLength ?? 0, '.');
    default:
      return {};
  }
}

type PostmanItem = { name: string; item?: PostmanItem[]; request?: unknown };

function toPostman(doc: OpenAPIObject) {
  const folders = new Map<string, PostmanItem[]>();
  for (const [route, ops] of Object.entries(doc.paths)) {
    const rel = route.replace(/^\/api\/v1/, '');
    for (const [method, op] of Object.entries(ops as Record<string, { parameters?: any[]; requestBody?: any }>)) {
      const segments = rel.split('/').filter(Boolean);
      const folder = segments[0] === 'admin' ? 'admin' : segments[0] ?? 'root';
      const params = op.parameters ?? [];
      const key = `${method.toUpperCase()} ${rel}`;
      const noAuth = ['/health', '/config', '/files/config', '/auth/google', '/auth/demo', '/webhooks/payment', '/cron/tick'].includes(rel);
      // Query DTO (mis. ListCampaignsQuery) kini terbaca lewat plugin; Set mencegah duplikat.
      const queryNames = [...new Set(params.filter((p) => p.in === 'query').map((p) => p.name as string))];
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
      } else {
        const jsonSchema = op.requestBody?.content?.['application/json']?.schema as Schema | undefined;
        const example = EXAMPLE_BODIES[key] ?? (jsonSchema ? exampleFromSchema(jsonSchema, doc) : undefined);
        if (example !== undefined) {
          header.push({ key: 'Content-Type', value: 'application/json' });
          request.body = { mode: 'raw', raw: JSON.stringify(example, null, 2), options: { raw: { language: 'json' } } };
        }
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
  const document = await buildOpenApiDocument();
  fs.writeFileSync(path.join(__dirname, 'fundchain.postman_collection.json'), JSON.stringify(toPostman(document), null, 2) + '\n');
  console.log(`OK: ${Object.keys(document.paths).length} path → docs/fundchain.postman_collection.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
