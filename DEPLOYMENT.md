# Deployment checklist

This is a deployment guide for the initial application scaffold. Do not enable VIP packages or process customer funds until the payment activation flow and all production controls are implemented.

## 1. Configure Cloudflare D1

Create a D1 database named `treasure-minning-hub`, then copy its database ID into `wrangler.toml`. Apply the schema:

```bash
npx wrangler d1 execute treasure-minning-hub --remote --file=worker/schema.sql
```

Review the seed values and set real package prices only after the owner has confirmed the commercial terms. Packages ship disabled intentionally.

## 2. Deploy the Worker API

Install the project dependencies and Wrangler, authenticate to Cloudflare, then deploy:

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Set `APP_ORIGIN` to the exact HTTPS origin of the deployed frontend. Do not use a wildcard origin with credentialed cookies. The session cookie is Secure and will not work over plain HTTP in production.

## 3. Configure Kora payments\n\nSet `KORA_SECRET_KEY` as a Cloudflare Worker secret (never put it in Vite variables or frontend code). Set `KORA_WEBHOOK_URL` to the public HTTPS URL ending in `/api/webhooks/korapay`. Optionally set `KORA_API_BASE` for the Kora sandbox API base while testing. Keep `APP_ORIGIN` set to the exact frontend origin. The frontend checkout button remains disabled until the selected package has a configured price and is enabled in D1.\n\nUse Kora sandbox credentials first. Confirm the actual charge verification response shape in sandbox, duplicate webhook delivery, amount mismatch, wrong currency, failed payments, and delayed webhook handling before live use.\n\n## 4. Deploy the frontend

Deploy the repository as a Vite app on Cloudflare Pages or another static host.

- Build command: `npm run build`
- Output directory: `dist`
- Node.js: 20 or newer

The frontend uses `/api` by default. Configure a same-origin reverse proxy for `/api/*` to the Worker, or define `VITE_API_BASE_URL` as the Worker API base URL and ensure `APP_ORIGIN` matches the exact frontend origin.

## 5. Verify

- Visit `/api/health` and confirm the API returns JSON with `ok: true`.
- Register a test account, sign out, sign back in, and verify dashboard access.
- Confirm a user cannot read another user's account or ledger by changing client-side data.
- Confirm the frontend build and Worker smoke tests pass in GitHub Actions.
- Test scheduled credits in a non-production database with duplicate cron runs and delayed execution.

## Production blockers

The current scaffold does not include a payment provider's signed webhook, server-side payment verification, atomic paid-package activation, withdrawal/payout processing, KYC, admin operations, rate limiting, email verification, or password reset. These are not optional if the application will accept deposits or facilitate withdrawals. Never activate a VIP package from a browser button or a client-supplied payment status.
