# Development Environment Setup

**Required:** Node 20 LTS · pnpm 9 · Docker Desktop · Git · VS Code · ngrok · psql 16.

## 1. Install

```bash
# Node 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20 && nvm use 20

# pnpm
npm install -g pnpm@9

# Verify
node --version   # v20.x
pnpm --version   # 9.x
docker --version
```

**VS Code extensions** (`.vscode/extensions.json`): `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `prisma.prisma`, `bradlc.vscode-tailwindcss`, `ms-azuretools.vscode-docker`, `NomicFoundation.hardhat-solidity`, `eamodio.gitlens`.

## 2. Docker Compose — Local Infra

`infra/docker-compose.yml`:

```yaml
name: fundchain
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: fundchain
      POSTGRES_PASSWORD: fundchain
      POSTGRES_DB: fundchain
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fundchain"]
      interval: 5s
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports: ["6379:6379"]
    volumes: [redisdata:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
volumes: { pgdata: , redisdata: }
```

```bash
docker compose -f infra/docker-compose.yml up -d    # start
docker compose -f infra/docker-compose.yml ps       # status
docker compose -f infra/docker-compose.yml down     # stop
docker compose -f infra/docker-compose.yml down -v  # reset (hapus data)
```

## 3. Environment Variables

`infra/.env.example` — commit ke repo, copy ke `.env` (jangan commit `.env`):

```bash
# Database & Redis
DATABASE_URL=postgresql://fundchain:fundchain@localhost:5432/fundchain
REDIS_URL=redis://localhost:6379

# Microsoft SSO
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_REDIRECT_URI=http://localhost:3000/api/v1/auth/callback

# Session
SESSION_JWT_SECRET=change-me-64-hex
SESSION_COOKIE_NAME=fundchain_session
SESSION_TTL_HOURS=8
ADMIN_EMAILS=admin@binus.ac.id

# Midtrans / Pakasir
PAYMENT_PROVIDER=midtrans
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_IS_PRODUCTION=false
PAKASIR_API_KEY=
PAKASIR_WEBHOOK_SECRET=

# Storage (Supabase)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET=fundchain-proposals

# Blockchain
BLOCKCHAIN_RPC_URL=https://sepolia.infura.io/v3/KEY
CONTRACT_ADDRESS=
RELAYER_PRIVATE_KEY=
CHAIN_ID=11155111

# Frontend
VITE_API_URL=http://localhost:3000/api/v1
LOG_LEVEL=info
```

```bash
cp infra/.env.example .env
```

## 4. Start Development

Jalankan di 5 terminal terpisah:

```bash
docker compose -f infra/docker-compose.yml up -d  # T1: infra
cd apps/api && pnpm dev                           # T2: backend
cd apps/worker && pnpm dev                        # T3: worker
cd apps/web && pnpm dev                           # T4: frontend
ngrok http 3000                                   # T5: webhook tunnel
```

## 5. Verify

```bash
curl http://localhost:3000/health
docker compose -f infra/docker-compose.yml exec postgres psql -U fundchain -d fundchain -c "\dt"
docker compose -f infra/docker-compose.yml exec redis redis-cli ping
```