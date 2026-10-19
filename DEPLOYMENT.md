# Deployment checklist

This guide covers the current application scaffold. Payment and scheduled-earnings code must be tested end-to-end in provider sandbox and a non-production database before enabling VIP packages or processing real customer funds.

## 1. Configure Cloudflare D1

Create a D1 database named `treasure-minning-hub`, then copy its database ID into `wrangler.toml` (replace the placeholder ID). Apply the schema:

```bash
npx wrangler d1 execute treasure-minning-hub --remote --file=worker/schema.sql
```

The schema creates `auth_rate_limits`, used by registration/login throttling. If an older schema is already deployed, back up the database and apply a reviewed migration; rerunning the schema does not alter existing tables. Confirm the negative-wallet-debit trigger exists. Packages ship disabled and prices unset intentionally.

## 2. Deploy the Worker API

Install the project dependencies and Wrangler, authenticate to Cloudflare, then deploy:

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Set `APP_ORIGIN` to the exact HTTPS origin of the deployed frontend. Do not use a wildcard origin with credentialed cookies. The session cookie is Secure and will not work over plain HTTP in production.

## 3. Configure Kora payments

Set `KORA_SECRET_KEY` as a Cloudflare Worker secret (never put it in Vite variables or frontend code). Set `KORA_WEBHOOK_URL` to the public HTTPS URL ending in `/api/webhooks/korapay`. Optionally set `KORA_API_BASE` for the Kora sandbox API base while testing. Keep `APP_ORIGIN` set to the exact frontend origin. The frontend checkout button remains disabled until the selected package has a configured price and is enabled in D1.

Use Kora sandbox credentials first. Confirm the actual charge verification response shape in sandbox, duplicate webhook delivery, amount mismatch, wrong currency, failed payments, and delayed webhook handling before live use.

## 4. Configure Flutterwave sandbox

Set `FLW_SECRET_KEY` and `FLW_SECRET_HASH` as Cloudflare Worker secrets. Configure the provider webhook URL to the HTTPS Worker endpoint ending in `/api/webhooks/flutterwave`; the secret hash must match the provider dashboard. Never expose either secret through Vite variables or frontend code. Test success, failure, duplicate events, amount/currency mismatch, invalid signatures, and delayed webhooks before launch.

## 5. Deploy the frontend

Deploy the repository as a Vite app on Cloudflare Pages or another static host.

- Build command: `npm run build`
- Output directory: `dist`
- Node.js: 20 or newer

The frontend uses `/api` by default. Configure a same-origin reverse proxy for `/api/*` to the Worker, or define `VITE_API_BASE_URL` as the Worker API base URL and ensure `APP_ORIGIN` matches the exact frontend origin.

## 6. Verify

- Visit `/api/health` and confirm the API returns JSON with `ok: true`.
- Register a test account, sign out, sign back in, and verify dashboard access.
- Confirm a user cannot read another user's account or ledger by changing client-side data.
- Confirm the frontend build and Worker smoke tests pass in GitHub Actions.
- Test scheduled credits in a non-production database with duplicate cron runs and delayed execution.

## Production blockers

The scaffold includes authentication throttling, webhook signature checks, server-side payment verification, and idempotent activation scaffolding, but these flows have not been independently verified end-to-end against provider sandbox responses. Withdrawals/payouts, KYC and bank-account verification, admin operations, email verification, and password reset still require implementation and testing. Do not enable packages or process real funds until payment and earnings logic passes a documented sandbox and security test plan. Never activate a VIP package from a browser button or client-supplied payment status.
