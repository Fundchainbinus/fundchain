# Backup database (BFD-25)

Workflow: [`.github/workflows/backup.yml`](../.github/workflows/backup.yml) (nama di tab Actions: **DB backup**).

## Apa yang dilakukan

Setiap hari pukul **02:00 WIB** (cron `0 19 * * *` UTC), atau manual lewat **Run workflow** (`workflow_dispatch`):

1. **Cek secret.** Job langsung gagal dengan pesan jelas kalau `DIRECT_URL` atau `BACKUP_PASSPHRASE` kosong,
   atau passphrase kurang dari 16 karakter.
2. **Hitung baris sumber** untuk tabel utama (`users`, `campaigns`, `donations`, `payments`, `disbursements`,
   `audit_logs`, `stored_files`) dan cetak versi server.
3. **`pg_dump`** format custom (`-Fc`), hanya schema `public`, tanpa owner/privilege. Schema internal Supabase
   (`auth`, `storage`, `realtime`, ...) tidak dipakai aplikasi dan tidak ikut. Client Postgres dijalankan dari image
   Docker `postgres:17`, bukan client bawaan runner.
4. **Enkripsi** dengan `gpg --symmetric --cipher-algo AES256`. Passphrase lewat file descriptor, tidak lewat argv.
   Dump plaintext dihapus begitu terenkripsi.
5. **Upload artifact** `db-backup-<run_id>` berisi `fundchain-<UTC timestamp>.dump.gpg` dan file `.sha256`-nya.
   Artifact diunggah sebelum uji restore, jadi backup hari itu tetap tersimpan walaupun uji restore gagal.
6. **Uji restore.** File `.gpg` yang diunggah didekripsi lalu di-`pg_restore` ke service container `postgres:17`
   yang kosong. Setelah itu jumlah baris per tabel utama dibandingkan dengan sumber. Job **gagal** kalau:
   - dekripsi atau `pg_restore` gagal (`--exit-on-error`);
   - salah satu tabel utama tidak ada setelah restore;
   - `donations` kosong setelah restore padahal di sumber ada isinya.

   Jumlah restore yang lebih kecil dari sumber hanya menjadi warning. Hitungan sumber diambil beberapa detik
   sebelum snapshot `pg_dump`, jadi selisih kecil masih wajar.
7. **Bersihkan** folder kerja di `$RUNNER_TEMP` (selalu jalan, juga saat job gagal).

Tidak ada yang di-commit ke repo. Connection string turunan dan password-nya di-mask dari log
(`::add-mask::`). Yang tercetak di log hanya versi server dan jumlah baris per tabel.

### Versi Postgres

`PG_MAJOR` dan image service di workflow sama-sama **17**, dan keduanya harus diubah bersamaan. Versi server Supabase
tidak tercatat di repo (compose lokal memakai `postgres:16`), jadi 17 adalah asumsi. `pg_dump` 17 bisa membaca
server 15, 16, dan 17. Run pertama mencetak `server_version`; kalau server ternyata lebih baru dari 17, naikkan
`PG_MAJOR` dan image service.

## Secret GitHub yang dibutuhkan

Isi di **Settings → Secrets and variables → Actions → New repository secret**:

| Secret              | Isi                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `DIRECT_URL`        | Connection string Postgres untuk dump. Pakai **session pooler** Supabase (`...pooler.supabase.com:5432`), **bukan** transaction pooler (port 6543), karena `pg_dump` butuh sesi penuh. Jangan pakai direct connection `db.<ref>.supabase.co` karena biasanya hanya IPv6, sedangkan runner GitHub hanya IPv4. Query string Prisma (`?pgbouncer=`, `?schema=`) dibuang otomatis dan diganti `sslmode=require`. |
| `BACKUP_PASSPHRASE` | Passphrase enkripsi, minimal 16 karakter, acak (mis. `openssl rand -base64 32`). Simpan juga di password manager tim. **Tanpa passphrase ini backup tidak bisa dibuka.** |

Disarankan memakai role database read-only khusus backup daripada role `postgres`. Role itu cukup punya
`USAGE` di schema `public` dan `SELECT` di semua tabelnya. RLS tidak menghalangi role owner, tapi role
read-only biasa terkena RLS deny-all (D-003). Role itu perlu `BYPASSRLS`, atau dump tetap memakai role owner.

## Retensi

Artifact disimpan **14 hari** (`retention-days: 14`), setelah itu dihapus otomatis oleh GitHub. Untuk menyimpan
lebih lama, unduh artifact dan simpan terenkripsi di tempat lain. Jangan simpan versi yang sudah didekripsi.

## Data sensitif

Dump berisi **PII donatur** (nama, email, donasi) dan file upload (`stored_files`). Karena itu:

- File selalu terenkripsi AES256. Artifact tanpa passphrase tidak berguna.
- Artifact bisa diunduh oleh siapa pun yang punya akses **read** ke repo. "Hanya collaborator" berlaku **selama repo
  private**. Kalau repo dijadikan public, matikan workflow ini dulu atau pindahkan backup ke storage privat.
- Passphrase hanya dibagikan ke orang yang memang perlu me-restore.
- Jangan mendekripsi atau me-restore backup di mesin bersama, dan hapus hasil dekripsi setelah selesai.

## Restore manual

Prasyarat: Docker atau client Postgres 17 (`pg_restore`, `psql`) dan `gpg`.

```bash
# 1. Unduh artifact dari tab Actions → run "DB backup" → Artifacts (atau lewat gh CLI):
gh run download <run-id> -n db-backup-<run-id>

# 2. Cek integritas lalu dekripsi (passphrase diminta interaktif)
sha256sum -c fundchain-*.dump.gpg.sha256
gpg --decrypt --output fundchain.dump fundchain-*.dump.gpg

# 3a. Uji ke Postgres lokal sekali pakai
docker run -d --name fc-restore -e POSTGRES_PASSWORD=restore -p 55432:5432 postgres:17
psql "postgresql://postgres:restore@localhost:55432/postgres" -c 'DROP SCHEMA public CASCADE'
pg_restore --dbname="postgresql://postgres:restore@localhost:55432/postgres" \
  --no-owner --no-privileges --exit-on-error fundchain.dump

# 4. Hapus hasil dekripsi
shred -u fundchain.dump
```

**Restore ke production (Supabase) hanya saat insiden**, dengan persetujuan tech lead, dan setelah membuat backup
baru dari kondisi saat itu:

1. Hentikan trafik tulis dulu: matikan cron worker dan webhook pembayaran, atau aktifkan maintenance.
2. Restore ke project Supabase **baru/kosong** lalu arahkan `DATABASE_URL`/`DIRECT_URL` ke sana. Ini lebih aman
   daripada menimpa database yang sedang dipakai. Kalau terpaksa menimpa, pakai `pg_restore --clean --if-exists`
   dengan `--schema=public`.
3. Setelah restore, jalankan `prisma migrate status` (tidak boleh ada migrasi yang hilang) lalu verify-all integrity
   dari dashboard admin. Hash donasi harus tetap cocok dengan on-chain.
4. Catat insidennya di audit/post-mortem.

Catatan: `--no-privileges` membuat grant Supabase (role `anon`/`authenticated`) tidak ikut. Status RLS
(`ENABLE ROW LEVEL SECURITY`) tetap ikut ter-restore, dan karena desainnya deny-all (D-003) tidak ada policy
yang hilang.
