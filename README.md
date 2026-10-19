# Treasure Minning Hub

A React + Vite dashboard with a Cloudflare Worker API and Cloudflare D1 schema for secure accounts, VIP package records, wallet ledger history, and scheduled daily earnings.

## What's included

- Responsive dashboard and sign-in / registration screens.
- Password hashing with PBKDF2-SHA-256; passwords are never stored in plaintext.
- Random, server-issued session tokens stored as SHA-256 hashes in D1 and sent using a Secure, HttpOnly cookie.
- D1 schema for users, sessions, VIP packages, verified payment events, package activations, and wallet ledger.
- Hourly Worker Cron Trigger. Earnings become due only after a full 24 hours based on server/database timestamps.
- A unique ledger key per activation/earning period and a database trigger that updates the cached wallet balance only when a new ledger row is inserted.
- VIP daily earning defaults: VIP 1 ₦200, VIP 2 ₦450, VIP 3 ₦1,200, VIP 4 ₦2,200, VIP 5 ₦8,400, VIP 6 ₦14,500.

## Important activation and payment boundary

Package prices are intentionally unset and all packages are disabled in the seed data. Do not enable packages or accept money until the owner has set the real prices and connected a payment provider's server-side verification/webhook. A browser redirect or client-supplied “paid” flag must never activate a package. The schema reserves unique payment references for provider verification; a provider-specific signed webhook and atomic activation flow still needs to be implemented before live use.

This repository does not currently integrate a payment gateway, withdrawals, identity/KYC verification, admin controls, or an existing production wallet. Do not use it to handle real customer funds until those parts are implemented, reviewed, and tested.

## Run the frontend

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
npm run build
```

The frontend expects the API at `/api` by default. For a separately hosted Worker, set `VITE_API_BASE_URL` to the Worker API base URL and set the Worker `APP_ORIGIN` to the exact frontend origin. The frontend and API must use HTTPS in production because the session cookie is Secure.

## Cloudflare D1 and Worker setup

1. Create a Cloudflare D1 database named `treasure-minning-hub`.
2. Replace `REPLACE_WITH_YOUR_CLOUDFLARE_D1_DATABASE_ID` in `wrangler.toml` with the actual D1 database ID.
3. Apply the schema: `npx wrangler d1 execute treasure-minning-hub --remote --file=worker/schema.sql`.
4. Set `APP_ORIGIN` to the exact production frontend origin. For local development, add your local origin as a comma-separated entry only while needed.
5. Deploy the Worker: `npx wrangler deploy`.
6. Configure the frontend hosting provider to proxy `/api/*` to the Worker, or set `VITE_API_BASE_URL` to the Worker URL and configure CORS accordingly.

## Before production

- Implement and test a payment-provider webhook with signature verification, amount/currency/reference checks, replay protection, and atomic package activation.
- Configure real VIP prices and an explicit expiry policy before enabling packages.
- Add rate limiting and abuse monitoring to authentication endpoints, email verification, password reset, and appropriate account recovery.
- Test scheduled earnings under duplicate/overlapping cron executions and late runs. The scheduler currently credits at most one overdue 24-hour period per activation per hourly run; prolonged outages therefore catch up gradually. Review this policy and expiry behavior before enabling packages.
- Implement withdrawals only with server-side payout verification, idempotency, KYC/policy checks where applicable, and atomic balance reservation.
- Review privacy, legal, consumer-protection, and financial compliance requirements for your operating region.

## API routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/health`

The API deliberately does not expose a public route to activate a package or credit a wallet. Those operations must be driven by trusted server-side payment verification and the scheduled Worker.
