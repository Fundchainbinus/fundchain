# Dokumentasi API FundChain

## OpenAPI / Swagger UI

API menyajikan dokumentasi OpenAPI lewat `@nestjs/swagger` (diatur di `src/app.setup.ts`,
dipakai oleh `main.ts` maupun Vercel Function `serverless.ts`):

| URL | Isi |
| --- | --- |
| `http://localhost:3000/api/v1/docs` | Swagger UI |
| `http://localhost:3000/api/v1/docs-json` | Spec OpenAPI (JSON) |

Path memakai prefix global `api/v1` supaya ikut ter-rewrite ke function di Vercel
(`vercel.json` hanya meneruskan `/api/*`).

**Kapan aktif**

- Aktif bila `NODE_ENV` bukan `production` (dev lokal).
- Di production **mati**, kecuali `ENABLE_API_DOCS=true`.
- Catatan Vercel: bila dinyalakan di Vercel, `/api/v1/docs-json` pasti jalan; aset statis
  Swagger UI (`swagger-ui-dist`) mungkin tidak ikut di-bundle ke function sehingga halaman UI
  bisa tampil tanpa styling. Gunakan spec JSON + Postman/Swagger Editor bila itu terjadi.

Login di Swagger UI: panggil `POST /auth/google`, salin `data.token`, klik **Authorize**, isi token.

### Skema DTO (BFD-44)

Skema body dan query dibuat otomatis oleh **plugin CLI `@nestjs/swagger`** yang terdaftar di
`apps/api/nest-cli.json` (`classValidatorShim`, `introspectComments`). DTO tidak perlu
`@ApiProperty`: tipe properti, wajib/opsional (`?`), dan batas class-validator (`@MinLength`,
`@Min`, `@IsIn`, ...) ikut masuk ke skema, dan komentar JSDoc jadi `description`.

- Plugin hanya memproses file dengan akhiran `dtoFileNameSuffix`: `.dto.ts` **dan**
  `.controller.ts`, karena beberapa DTO dideklarasikan (tanpa export) di file controller.
  DTO baru sebaiknya ditaruh di `*.dto.ts`.
- Plugin adalah transformer TypeScript, jadi **hanya jalan di `nest build`** (termasuk build
  Vercel). `ts-node` dan vitest tidak menjalankannya.
- Response body belum punya skema (service mengembalikan tipe Prisma/objek biasa, bukan class).

## Dokumen OpenAPI tanpa server

```bash
cd apps/api
pnpm exec ts-node --transpile-only docs/openapi.ts --out openapi.json
```

`docs/openapi.ts` menjalankan `nest build -p tsconfig.openapi.json` (output ke `.openapi-build/`,
di-ignore git; `dist/` tidak tersentuh), me-require controller hasil build, lalu membuat dokumen
dengan semua dependency controller diganti stub. Tidak ada `.env`, database, worker, atau
blockchain yang disentuh. `src/openapi.test.ts` memakai script yang sama dan gagal bila plugin
dilepas dari `nest-cli.json`.

## Postman collection

`fundchain.postman_collection.json` berisi semua endpoint (dikelompokkan per resource) dengan:

- variable `baseUrl` (default `http://localhost:3000/api/v1`) dan `token`;
- auth Bearer `{{token}}` di level collection (endpoint publik seperti `/health`, `/config`,
  `/auth/google` memakai *No Auth*);
- query param terdaftar dalam keadaan nonaktif — centang yang dibutuhkan;
- body JSON berisi contoh: ditulis tangan untuk endpoint utama (`EXAMPLE_BODIES` di script),
  sisanya diturunkan otomatis dari skema DTO; endpoint upload memakai form-data.

Cara pakai: Import → pilih file → jalankan `POST /auth/google` dengan access token Google →
salin `data.token` ke variable `token` collection.

### Membuat ulang

Setelah menambah/mengubah endpoint:

```bash
cd apps/api
pnpm exec ts-node --transpile-only docs/generate-postman.ts
```

Script ini **tidak** menyentuh database: dokumen dibangun oleh `docs/openapi.ts` (lihat di atas),
`AppModule` tidak di-import, semua dependency controller diganti stub. Bila menambah controller
baru, daftarkan juga di array `CONTROLLERS` pada `docs/openapi.ts`.

## Auth

- `POST /auth/google` — tukar access token Google dengan token sesi (dibatasi 10 request/menit per IP).
- `GET /auth/me` (alias lama: `GET /me`) — profil user yang sedang login.
- `POST /auth/logout` — mencatat `AUTH_LOGOUT` di audit log; frontend lalu menghapus token.
  Token sesi masih stateless (HMAC, TTL 7 hari) sehingga **belum dicabut di server**; pencabutan
  nyata butuh kolom versi sesi di tabel `User` (perlu migrasi yang dijalankan manual, karena
  build Vercel tidak menjalankan `prisma migrate deploy`).
