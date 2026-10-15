# i_Do_Backend

API for the **i do** e-commerce website (idowellness.ai) — orders, consults, auth.
NestJS 10 + TypeORM + PostgreSQL. See `CLAUDE.md` for the full architecture, route
table, and the reasoning behind specific decisions — this file is just setup.

Sibling repo: `../i_Do_Frontend` (Next.js) is the only customer-facing client.

## Setup

Needs a reachable Postgres. Easiest path — bring up just the database via the shared
compose file (see below) and run this service directly:

```bash
docker compose up -d postgres     # starts `ido-postgres` on localhost:5433
cp .env.example .env              # already points at that container by default
npm install
npm run migration:run             # apply all existing migrations
npm run start:dev                 # http://localhost:3011
```

`npm` — not pnpm (the frontend uses pnpm; don't mix lockfiles between the two repos).

### Running the whole stack (frontend + backend + postgres) via Docker

`docker-compose.yml` in this repo builds and runs all three together — it expects
`../i_Do_Frontend` to exist as a sibling directory (clone both repos into the same
parent folder, with those exact names, before running this):

```bash
cp .env.example .env
docker compose up -d
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3011
- Postgres: `localhost:5433` on the host, `postgres:5432` inside the Compose network

`docker compose down` stops all three; data persists in the named volume
`ido_postgres_data` (`docker compose down -v` would wipe it — don't run that unless
you actually want a clean slate).

## Env vars

See `.env.example` for the full list with explanations inline. Required to boot at
all: `DB_*`. Required for specific features to actually work (each fails cleanly,
not silently, when blank):

| Feature | Vars | Blank behavior |
|---|---|---|
| Payments (Razorpay) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Throws on the first payment attempt |
| Email (AWS SES) | `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` | Email sends fail |
| Phone OTP (SMS) | `FAST2SMS_API_KEY` | Throws — the customer must know the code didn't send |
| Phone OTP (WhatsApp copy) | `MESSENGER_WEBHOOK_URL`, `MESSENGER_API_KEY` | Silently skipped (logs a warning), never blocks the SMS |
| partner-app-server integration | `PARTNER_APP_API_KEY` | Those endpoints reject every request |

Never commit `.env` — only `.env.example`.

## Migrations

Real TypeORM migrations, `DB_SYNC` stays `false` always.

```bash
npm run migration:generate -- src/migrations/SomeName   # after changing an entity
npm run migration:run
npm run migration:revert
```

Read a generated migration before running it, and remember to add any new entity to
**both** `src/data-source.ts` (CLI) and `src/app.module.ts` (runtime) — they're kept
in sync by hand, not shared.

## Tests

```bash
npm run test       # unit — none exist yet
npm run test:e2e   # only /health — boots the full AppModule, needs a reachable DB
```
