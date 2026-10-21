# i_Do_Backend

Backend for the **i do** e-commerce website (idowellness.ai) — the storefront that sells Avataar's
smart ring. **"i do" is the rebrand of LUME**: the same ring as `lume-backend` / `lume-mobile`.
If a comment, ticket or teammate says "Lume", it means this product.

This service is **only the website** (shop, checkout, account, consult booking). It is *not* the
ring/health-data backend — that is `lume-backend`. The two share no database, no user table and no
code: a website account does not create a ring-app account, and vice versa.

Sibling repo: `../i_Do_Frontend` (Next.js) is the only customer-facing client.

## Stack

NestJS 10 · TypeORM 0.3 · PostgreSQL · Passport-JWT · bcrypt · Razorpay · AWS SES (nodemailer + SESv2) ·
Fast2SMS (SMS OTP) · Avataar "Messenger" WhatsApp gateway (OTP copy).
npm (not pnpm — the frontend uses pnpm).

## Commands

```bash
npm install
npm run start:dev            # watch mode, PORT from .env (3011 in .env.example)
npm run build && npm run start:prod
npm run lint                 # eslint --fix
npm run test                 # unit (none exist yet)
npm run test:e2e             # only /health — boots AppModule, so needs a reachable DB

npm run migration:generate -- src/migrations/<Name>   # diff entities → new migration
npm run migration:run
npm run migration:revert
```

## Architecture

`src/main.ts` — global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`, so every
request body **must** be a class-validator DTO; unknown fields are rejected with 400. CORS allows
only `FRONTEND_ORIGIN`.

| Module | Routes | Auth |
|---|---|---|
| `auth` | `POST /auth/email/send-otp`, `/email/verify-otp`, `/phone/send-otp`, `/phone/verify-otp`, `/refresh`, `/logout` | public |
| | `POST /auth/register`, `/login`, `/forgot-password`, `/reset-password` (password flows, kept until removed by decision) | public |
| | `GET /auth/me`, `POST /auth/verify-email`, `/resend-verification`, `DELETE /auth/me` | JWT |
| `orders` | `POST /orders/razorpay-order`, `POST /orders`, `GET /orders/mine` | JWT |
| | `GET /orders/:id` | **public by design** (unguessable id, confirmation-link pattern) |
| `consults` | `POST /consults`, `GET /consults/mine`, `PATCH /consults/:id/cancel`, `/:id/reschedule` | JWT |
| | `GET /consults/partner`, `PATCH /consults/partner/:id/confirm`, `/partner/:id/reschedule` | `x-api-key` (`ApiKeyGuard`) |
| `contact` | `POST /contact` (emails support) | public |
| `newsletter` | `POST /newsletter/subscribe` | public |
| `health` | `GET /health` | public |

⚠️ **Mid-rebuild (LLD v1.4, since 2026-10-17):** the claim-order flow is gone, and `POST /orders`,
`POST /consults` and consult reschedule throw `NotImplemented` until the new endpoints land (see the
i do Dev Sync doc for the API contract). The schema is already v1.4 — migrations M13–M20.
| `users`, `mail`, `payments`, `sms` | no routes — internal services | — |

### Auth
Two kinds of account (one of email/phone always set, never both required). Both log in the same
passwordless way: send a 6-digit code, verify it, and the verify call creates the account on first
use (no password) or logs an existing one in.
- **Email OTP** (decided final 2026-10-21): `/auth/email/send-otp` → `/auth/email/verify-otp`, mail via
  SES (`src/mail`). Table `email_otps` (hashed code, `attempts`, `ip`). Valid 10 min; limits: 1 per
  30 s and 5 per hour per address, `OTP_IP_HOURLY_LIMIT` (default 20) per IP, all 429 `OTP_RATE_LIMIT`
  with `Retry-After`; 5 wrong guesses burn the code (401 `OTP_INVALID`). Addresses are lower-cased;
  lookups of existing users are case-insensitive. `main.ts` sets `trust proxy` to 1 so the IP limit
  sees the real client behind nginx (nginx must send `X-Forwarded-For`).
- The old email + password routes (`register`, `login`, `forgot-password`, `reset-password`,
  `verify-email`) and their tables/column (`password_hash`, `password_reset_tokens`,
  `email_verification_codes`) are **still in the schema, as the LLD keeps them**. Removing them
  needs a decision and a migration; do not drop them casually.
- **Phone OTP:** `/auth/phone/send-otp` → `/auth/phone/verify-otp`. Verify creates the
  account on first use (`passwordHash` null, `phoneVerifiedAt` set). Every login is a fresh OTP.
  (Phone does not yet have the rate limits / attempt cap the email flow has; that is week-2 work.)
  SMS via `src/sms/fast2sms.service.ts` (failures throw — the customer must know); a WhatsApp copy
  via `src/sms/whatsapp.service.ts` is best-effort and never blocks. Both currently reuse
  **Avataar's** DLT sender ID / templates (`AVTSKC`, `185443`, `otp9`) — needs i do's own before launch.
  Ported from the `Client` repo's own `sendSms`/`sendOtpOnWhatsapp` (DB-backed hashed/expiring codes
  here instead of Client's Redis — this service has no Redis and didn't need to add one). Two other
  WhatsApp-adjacent things in Client's real `.env` are **not** usable for this: `WHATSAPP_USERNAME`/
  `WHATSAPP_PASSWORD` is Basic Auth on an *inbound* webhook, nothing to do with sending; `WHATSAPP_BOT_API`/
  `WHATSAPP_BOT_TOKEN` (Blozum) is a real credentialed sender but every call site is commented-out dead
  code — don't port it without confirming a working template `flow` name on Blozum's own dashboard first.
  Confirmed via a real phone screenshot that the Messenger-gateway mechanism genuinely works in Client's
  production (a native Meta WhatsApp "Authentication" template, Copy Code button) — its credentials just
  live in that production server's own env config, not in the local `Client` checkout's `.env`.
- **Sessions** (LLD §9, TD-19): the access token is an **ES256** JWT (15 min; claims `iss`, `aud`, `sub`,
  `role`, header `kid`; no email or phone inside), signed with `AUTH_PRIVATE_KEY` and verified with
  `AUTH_PUBLIC_KEY` (PEM, `\n`-escaped on one line; see `.env.example`). There is **no** shared-secret
  fallback and the app refuses to start without both keys. The website gets HttpOnly cookies
  `ido_at` (Path=/, 15 min) and `ido_rt` (Path=/auth, 60 days), host-only, SameSite=Lax; the app
  (`X-Client: app`) gets the tokens in the response body and uses `Authorization: Bearer`.
  `POST /auth/refresh` rotates the refresh token inside its family (`refresh_tokens`, M14 schema);
  presenting an already-rotated token revokes the whole family (`revoked_reason = 'reuse'`).
  `POST /auth/logout` revokes the family and always returns 204. `JwtAuthGuard` requires
  `X-Requested-With: ido` on state-changing requests that use the cookie. Code: `cookies.ts`,
  `jwt-keys.ts`, `strategies/jwt.strategy.ts`, `jwt-auth.guard.ts`, `AuthService.issueSession/refreshSession`.
  Staff (`ido_ops_*` cookies, `aud=ops`, 12 h) are not built yet.
- Password-reset tokens, email OTPs and order-claim tokens are all stored **hashed**, single-use,
  expiring. Keep that pattern for any new token type.
- Missing email/phone on an account is backfilled from the first order/consult that supplies it —
  never overwritten once set.
- `DELETE /auth/me` anonymises orders (kept for accounting), hard-deletes consults, then the user.

### Orders & payments (Razorpay)
1. Frontend computes the total → `POST /orders/razorpay-order { amount }` creates a Razorpay order.
2. Checkout.js widget collects payment, returns `order_id | payment_id | signature`.
3. `POST /orders` with those three → `RazorpayService.verifySignature` (HMAC-SHA256 with the key
   secret, timing-safe) → row saved with `status: 'placed'`, confirmation email sent.
- COD skips 1–3 and adds `SITE.codFeeInPaise` (₹50) on the frontend.
- **All money is integer paise**, everywhere (DB, DTOs, Razorpay). Never introduce rupee floats.
- Order id format `IDO-XXXXXX`. Ring list price lives in the *frontend* (`lib/content/site.ts`, ₹14,999).
- `RazorpayService` builds its client lazily — blank keys must not crash boot (the SDK itself throws
  synchronously on an empty `key_id`, which would otherwise crash the whole app on startup).
- Import it as `import Razorpay = require('razorpay')`, not a default import — the package has no
  `esModuleInterop`-style default export and this project's tsconfig doesn't have that flag on; a
  default import compiles to a call on a nonexistent `.default`.
- Placing an order requires an account (decided 2026-09-30). `userId IS NULL` rows are legacy guest
  orders, recoverable via the claim-order email flow.
- `Order` shape is duplicated in `i_Do_Frontend/lib/orders-storage.ts` — change both together.

### Consults (derm / dietician)
Customer books a slot → `PENDING` lead. Ops in **partner-app-server** ("i do Consultations" tab)
pulls leads via the API-key endpoints, books a real doctor, calls `/partner/:id/confirm` →
`CONFIRMED` with `doctorName` / `meetingLink`. A customer reschedule of a confirmed session drops it
back to `PENDING`. `name/phone/email` are denormalised onto the row so ops never need a join.

## Database

Own Postgres database, separate from the ring app's `lume` database (no shared tables or users).
- **Test:** `ido_website_test` on the `lume-test` RDS instance (PG 18.3), logging in as `lume` (same
  login as lume-backend, by choice). **Prod (from 29 Oct):** `ido_website` on `ido-prod` RDS.
- RDS rejects unencrypted connections: set `DB_SSL=true` there (encrypts, doesn't yet verify the CA).
- `DB_SYNC=false` always — schema changes go through `src/migrations/`.
- Entities are listed once, in **`src/entities.ts`**, used by both `src/data-source.ts` (CLI) and
  `app.module.ts` (runtime) — add a new entity there.
- Migrations in the deployed image: `npm run migration:run:prod` / `migration:show:prod` (compiled
  `dist/data-source.js`). On ido-test they run automatically on every deploy.
- Code defaults fall back to `DB_NAME=lume`, `DB_PORT=5432` if `.env` is missing — always set `.env`.

## Env

See `.env.example`. Never commit `.env`. Notable: `PARTNER_APP_API_KEY` (partner-app-server sends
it as `x-api-key`), `RAZORPAY_KEY_ID/SECRET` (use `rzp_test_` keys), `AWS_SES_*` +
`MAIL_FROM_ADDRESS=support@idowellness.ai` (domain must be SES-verified), `FAST2SMS_*`,
`MESSENGER_*` (blank = WhatsApp copy skipped with a warning), `DB_SSL` (`true` on RDS).
Deployed env files live on the server (`/opt/ido/env/*.env`, `600`), never in git or CI.

## Hosting and deploys (live on test since 2026-10-19)

| | Test (now) | Prod (from 29 Oct) |
|---|---|---|
| Server | **ido-test** EC2 `i-050ce6ef001e22c54`, t4g.micro arm64, `3.108.140.58` | **ido-prod** (to be created) |
| This API | `https://test-api.idowellness.ai` | `https://api.idowellness.ai` (planned) |
| Website / ring app API | `test.` / `test-app-api.idowellness.ai` | `idowellness.ai` / `app-api.` (planned) |
| Database | `ido_website_test` on `lume-test` | `ido_website` on `ido-prod` RDS |
| Payments | Razorpay **test** keys | live keys at launch |

**Branches:** feature → PR into **`testing`** → deployed to ido-test automatically → PR `testing` →
`main` (prod). Never push straight to `main`.

**How a deploy works** (`.github/workflows/deploy-ido-test.yml`, on every push to `testing`):
GitHub builds the image on an arm64 runner → logs in to AWS by OIDC (role
`ido-github-actions-ecr-push`; no AWS keys in GitHub) → pushes ECR `ido/website-backend:<short sha>`
(immutable tags) → SSHes to ido-test with a CI-only key that is locked to `/opt/ido/deploy.sh` →
the script pulls the image (server IAM role `ido-test-ec2`), runs migrations, swaps the container,
waits for the HEALTHCHECK and **rolls back** to the previous image if it isn't healthy.
Logs: the repo's Actions tab, and `/opt/ido/deploy.log` on the server.

**Server layout** (`/opt/ido`, definitions in this repo under **`infra/ido-test/`**):
`docker-compose.yml` (services `website`, `backend`, `lume`; image per service from `/opt/ido/.env`)
· `deploy.sh` · `env/backend.env`, `env/lume.env` (secrets) · `src/` (read-only deploy-key clones).
nginx runs on the host (`/etc/nginx/conf.d/ido-test-*.conf`) with a Let's Encrypt certificate that
renews itself. Shared AWS context: `../CLAUDE.md`. AWS access from Claude is read-only.

## Known gaps (as of 2026-10-14)

- ⚠️ **Order amounts are trusted from the client.** `POST /orders` saves `subtotal/codFee/total/items[].price`
  as sent, and `/orders/razorpay-order` accepts any `amount ≥ 100`. Nothing re-prices the cart
  server-side or checks the Razorpay order's amount against the order total. Must be fixed before
  taking real money.
- ⚠️ **Phone OTP has no rate limit and no attempt cap.** `/auth/phone/send-otp` can be called
  unboundedly (SMS-pumping cost on Fast2SMS) and a 6-digit code can be guessed repeatedly until it
  expires. Needs `@nestjs/throttler` + a per-code attempt counter.
- The deployed compose file is `infra/ido-test/docker-compose.yml`; there is still no local-dev compose file.
- Port mismatch: `.env.example` uses 3011, `Dockerfile` EXPOSEs 3001, frontend `lib/api.ts` defaults
  to `http://localhost:3001`. Set `NEXT_PUBLIC_API_URL` explicitly.
- Order `status` beyond `placed` has no writer — no admin/fulfilment endpoint exists yet.
- Razorpay webhooks are not handled (a closed tab after payment = paid but no order row).
- No unit tests yet, and CI only builds + deploys (no test step). README is the Nest boilerplate.
