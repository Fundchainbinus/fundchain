/**
 * Membangun dokumen OpenAPI FundChain tanpa database (BFD-44).
 *
 *   cd apps/api && pnpm exec ts-node --transpile-only docs/openapi.ts --out openapi.json
 *
 * Skema DTO (body/query) dibuat oleh plugin CLI `@nestjs/swagger` yang terdaftar di nest-cli.json.
 * Plugin itu hanya jalan di dalam `nest build` (bukan ts-node/vitest), jadi script ini:
 *   1. menjalankan `nest build -p tsconfig.openapi.json` → output di .openapi-build/ (dist/ tidak disentuh);
 *   2. me-require controller hasil build (sudah berisi metadata plugin + design:paramtypes);
 *   3. membuat dokumen dari controller itu dengan semua dependency diganti stub kosong.
 * AppModule TIDAK di-import: tidak ada ConfigModule/.env, Prisma, worker, atau blockchain.
 */
import 'reflect-metadata';
import { Module, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(API_DIR, '.openapi-build');

/** [file hasil build relatif ke .openapi-build, nama export controller] — samakan dengan AppModule. */
const CONTROLLERS: [string, string][] = [
  ['modules/users/users.controller', 'UsersController'],
  ['modules/campaigns/campaigns.controller', 'CampaignsController'],
  ['modules/campaigns/campaigns.controller', 'AdminCampaignsController'],
  ['modules/donations/donations.controller', 'DonationsController'],
  ['modules/integrity/integrity.controller', 'IntegrityController'],
  ['modules/disbursements/disbursements.controller', 'DisbursementsController'],
  ['modules/storage/files.controller', 'FilesController'],
];

function nestBuild() {
  const nestBin = require.resolve('@nestjs/cli/bin/nest.js', { paths: [API_DIR] });
  execFileSync(process.execPath, [nestBin, 'build', '-p', 'tsconfig.openapi.json'], { cwd: API_DIR, stdio: 'pipe' });
}

export async function buildOpenApiDocument(): Promise<OpenAPIObject> {
  nestBuild();
  const controllers: Type[] = CONTROLLERS.map(([file, name]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(BUILD_DIR, file)) as Record<string, Type>;
    if (!mod[name]) throw new Error(`${name} tidak ditemukan di ${file}`);
    return mod[name];
  });

  const deps = new Set<unknown>();
  for (const c of controllers) for (const d of Reflect.getMetadata('design:paramtypes', c) ?? []) deps.add(d);

  @Module({ controllers, providers: [...deps].map((token) => ({ provide: token as Type, useValue: {} })) })
  class DocsModule {}

  const app = await NestFactory.create(DocsModule, { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    return SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('FundChain API').setVersion('1.0').addBearerAuth(undefined, 'bearer').addSecurityRequirements('bearer').build(),
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  buildOpenApiDocument()
    .then((doc) => {
      const json = JSON.stringify(doc, null, 2) + '\n';
      if (i >= 0) fs.writeFileSync(process.argv[i + 1], json);
      else process.stdout.write(json);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
