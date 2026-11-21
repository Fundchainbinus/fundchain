/**
 * BFD-44 — skema DTO di dokumen OpenAPI berasal dari plugin CLI `@nestjs/swagger` (nest-cli.json).
 *
 * Plugin itu transformer TypeScript yang hanya jalan di `nest build`; vitest (esbuild) dan
 * ts-node melewatinya, dan esbuild juga tidak mengeluarkan `design:paramtypes` sehingga tipe
 * @Body() tidak terbaca. Karena itu test ini menjalankan docs/openapi.ts di proses terpisah:
 * script itu menjalankan `nest build` sungguhan (config nest-cli.json yang sama dengan Vercel,
 * output ke .openapi-build/), lalu membangun dokumen dari controller hasil build dengan
 * dependency stub — tanpa .env/DB. Bila blok `plugins` dihapus dari nest-cli.json, skema DTO
 * hilang dan test ini gagal.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

type Schema = { type?: string; properties?: Record<string, Schema & { minLength?: number; minimum?: number; enum?: string[] }>; required?: string[] };
type Doc = {
  paths: Record<string, Record<string, { parameters?: { name: string; in: string }[]; requestBody?: { content: Record<string, { schema: { $ref?: string } }> } }>>;
  components: { schemas: Record<string, Schema> };
};

const apiDir = path.resolve(__dirname, '..');
let doc: Doc;

beforeAll(() => {
  const tsNode = createRequire(path.join(apiDir, 'package.json')).resolve('ts-node/dist/bin.js');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fundchain-openapi-')), 'openapi.json');
  execFileSync(process.execPath, [tsNode, '--transpile-only', 'docs/openapi.ts', '--out', out], { cwd: apiDir, stdio: 'pipe' });
  doc = JSON.parse(fs.readFileSync(out, 'utf8')) as Doc;
}, 240_000);

describe('OpenAPI (plugin @nestjs/swagger)', () => {
  it('CreateDonationDto punya amount (wajib) dan anonymous (opsional)', () => {
    const s = doc.components.schemas.CreateDonationDto;
    expect(s?.properties?.amount?.type).toBe('number');
    expect(s?.properties?.anonymous?.type).toBe('boolean');
    expect(s?.required).toEqual(['amount']);
  });

  it('classValidatorShim: batas class-validator ikut ke skema', () => {
    const c = doc.components.schemas.CreateCampaignDto;
    expect(c?.properties?.title?.minLength).toBeGreaterThan(0);
    expect(c?.properties?.targetAmount?.minimum).toBeGreaterThan(0);
    expect(c?.properties?.sdgCategory?.enum).toContain('QUALITY_EDUCATION');
    expect(doc.components.schemas.ReasonDto?.required).toContain('reason');
  });

  it('DTO yang dideklarasikan (tanpa export) di file *.controller.ts juga terbaca', () => {
    for (const name of ['GoogleLoginDto', 'CreateDisbursementDto', 'RefundDto', 'UploadUrlDto']) {
      expect(Object.keys(doc.components.schemas[name]?.properties ?? {}).length, name).toBeGreaterThan(0);
    }
  });

  it('request body dan query DTO terhubung ke route', () => {
    const body = doc.paths['/api/v1/campaigns/{id}/donations']?.post?.requestBody?.content['application/json']?.schema;
    expect(body?.$ref).toBe('#/components/schemas/CreateDonationDto');
    const query = (doc.paths['/api/v1/campaigns']?.get?.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name);
    expect(query).toEqual(expect.arrayContaining(['status', 'q', 'limit', 'cursor']));
  });
});
