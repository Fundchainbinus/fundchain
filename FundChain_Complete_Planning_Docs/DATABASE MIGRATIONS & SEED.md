# Database Migration & Seed

## 1. Prisma Schema

File asli: `apps/api/prisma/schema.prisma`. Definisi lengkap di `docs/01-database-schema.md`. Section ini fokus ke workflow migration & seed.

## 2. Development Workflow

Setiap kali edit `schema.prisma`:

```bash
cd apps/api
pnpm prisma migrate dev --name add_user_role
```

Prisma akan: compare schema vs DB → generate SQL migration → apply ke local DB → regenerate Prisma Client.

Nama migration deskriptif: `add_user_role`, `add_blockchain_transactions`, `add_campaign_indexes`.

## 3. Production Deployment

```bash
pnpm prisma migrate deploy
```

Apply migration yang belum dijalanin. Gak generate baru, gak reset DB.

## 4. Rules

| Rule | Alasan |
|---|---|
| Never edit migrations setelah commit | Prisma hash-check, edit = corrupt |
| Every schema change = migration | Jangan edit DB manual |
| PR wajib include migration | Reviewer bisa lihat |
| Backward-compatible | Rolling deploy safety |
| Test di staging dulu | Prevent production surprise |
| Backup sebelum migrate prod | Safety net |

## 5. Common Commands

```bash
pnpm prisma migrate dev --name <desc>   # create + apply (dev)
pnpm prisma migrate deploy              # apply pending (prod)
pnpm prisma migrate reset               # wipe + reapply all
pnpm prisma migrate status              # cek status
pnpm prisma generate                    # regen client
pnpm prisma studio                      # GUI
```

## 6. Seed Script

`apps/api/prisma/seed.ts` — idempotent (pakai `upsert`, bukan `create`):

```typescript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Admin
  await prisma.user.upsert({
    where: { email: 'admin@binus.ac.id' },
    update: {},
    create: {
      microsoftId: 'seed-admin',
      email: 'admin@binus.ac.id',
      name: 'Admin BINUS',
      role: 'ADMIN',
    },
  });

  // Dummy student
  const student = await prisma.user.upsert({
    where: { email: 'student@binus.ac.id' },
    update: {},
    create: {
      microsoftId: 'seed-student',
      email: 'student@binus.ac.id',
      name: 'Demo Student',
      role: 'STUDENT',
    },
  });

  // Dummy campaign
  const campaign = await prisma.campaign.create({
    data: {
      creatorId: student.id,
      title: 'Clean Water for Desa Sukamaju',
      description: 'Menggalang dana untuk sistem air bersih bagi 200 keluarga.',
      sdgCategory: 'CLEAN_WATER',
      targetAmount: 15000000,
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'ACTIVE',
    },
  });

  // Dummy donation (PAID)
  await prisma.donation.create({
    data: {
      campaignId: campaign.id,
      donorId: student.id,
      amount: 100000,
      status: 'PAID',
      hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      canonicalPayload: 'v1|seed|STU-00001|100000|1790600000',
    },
  });

  console.log('Seed complete');
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

Register di `apps/api/package.json`:
```json
{ "prisma": { "seed": "ts-node prisma/seed.ts" } }
```

Run: `pnpm prisma db seed`.

## 7. Deployment Checklist

- [ ] Backup database
- [ ] Review SQL migration manual
- [ ] Test di staging
- [ ] Confirm backward-compatible
- [ ] Apply: `pnpm prisma migrate deploy`
- [ ] Verify schema: `psql \dt`
- [ ] Seed data (kalau perlu)
- [ ] Monitor error logs 15 menit

## 8. Rollback

Prisma gak support auto-rollback. Opsi:

1. **Reverse migration** — tulis migration baru yang reverse perubahan
2. **Restore backup** — `pg_restore -d fundchain backup.dump`
3. **Revert app version** — deploy versi lama yang compatible dengan schema lama

Untuk student project: backup harian cukup.

## 9. Best Practices

- Migration kecil & fokus (1 migration = 1 konsep)
- Test di local + staging sebelum prod
- Review SQL yang di-generate sebelum commit
- Jangan rename column langsung — add new → migrate data → drop old
- Jangan drop column tanpa deprecation period
- Seed data harus idempotent (`upsert`, bukan `create`)
- Migration & seed files di-commit ke repo

## 10. Definition of Done

- [ ] `migrate dev` clean di local
- [ ] Seed script bikin admin + student + campaign + donation
- [ ] Semua tabel visible via `psql` / Prisma Studio
- [ ] Migration files committed
- [ ] `.env` gak ke-commit