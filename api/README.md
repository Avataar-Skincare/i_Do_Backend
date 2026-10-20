# i do website API — contract

`api/openapi.yaml` (OpenAPI 3.1) is the **agreed contract** between i_Do_Backend and the i do website / ops
dashboard. It follows LLD v1.4 FINAL §5 and the shipped schema (migrations M13–M20). Build the frontend against
it now using the mock server below.

**Changing it:** log the change in the Dev Sync doc → "API contract changes" first, then edit this file
in the same PR as the code. Never let the backend and this file drift.

## 1. View it

```bash
npx -y @redocly/cli preview-docs api/openapi.yaml          # live docs at http://127.0.0.1:8080
npx -y @redocly/cli build-docs api/openapi.yaml -o api.html # single static HTML file
npx -y @redocly/cli@1 lint api/openapi.yaml                 # must stay at 0 errors
```

## 2. Mock server

```bash
npx -y @stoplight/prism-cli mock -p 4010 api/openapi.yaml   # → http://127.0.0.1:4010
```

Point the website at it: `NEXT_PUBLIC_API_URL=http://127.0.0.1:4010 pnpm dev`.

- Every 2xx returns the example in the spec (realistic paise, `IDO-7K3Q9M2X4P` ids, Oct–Nov 2026 dates).
- Force an error state: `Prefer: code=409`. Pick a specific example: `Prefer: code=409, example=INVALID_TRANSITION`
  (error example names are the error `code`s). Pick a named success example: `Prefer: example=cod` (e.g. on /orders/quote).
- Prism checks **that** credentials are present, not that they're valid. Send any value:
  `Cookie: ido_at=mock` (customer), `Authorization: Bearer mock` (app), `Cookie: ido_ops_at=mock` (/admin/*),
  `x-api-key: mock` (partner). Missing → 401. Real cookies, expiry and refresh are **not** simulated.
- Prism validates requests: a missing required header (`X-Requested-With`, `Idempotency-Key`) or a bad body gives
  a 400 from the mock (the real API returns 403 `FORBIDDEN` for a missing `X-Requested-With`).
- `POST /orders` lists both 201 (created) and 200 (idempotent replay); Prism serves 200 unless you send `Prefer: code=201`.
- The mock is stateless: submitting a size won't change what `GET /orders/mine` returns.

## 3. Conventions

| Topic | Rule |
|---|---|
| Casing | JSON is camelCase (`us_size` → `usSize`, `size_due_at` → `sizeDueAt`). Enum values are exactly the DB CHECK values (`kit_delivered`, `ring_refused`, `PENDING` …). |
| Money | Every money field is an **integer number of paise** (₹14,999 = `1499900`, list ₹19,999 = `1999900`, COD fee `10000`). Names follow the LLD/entities: `Paise` suffix only where the LLD uses it (`pricePaise`, `listPricePaise`, `codFeePaise`, `refundPaise`, `kitPricePaise`, `codCollectedPaise`); order/refund/invoice columns keep their entity names (`total`, `codFee`, `amountPaid`, `amount`) and are paise too. The client never sends a price. |
| Dates | ISO-8601 with offset (`2026-11-14T23:59:59+05:30`); calendar dates `YYYY-MM-DD`. |
| Errors | Always `{statusCode, message, code}`. Branch on `code` (see `ErrorCode` in the spec); `message` may be a string or a string array (validation). |
| CSRF | Every POST/PUT/PATCH/DELETE sends `X-Requested-With: ido`. |
| Idempotency | `POST /orders` needs `Idempotency-Key: <uuid>`; generate one per checkout attempt and reuse it on retry ("Payment not completed. Try again"). |
| Website auth | HttpOnly cookies `ido_at` (15 min, Path=/) + `ido_rt` (60 d, Path=/auth) set by api.idowellness.ai. Use `fetch(..., {credentials: 'include'})`. On 401 call `POST /auth/refresh` once, then retry. |
| App auth | `Authorization: Bearer`; send `X-Client: app` on login/verify/refresh to get tokens in the body. |
| Ops auth | `/auth/admin/send-otp` + `/auth/admin/verify-otp` → cookies `ido_ops_at`/`ido_ops_rt` (aud=ops, 12 h). `/admin/*` accepts only these, from Origin https://ops.idowellness.ai. |
| Partner | `x-api-key` header (partner-app-server only). |
| Step-up | Before sending refund bank/UPI details (customer) or revealing them (ops): send an OTP to the user's own phone, then `POST /auth/step-up {code}`. A 401 `STEP_UP_REQUIRED` means do this and retry. |
| Pagination | Admin lists: `?page=1&pageSize=50` → `{items, page, pageSize, total}`. Customer lists are plain arrays. |
| Ownership | Orders, claims, consults are owner-only; anyone else gets 404. |
| Webhooks | `/webhooks/*` are `x-internal: true` — server-to-server only. |

## 4. Status cheat-sheet

**Order `status`** (what the customer sees):

| status | Customer copy |
|---|---|
| `pending_payment` | Never shown in Account → Orders. Checkout shows "Payment not completed. Try again" or "Confirming your payment…" (poll `GET /orders/{id}` ~12 min). |
| `cod_pending` | Order placed — our team will contact you to confirm your COD order. |
| `confirmed` | Confirmed — your sizing kit ships first. |
| `kit_shipped` | Sizing kit on its way (AWB link; COD: keep ₹15,099 ready). |
| `kit_delivered` | Submit your size by `sizeDueAt` (still accepted after). |
| `size_submitted` | Size US N locked — your ring ships next. |
| `ring_shipped` | Ring on its way. If the ring shipment is `rto`: "Your ring is on its way back to us". |
| `ring_delivered` | Delivered — book your 2 consults (`consultWindow`); report damage until `damageWindowUntil`. |
| `cancelled` | Show `cancelReason` + `refund` if any. |

**`cancelReason`**: `unpaid` (24 h, never paid) · `cod_unconfirmed` (COD refused / 2 failed calls) · `customer` ·
`kit_rto` (kit returned undelivered) · `ring_refused` (refused ring received back) · `admin`.

**Shipment** `pending → shipped → delivered`, or `rto` (`rtoReason` refused|undeliverable) / `lost`; `returnedAt` +
`returnCondition` sealed|damaged once an RTO parcel is back. `attempt` 1 or 2.

**Refund** `requested → processing → paid`, or `rejected`. `method` razorpay|bank|upi. `destinationRequired=true` →
show the UPI/bank form (`PUT /orders/{id}/refund-destination`). Every refund gets a credit note.

**Cancel preview `refundRoute`**: `razorpay` · `bank_or_upi` (ask for details + step-up) · `none` · `rto_first`.

**Claim** `draft → submitted → approved → replaced`, or `rejected`. Kinds damaged|wrong_item (7 days) | warranty_defect (12 months).

**Consult** `PENDING → CONFIRMED → COMPLETED`, or `CANCELLED`. Entitlement state (derived): `available | booked | used | expired`.

## 5. Removed endpoints

| Removed | Use instead |
|---|---|
| `GET/POST /auth/claim-order` | Nothing — guest-order claiming is gone (orders need an account). Remove `/claim-order`. |
| `POST /orders/razorpay-order` | `POST /orders` returns `razorpay: {id, amount, currency, keyId}` for online orders. |
| Old `POST /orders` body (`items`, `subtotal`, `codFee`, `total`, `razorpay*`) | New body `{finish, paymentMethod, customer, address, buyerGstin?, buyerLegalName?, offerCode?}`; payment proof goes to `POST /orders/{id}/payment/verify`. |
| `dayLabel` on consult create/reschedule | `date: 'YYYY-MM-DD'` + `timeSlot`. |

Also changed: `GET /orders/{id}` is now **owner-only** (was public).
Kept although not listed in LLD §5: `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`.

## 6. Decisions on points the LLD left open (v1.0.0, 20 Oct)

Marked `x-decision` in the spec. Points 1–3 affect the website/app; 4–6 are backend-only.

1. **App/ops token transport** — the app sends `X-Client: app` and gets tokens in the response body (`refreshToken` goes back in the body to `/auth/refresh`); staff refresh/logout use the shared `/auth/refresh` + `/auth/logout` with `ido_ops_rt`.
2. **Step-up OTP** — sent with the normal send-otp route (`/auth/phone/send-otp`; staff `/auth/admin/send-otp`), then `POST /auth/step-up`; the step-up lasts **15 min** (TD-20).
3. **Cancel during `kit_shipped`** — response `outcome: rto_requested`; the order stays `kit_shipped` until the kit is back.
4. **COD refused-ring refund before details** — branch on `destinationRequired`; backend makes `refunds.method` nullable (migration M21).
5. **Damaged return** — ops approve/reject via an admin refund action added with the refunds work (week 2).
6. **Partner complete note** — stored in a new `consults.note` column (migration M21).

Error codes this contract adds for rules the LLD states without naming a code: `OTP_INVALID`, `EMAIL_IN_USE`,
`CONSENT_REQUIRED` (consult booking without health consent, §9), `SETTING_READ_ONLY`; plus generic
`VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`.
