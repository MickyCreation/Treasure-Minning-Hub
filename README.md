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

Package prices are intentionally unset and all packages are disabled in the seed data. Do not enable packages or accept money until the owner has set the real prices and connected a payment provider's server-side verification/webhook. A browser redirect or client-supplied “paid” flag must never activate a package. A Kora checkout initializer and signed webhook flow are scaffolded. The webhook verifies the HMAC signature, queries Kora's transaction API, checks amount/currency/reference, then activates the package through idempotent D1 writes. Configure and test this in Kora sandbox first; do not enable packages until prices, webhook URL, secret binding, expiry policy, and the full payment lifecycle have been reviewed.

This repository now includes a Kora pay-in checkout/webhook scaffold, but does not include withdrawals/payouts, identity/KYC verification, admin controls, email verification, or password recovery. Do not use it to handle real customer funds until those parts are implemented, reviewed, and tested.

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

- Configure Kora secret as a Cloudflare Worker secret, set the public webhook URL to `/api/webhooks/korapay`, and test checkout + webhook verification in sandbox. Review amount/currency/reference checks and idempotent activation before enabling packages.
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
- `POST /api/vip/checkout` (authenticated; only enabled and priced packages)
- `POST /api/webhooks/korapay` (public endpoint; HMAC and server-side transaction verification)
- `GET /api/health`

The API deliberately does not expose a public route to activate a package or credit a wallet. Those operations must be driven by trusted server-side payment verification and the scheduled Worker.


## Vercel preview deployment

The repository includes `vercel.json` to use Vite's `dist` output and send client-side dashboard routes to `index.html` while leaving `/api/*` requests untouched. Import this repository into Vercel with the root directory set to `./`, framework preset `Vite`, build command `npm run build`, and output directory `dist`.

For a preview of the feature work, select the Git branch `feature/automatic-vip-earnings` when deploying, or open the pull request and inspect its Vercel preview check. A deployment from `main` will not include commits that exist only on the feature branch. If Vercel's deployment says Ready but shows a 404, verify the deployed commit and branch before troubleshooting the app itself.

The Vercel static frontend does not host the Cloudflare Worker API. Before testing registration, login, dashboard data, or checkout, set the Vercel environment variable `VITE_API_BASE_URL` to the deployed HTTPS Cloudflare Worker API base URL (ending in the worker origin, without an extra `/api` if the frontend's default route prefix is being used; set it to the API prefix such as `https://your-worker.example.workers.dev/api` when using the current frontend routes). Configure the Worker `APP_ORIGIN` to the exact Vercel preview origin. Preview environments must use sandbox payment credentials only. Never enable VIP packages or real payouts until the payment lifecycle has been tested end-to-end.
