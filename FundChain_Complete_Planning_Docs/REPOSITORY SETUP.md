# Repository Setup

Monorepo FundChain — semua code (web, api, worker, contracts, packages) di satu repo. Package manager: **pnpm 9**. Node: **20 LTS**.

## 1. Struktur

```
fundchain/
├── apps/
│   ├── web/          # React + Vite (5173)
│   ├── api/          # NestJS + Prisma (3000)
│   └── worker/       # BullMQ + ethers.js (no port)
├── packages/
│   ├── types/        # Shared TS types
│   ├── shared/       # Error codes, constants
│   └── blockchain-client/  # ethers wrapper + canonical
├── contracts/        # Hardhat + DonationRegistry.sol
├── infra/            # docker-compose, .env.example
├── docs/
├── .gitignore .editorconfig .nvmrc
├── pnpm-workspace.yaml
└── package.json
```

## 2. Bootstrap

```bash
mkdir fundchain && cd fundchain
git init && git branch -M main
pnpm init
mkdir -p apps/{web,api,worker} packages/{types,shared,blockchain-client}
mkdir -p contracts/{contracts,scripts,test} infra docs

cat > pnpm-workspace.yaml <<'EOF'
packages:
  - 'apps/*'
  - 'packages/*'
  - 'contracts'
EOF

cat > package.json <<'EOF'
{
  "name": "fundchain",
  "private": true,
  "scripts": {
    "dev:web": "pnpm --filter @fundchain/web dev",
    "dev:api": "pnpm --filter @fundchain/api start:dev",
    "dev:worker": "pnpm --filter @fundchain/worker start:dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test"
  },
  "devDependencies": { "prettier": "^3.3.0", "typescript": "^5.5.0" },
  "engines": { "node": ">=20", "pnpm": ">=9" }
}
EOF

cat > .gitignore <<'EOF'
node_modules/
dist/ build/ .next/
.env .env.local
*.log
coverage/
.DS_Store
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
contracts/artifacts/ contracts/cache/ contracts/typechain-types/
apps/api/prisma/*.db
EOF

cat > .editorconfig <<'EOF'
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
[*.md]
trim_trailing_whitespace = false
EOF

echo "20" > .nvmrc
git add . && git commit -m "chore: initial monorepo scaffold"
```

## 3. Apps

| App | Stack | Port | Package name |
|---|---|---|---|
| web | React + Vite + Tailwind | 5173 | `@fundchain/web` |
| api | NestJS + Prisma | 3000 | `@fundchain/api` |
| worker | NestJS standalone + BullMQ + ethers | — | `@fundchain/worker` |

Worker connect ke Redis buat listen queue, submit blockchain tx. Gak expose HTTP.

## 4. Packages

Shared code antar apps. Di-import via `"@fundchain/<name>": "workspace:*"`.

**types** — entities & enums (User, Campaign, Donation, Payment, Blockchain, Disbursement).
**shared** — `errors.ts` (ErrorCode enum), `constants.ts` (SDG list, limits), `validation.ts`.
**blockchain-client** — `canonical.ts` (buildCanonicalPayload, hashPayload), `client.ts` (contract wrapper), `abi.ts`.

## 5. Git Workflow

| Branch | Protected |
|---|---|
| `main` | ✅ PR + 1 approval + CI |
| `develop` | ✅ PR + CI |
| `feat/<scope>-<desc>` | ❌ |
| `fix/<scope>-<desc>` | ❌ |
| `hotfix/<desc>`, `docs/<desc>`, `chore/<desc>` | ❌ |

**Workflow:** `git checkout develop && git pull` → `git checkout -b feat/xxx` → coding → push → PR ke `develop` → review → squash merge → delete branch. Weekly: `develop` → `main` setelah Sabtu demo.

**Conventional Commits:** `feat(auth): add SSO login` · `fix(donations): prevent duplicate webhook` · `docs(api): update endpoints` · `chore(deps): bump prisma`.

## 6. Branch Protection (GitHub)

**`main`:** Require PR + 1 approval + status checks (`lint`, `typecheck`, `test`) + branch up to date + no force push.
**`develop`:** Require PR + status checks.

## 7. CI — `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request: { branches: [main, develop] }
  push: { branches: [main, develop] }

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: test }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 5s
          --health-timeout 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @fundchain/api prisma migrate deploy
        env: { DATABASE_URL: postgresql://test:test@localhost:5432/test }
      - run: pnpm test
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/test
          REDIS_URL: redis://localhost:6379
```

## 8. VSCode

**`.vscode/extensions.json`:** `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `prisma.prisma`, `bradlc.vscode-tailwindcss`, `ms-azuretools.vscode-docker`, `NomicFoundation.hardhat-solidity`, `eamodio.gitlens`.

**`.vscode/settings.json`:**
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "files.eol": "\n"
}
```
