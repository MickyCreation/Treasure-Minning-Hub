const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 310000;
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
function cleanEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function randomHex(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(value) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, material, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function authRateLimited(request, env, scope, limit = 10, windowSeconds = 900) {
  // Hash the client IP before storage; never persist raw IP addresses in the rate-limit table.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown-client';
  const key = await sha256(`${scope}:${ip}`);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT INTO auth_rate_limits (bucket_key,window_started_at,attempt_count,updated_at)
    VALUES (?,?,1,?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      attempt_count=CASE WHEN auth_rate_limits.window_started_at<=? THEN 1 ELSE auth_rate_limits.attempt_count+1 END,
      window_started_at=CASE WHEN auth_rate_limits.window_started_at<=? THEN excluded.window_started_at ELSE auth_rate_limits.window_started_at END,
      updated_at=excluded.updated_at`)
    .bind(key, now, now, now-windowSeconds, now-windowSeconds).run();
  const row = await env.DB.prepare('SELECT attempt_count FROM auth_rate_limits WHERE bucket_key=?').bind(key).first();
  return Number(row?.attempt_count || 0) > limit;
}
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function cookieValue(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}
function cookieHeader(value, maxAge) {
  return `__Host-tmh_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  const configured = (env.APP_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  return configured.includes(origin);
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const configured = (env.APP_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  if (origin && configured.includes(origin)) {
    return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
  }
  return {};
}
function errorMessage(error) {
  return error instanceof Error ? error.message : 'Unexpected server error';
}
async function authenticate(request, env) {
  const token = cookieValue(request, '__Host-tmh_session');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    'SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?'
  ).bind(tokenHash, new Date().toISOString()).first();
  return row || null;
}
function assertSameOrigin(request, env) {
  if (!allowedOrigin(request, env)) throw new Error('Origin not allowed.');
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (origin && env.APP_ORIGIN && !env.APP_ORIGIN.split(',').map(x => x.trim()).includes(origin)) throw new Error('Origin not allowed.');
  if (fetchSite === 'cross-site') throw new Error('Cross-site requests are not allowed.');
}
function naira(kobo) { return Number(kobo || 0) / 100; }

function isAdminUser(user, env) {
  // Use immutable account IDs, not email addresses: registration has no email-verification flow yet.
  const allowed = (env.ADMIN_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  return Boolean(user?.id && allowed.includes(user.id));
}
async function dashboard(user, env) {
  const [account, packages, activations, ledger, total] = await Promise.all([
    env.DB.prepare('SELECT balance_kobo FROM users WHERE id=?').bind(user.id).first(),
    env.DB.prepare('SELECT id,level,name,daily_earning_kobo,price_kobo,enabled FROM vip_packages ORDER BY level').all(),
    env.DB.prepare(`SELECT a.id,a.package_id,p.name AS package_name,p.daily_earning_kobo,a.activated_at,a.last_credited_at,a.expires_at,a.status
      FROM user_vip_packages a JOIN vip_packages p ON p.id=a.package_id
      WHERE a.user_id=? AND a.status='active' ORDER BY a.activated_at DESC`).bind(user.id).all(),
    env.DB.prepare(`SELECT id,entry_type,amount_kobo,reference,description,created_at FROM wallet_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 20`).bind(user.id).all(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount_kobo),0) AS total FROM wallet_ledger WHERE user_id=? AND entry_type='vip_earning' AND amount_kobo>0`).bind(user.id).first(),
  ]);
  return {
    balance: naira(account?.balance_kobo),
    totalEarned: naira(total?.total),
    packages: (packages.results || []).map(p => ({
      id: p.id, level: p.level, name: p.name, dailyEarning: naira(p.daily_earning_kobo),
      priceConfigured: p.price_kobo !== null, price: p.price_kobo === null ? null : naira(p.price_kobo),
      active: (activations.results || []).some(a => Number(a.package_id) === p.id), enabled: !!p.enabled,
    })),
    activations: (activations.results || []).map(a => {
      const next = new Date(new Date(a.last_credited_at).getTime() + 24 * 60 * 60 * 1000);
      return { id: a.id, packageName: a.package_name, dailyEarning: naira(a.daily_earning_kobo), activatedAt: a.activated_at, nextCreditAt: next.toISOString(), status: a.status };
    }),
    ledger: (ledger.results || []).map(l => ({
      id: l.id, type: l.entry_type, amount: naira(l.amount_kobo), reference: l.reference,
      description: l.description, createdAt: l.created_at,
    })),
  };
}
async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function createKoraCheckout(user, packageId, env) {
  if (!env.KORA_SECRET_KEY || !env.KORA_WEBHOOK_URL) {
    return json({ error: 'Payments are not configured yet. Please try again later.' }, 503);
  }
  const pkg = await env.DB.prepare(
    'SELECT id,level,name,price_kobo,enabled FROM vip_packages WHERE id=?'
  ).bind(packageId).first();
  if (!pkg || !pkg.enabled || !Number.isInteger(pkg.price_kobo) || pkg.price_kobo <= 0) {
    return json({ error: 'This VIP package is not available for purchase yet.' }, 409);
  }
  const reference = `TMH-${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO payment_orders
    (reference,user_id,package_id,amount_kobo,currency,status,created_at,updated_at)
    VALUES (?,?,?,?,'NGN','pending',?,?)`)
    .bind(reference, user.id, pkg.id, pkg.price_kobo, now, now).run();

  const base = (env.KORA_API_BASE || 'https://api.korapay.com/merchant').replace(/\/+$/, '');
  let response;
  try {
    response = await fetch(`${base}/api/v1/charges/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.KORA_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: pkg.price_kobo / 100,
        currency: 'NGN',
        reference,
        narration: `Purchase ${pkg.name} - Treasure Minning Hub`,
        customer: { name: user.name, email: user.email },
        redirect_url: `${(env.APP_ORIGIN || '').split(',')[0].trim()}/?payment=complete`,
        notification_url: env.KORA_WEBHOOK_URL,
        merchant_bears_cost: false,
        metadata: { package_id: String(pkg.id), user_id: user.id },
      }),
    });
  } catch {
    await env.DB.prepare("UPDATE payment_orders SET status='failed',updated_at=? WHERE reference=? AND status='pending'")
      .bind(new Date().toISOString(), reference).run();
    return json({ error: 'Could not contact the payment provider. Please try again.' }, 502);
  }
  const payload = await response.json().catch(() => ({}));
  const checkoutUrl = payload?.data?.checkout_url;
  if (!response.ok || !(payload?.status === true || payload?.status === 'true') || typeof checkoutUrl !== 'string' ||
      !checkoutUrl.startsWith('https://checkout.korapay.com/')) {
    await env.DB.prepare("UPDATE payment_orders SET status='failed',updated_at=? WHERE reference=? AND status='pending'")
      .bind(new Date().toISOString(), reference).run();
    console.error('Kora checkout initialization failed', response.status);
    return json({ error: 'Payment checkout could not be created. Please try again.' }, 502);
  }
  await env.DB.prepare('UPDATE payment_orders SET checkout_url=?,updated_at=? WHERE reference=? AND status=\'pending\'')
    .bind(checkoutUrl, new Date().toISOString(), reference).run();
  return json({ checkoutUrl, reference });
}
async function handleKoraWebhook(request, env) {
  if (!env.KORA_SECRET_KEY) return json({ error: 'Webhook is not configured.' }, 503);
  const raw = await request.text();
  if (raw.length > 128 * 1024) return json({ error: 'Payload too large.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!body || typeof body.data !== 'object' || !body.data) return json({ error: 'Invalid webhook payload.' }, 400);
  const received = request.headers.get('x-korapay-signature') || '';
  const expected = await hmacSha256Hex(env.KORA_SECRET_KEY, JSON.stringify(body.data));
  if (!constantTimeEqual(received.toLowerCase(), expected)) return json({ error: 'Invalid webhook signature.' }, 401);

  const eventType = typeof body.event === 'string' ? body.event : body.event?.type;
  if (eventType !== 'charge.success' || String(body.data.status || '').toLowerCase() !== 'success') {
    return json({ ok: true, ignored: true });
  }
  const reference = body.data.reference || body.data.payment_reference;
  if (typeof reference !== 'string' || reference.length < 8 || reference.length > 160) {
    return json({ error: 'Invalid payment reference.' }, 400);
  }

  const order = await env.DB.prepare(
    'SELECT reference,user_id,package_id,amount_kobo,currency,status FROM payment_orders WHERE reference=?'
  ).bind(reference).first();
  if (!order) return json({ error: 'Unknown payment reference.' }, 404);
  if (order.status === 'processed') return json({ ok: true, duplicate: true });
  if (order.status !== 'pending') return json({ error: 'Payment order is not pending.' }, 409);

  // Verify with Kora's server API as well as the signed webhook; never trust the redirect or payload alone.
  const base = (env.KORA_API_BASE || 'https://api.korapay.com/merchant').replace(/\/+$/, '');
  const verificationResponse = await fetch(`${base}/api/v1/charges/${encodeURIComponent(reference)}`, {
    headers: { 'Authorization': `Bearer ${env.KORA_SECRET_KEY}`, 'Accept': 'application/json' },
  });
  const verification = await verificationResponse.json().catch(() => ({}));
  const tx = verification?.data;
  if (!verificationResponse.ok || !(verification?.status === true || verification?.status === 'true') || !tx ||
      String(tx.status || '').toLowerCase() !== 'success' ||
      String(tx.currency || '').toUpperCase() !== order.currency ||
      Math.round(Number(tx.amount) * 100) !== order.amount_kobo ||
      (tx.reference || tx.payment_reference) !== order.reference) {
    console.error('Kora transaction verification did not match order', reference, verificationResponse.status);
    return json({ error: 'Payment verification did not match the order.' }, 409);
  }

  const now = new Date().toISOString();
  const activationId = crypto.randomUUID();
  const periodNumber = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  // All three writes are committed together. The payment reference and activation uniqueness
  // constraints make repeated Kora webhook deliveries idempotent.
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO payment_events
      (provider,provider_reference,user_id,package_id,amount_kobo,status,created_at)
      SELECT 'korapay',?,?,?,?,'verified',?
      WHERE EXISTS (SELECT 1 FROM payment_orders WHERE reference=? AND status='pending')`)
      .bind(order.reference, order.user_id, order.package_id, order.amount_kobo, now, order.reference),
    env.DB.prepare(`INSERT OR IGNORE INTO user_vip_packages
      (id,user_id,package_id,payment_provider,payment_reference,status,activated_at,last_credited_at,expires_at)
      SELECT ?,?,?, 'korapay',?,'active',?,?,NULL
      WHERE EXISTS (SELECT 1 FROM payment_events WHERE provider='korapay' AND provider_reference=? AND status='verified')
        AND EXISTS (SELECT 1 FROM vip_packages WHERE id=? AND enabled=1 AND price_kobo=?)
        AND EXISTS (SELECT 1 FROM payment_orders WHERE reference=? AND status='pending')`)
      .bind(activationId, order.user_id, order.package_id, order.reference, now, now,
        order.reference, order.package_id, order.amount_kobo, order.reference),
    env.DB.prepare(`UPDATE payment_events SET status='processed'
      WHERE provider='korapay' AND provider_reference=?
        AND EXISTS (SELECT 1 FROM user_vip_packages WHERE payment_provider='korapay' AND payment_reference=?)`)
      .bind(order.reference, order.reference),
    env.DB.prepare(`UPDATE payment_orders SET status='processed',updated_at=?
      WHERE reference=? AND status='pending'
        AND EXISTS (SELECT 1 FROM user_vip_packages WHERE payment_provider='korapay' AND payment_reference=?)`)
      .bind(now, order.reference, order.reference),
  ]);
  const finalOrder = await env.DB.prepare('SELECT status FROM payment_orders WHERE reference=?').bind(order.reference).first();
  if (finalOrder?.status !== 'processed') return json({ error: 'Payment could not be activated. Please retry webhook delivery.' }, 500);
  return json({ ok: true });
}

async function createFlutterwaveCheckout(user, packageId, env) {
  if (!env.FLW_SECRET_KEY || !env.FLW_SECRET_HASH) {
    return json({ error: 'Flutterwave is not configured yet. Please try again later.' }, 503);
  }
  const pkg = await env.DB.prepare(
    'SELECT id,level,name,price_kobo,enabled FROM vip_packages WHERE id=?'
  ).bind(packageId).first();
  if (!pkg || !pkg.enabled || !Number.isInteger(pkg.price_kobo) || pkg.price_kobo <= 0) {
    return json({ error: 'This VIP package is not available for purchase yet.' }, 409);
  }
  const reference = `FLW-${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO payment_orders
    (reference,user_id,package_id,amount_kobo,currency,status,created_at,updated_at)
    VALUES (?,?,?,?,'NGN','pending',?,?)`)
    .bind(reference, user.id, pkg.id, pkg.price_kobo, now, now).run();
  const origin = (env.APP_ORIGIN || '').split(',')[0].trim();
  if (!origin.startsWith('https://')) {
    await env.DB.prepare("UPDATE payment_orders SET status='failed',updated_at=? WHERE reference=? AND status='pending'")
      .bind(new Date().toISOString(), reference).run();
    return json({ error: 'A secure HTTPS application URL is required for checkout.' }, 503);
  }
  let response;
  try {
    response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_ref: reference,
        amount: (pkg.price_kobo / 100).toFixed(2),
        currency: 'NGN',
        redirect_url: `${origin}/?payment=complete&provider=flutterwave`,
        customer: { email: user.email, name: user.name },
        customizations: { title: 'Treasure Minning Hub', description: `Purchase ${pkg.name}` },
        meta: { package_id: String(pkg.id), user_id: user.id },
      }),
    });
  } catch {
    await env.DB.prepare("UPDATE payment_orders SET status='failed',updated_at=? WHERE reference=? AND status='pending'")
      .bind(new Date().toISOString(), reference).run();
    return json({ error: 'Could not contact Flutterwave. Please try again.' }, 502);
  }
  const payload = await response.json().catch(() => ({}));
  const checkoutUrl = payload?.data?.link;
  if (!response.ok || payload?.status !== 'success' || typeof checkoutUrl !== 'string' ||
      !checkoutUrl.startsWith('https://checkout.flutterwave.com/')) {
    await env.DB.prepare("UPDATE payment_orders SET status='failed',updated_at=? WHERE reference=? AND status='pending'")
      .bind(new Date().toISOString(), reference).run();
    console.error('Flutterwave checkout initialization failed', response.status);
    return json({ error: 'Flutterwave checkout could not be created. Please try again.' }, 502);
  }
  await env.DB.prepare("UPDATE payment_orders SET checkout_url=?,updated_at=? WHERE reference=? AND status='pending'")
    .bind(checkoutUrl, new Date().toISOString(), reference).run();
  return json({ checkoutUrl, reference, provider: 'flutterwave' });
}

async function handleFlutterwaveWebhook(request, env) {
  if (!env.FLW_SECRET_KEY || !env.FLW_SECRET_HASH) return json({ error: 'Flutterwave webhook is not configured.' }, 503);
  const signature = request.headers.get('verif-hash') || '';
  if (!constantTimeEqual(signature, env.FLW_SECRET_HASH)) return json({ error: 'Invalid Flutterwave webhook signature.' }, 401);
  const raw = await request.text();
  if (raw.length > 128 * 1024) return json({ error: 'Payload too large.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const event = body?.event;
  const data = body?.data;
  if (!data || typeof data !== 'object') return json({ error: 'Invalid webhook payload.' }, 400);
  if (event !== 'charge.completed' || String(data.status || '').toLowerCase() !== 'successful') {
    return json({ ok: true, ignored: true });
  }
  const reference = data.tx_ref;
  const transactionId = data.id;
  if (typeof reference !== 'string' || !reference.startsWith('FLW-') || !transactionId) {
    return json({ error: 'Invalid Flutterwave transaction reference.' }, 400);
  }
  const order = await env.DB.prepare(
    'SELECT reference,user_id,package_id,amount_kobo,currency,status FROM payment_orders WHERE reference=?'
  ).bind(reference).first();
  if (!order) return json({ error: 'Unknown payment reference.' }, 404);
  if (order.status === 'processed') return json({ ok: true, duplicate: true });
  if (order.status !== 'pending') return json({ error: 'Payment order is not pending.' }, 409);

  let verifyResponse;
  try {
    verifyResponse = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(transactionId))}/verify`, {
      headers: { 'Authorization': `Bearer ${env.FLW_SECRET_KEY}`, 'Accept': 'application/json' },
    });
  } catch {
    return json({ error: 'Flutterwave verification is temporarily unavailable.' }, 502);
  }
  const verified = await verifyResponse.json().catch(() => ({}));
  const tx = verified?.data;
  const amountKobo = Math.round(Number(tx?.amount) * 100);
  if (!verifyResponse.ok || verified?.status !== 'success' || !tx ||
      String(tx.status || '').toLowerCase() !== 'successful' ||
      String(tx.tx_ref || '') !== order.reference ||
      String(tx.currency || '').toUpperCase() !== order.currency ||
      !Number.isFinite(amountKobo) || amountKobo !== order.amount_kobo) {
    console.error('Flutterwave transaction verification did not match order', reference, verifyResponse.status);
    return json({ error: 'Flutterwave payment verification did not match the order.' }, 409);
  }

  const now = new Date().toISOString();
  const activationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO payment_events
      (provider,provider_reference,user_id,package_id,amount_kobo,status,created_at)
      SELECT 'flutterwave',?,?,?,?,'verified',?
      WHERE EXISTS (SELECT 1 FROM payment_orders WHERE reference=? AND status='pending')`)
      .bind(order.reference, order.user_id, order.package_id, order.amount_kobo, now, order.reference),
    env.DB.prepare(`INSERT OR IGNORE INTO user_vip_packages
      (id,user_id,package_id,payment_provider,payment_reference,status,activated_at,last_credited_at,expires_at)
      SELECT ?,?,?, 'flutterwave',?,'active',?,?,NULL
      WHERE EXISTS (SELECT 1 FROM payment_events WHERE provider='flutterwave' AND provider_reference=? AND status='verified')
        AND EXISTS (SELECT 1 FROM vip_packages WHERE id=? AND enabled=1 AND price_kobo=?)
        AND EXISTS (SELECT 1 FROM payment_orders WHERE reference=? AND status='pending')`)
      .bind(activationId, order.user_id, order.package_id, order.reference, now, now,
        order.reference, order.package_id, order.amount_kobo, order.reference),
    env.DB.prepare(`UPDATE payment_events SET status='processed'
      WHERE provider='flutterwave' AND provider_reference=?
        AND EXISTS (SELECT 1 FROM user_vip_packages WHERE payment_provider='flutterwave' AND payment_reference=?)`)
      .bind(order.reference, order.reference),
    env.DB.prepare(`UPDATE payment_orders SET status='processed',updated_at=?
      WHERE reference=? AND status='pending'
        AND EXISTS (SELECT 1 FROM user_vip_packages WHERE payment_provider='flutterwave' AND payment_reference=?)`)
      .bind(now, order.reference, order.reference),
  ]);
  const finalOrder = await env.DB.prepare('SELECT status FROM payment_orders WHERE reference=?').bind(order.reference).first();
  if (finalOrder?.status !== 'processed') return json({ error: 'Payment could not be activated. Please retry webhook delivery.' }, 500);
  return json({ ok: true });
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (path.startsWith('/api/') && !allowedOrigin(request, env)) return json({ error: 'Origin not allowed.' }, 403);

  if (path === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'Treasure Minning Hub API' });

  if (path === '/api/webhooks/korapay' && request.method === 'POST') return handleKoraWebhook(request, env);
  if (path === '/api/webhooks/flutterwave' && request.method === 'POST') return handleFlutterwaveWebhook(request, env);

  if (path === '/api/auth/register' && request.method === 'POST') {
    assertSameOrigin(request, env);
    if (await authRateLimited(request, env, 'register', 5)) return json({ error: 'Too many registration attempts. Please wait 15 minutes and try again.' }, 429);
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = cleanEmail(body?.email);
    const password = body?.password;
    if (name.length < 2 || name.length > 80) return json({ error: 'Enter a name between 2 and 80 characters.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Enter a valid email address.' }, 400);
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) return json({ error: 'Password must be between 10 and 128 characters.' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
    if (existing) return json({ error: 'Unable to create account with those details. Try signing in instead.' }, 409);
    const id = crypto.randomUUID();
    const salt = randomHex(16);
    const hash = await passwordHash(password, salt);
    try {
      await env.DB.prepare('INSERT INTO users (id,name,email,password_hash,password_salt) VALUES (?,?,?,?,?)').bind(id, name, email, hash, salt).run();
    } catch {
      return json({ error: 'Unable to create account with those details. Try signing in instead.' }, 409);
    }
    const token = randomHex(32);
    const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(token), id, expires).run();
    return json({ user: { id, name, email, isAdmin: isAdminUser({ email }, env) } }, 201, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_SECONDS) });
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    assertSameOrigin(request, env);
    if (await authRateLimited(request, env, 'login', 10)) return json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }, 429);
    const body = await request.json().catch(() => null);
    const email = cleanEmail(body?.email);
    const password = body?.password;
    if (!email || typeof password !== 'string' || password.length > 128) return json({ error: 'Email or password is incorrect.' }, 401);
    const row = await env.DB.prepare('SELECT id,name,email,password_hash,password_salt FROM users WHERE email=?').bind(email).first();
    if (!row) return json({ error: 'Email or password is incorrect.' }, 401);
    const hash = await passwordHash(password, row.password_salt);
    if (!constantTimeEqual(hash, row.password_hash)) return json({ error: 'Email or password is incorrect.' }, 401);
    const token = randomHex(32);
    const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND expires_at<=?').bind(row.id, new Date().toISOString()).run();
    await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(token), row.id, expires).run();
    return json({ user: { id: row.id, name: row.name, email: row.email, isAdmin: isAdminUser(row, env) } }, 200, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_SECONDS) });
  }

  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Not signed in.' }, 401);
    return json({ user: { ...user, isAdmin: isAdminUser(user, env) } });
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    assertSameOrigin(request, env);
    const token = cookieValue(request, '__Host-tmh_session');
    if (token && /^[a-f0-9]{64}$/.test(token)) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) });
  }

  if (path === '/api/vip/checkout' && request.method === 'POST') {
    assertSameOrigin(request, env);
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Please sign in to continue.' }, 401);
    const body = await request.json().catch(() => null);
    const packageId = Number(body?.packageId);
    if (!Number.isSafeInteger(packageId) || packageId < 1 || packageId > 6) return json({ error: 'Choose a valid VIP package.' }, 400);
    const provider = typeof body?.provider === 'string' ? body.provider.toLowerCase() : 'korapay';
    if (provider === 'flutterwave') return createFlutterwaveCheckout(user, packageId, env);
    if (provider !== 'korapay') return json({ error: 'Choose a supported payment provider.' }, 400);
    return createKoraCheckout(user, packageId, env);
  }

  if (path === '/api/admin/overview' && request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Please sign in to continue.' }, 401);
    if (!isAdminUser(user, env)) return json({ error: 'Administrator access required.' }, 403);
    const [counts, users, orders, ledger, packages] = await Promise.all([
      env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM user_vip_packages WHERE status='active') AS active_packages,
        (SELECT COUNT(*) FROM payment_orders WHERE status='pending') AS pending_orders,
        (SELECT COUNT(*) FROM payment_orders WHERE status='processed') AS processed_orders,
        (SELECT COALESCE(SUM(amount_kobo),0) FROM wallet_ledger WHERE entry_type='vip_earning' AND amount_kobo>0) AS total_credits_kobo`).first(),
      env.DB.prepare('SELECT id,name,email,created_at FROM users ORDER BY created_at DESC LIMIT 25').all(),
      env.DB.prepare('SELECT reference,user_id,package_id,amount_kobo,currency,status,created_at,updated_at FROM payment_orders ORDER BY created_at DESC LIMIT 25').all(),
      env.DB.prepare('SELECT id,user_id,entry_type,amount_kobo,reference,description,created_at FROM wallet_ledger ORDER BY created_at DESC LIMIT 25').all(),
      env.DB.prepare('SELECT id,level,name,daily_earning_kobo,price_kobo,enabled FROM vip_packages ORDER BY level').all(),
    ]);
    return json({
      summary: {
        users: Number(counts?.users || 0),
        activePackages: Number(counts?.active_packages || 0),
        pendingOrders: Number(counts?.pending_orders || 0),
        processedOrders: Number(counts?.processed_orders || 0),
        totalVipCredits: naira(counts?.total_credits_kobo),
      },
      users: (users.results || []).map(item => ({ id: item.id, name: item.name, email: item.email, createdAt: item.created_at })),
      orders: (orders.results || []).map(item => ({ ...item, amount: naira(item.amount_kobo) })),
      ledger: (ledger.results || []).map(item => ({ ...item, amount: naira(item.amount_kobo) })),
      packages: (packages.results || []).map(item => ({ ...item, dailyEarning: naira(item.daily_earning_kobo), price: item.price_kobo == null ? null : naira(item.price_kobo) })),
    });
  }

  if (path === '/api/dashboard' && request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Please sign in to continue.' }, 401);
    return json(await dashboard(user, env));
  }

  return json({ error: 'Route not found.' }, 404);
}

async function creditDuePackages(env) {
  // Keep the database-backed authentication throttle table bounded over time.
  await env.DB.prepare('DELETE FROM auth_rate_limits WHERE updated_at < ?')
    .bind(Math.floor(Date.now() / 1000) - 24 * 60 * 60).run();

  const now = new Date();
  const nowIso = now.toISOString();
  const dayMs = 24 * 60 * 60 * 1000;

  // Expire first, so an activation past its configured expiry cannot earn again.
  await env.DB.prepare(
    "UPDATE user_vip_packages SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=?"
  ).bind(nowIso).run();

  const due = await env.DB.prepare(`SELECT a.id,a.user_id,a.package_id,a.last_credited_at,a.expires_at,p.daily_earning_kobo,p.name
    FROM user_vip_packages a JOIN vip_packages p ON p.id=a.package_id
    WHERE a.status='active' AND a.last_credited_at<=? AND (a.expires_at IS NULL OR a.expires_at>?)
    ORDER BY a.last_credited_at ASC LIMIT 500`)
    .bind(new Date(now.getTime() - dayMs).toISOString(), nowIso).all();

  for (const item of due.results || []) {
    const last = new Date(item.last_credited_at).getTime();
    if (!Number.isFinite(last) || now.getTime() - last < dayMs) continue;

    // A stable per-activation period number plus unique constraints prevents double-crediting.
    const periodNumber = Math.floor(last / dayMs) + 1;
    const ledgerId = crypto.randomUUID();
    const reference = `VIP-${item.id}-${periodNumber}`;
    const newLast = new Date(last + dayMs).toISOString();

    // D1 batch executes these statements atomically. The timestamp compare prevents a stale
    // overlapping cron run from moving the activation backwards or advancing it twice.
    // If a prior deployment left a ledger row without advancing the timestamp, this safely
    // repairs the cursor without inserting a duplicate credit.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO wallet_ledger
        (id,user_id,activation_id,entry_type,amount_kobo,period_number,reference,description,created_at)
        SELECT ?,?,?, 'vip_earning',?,?,?, ?,?
        WHERE EXISTS (
          SELECT 1 FROM user_vip_packages
          WHERE id=? AND user_id=? AND status='active' AND last_credited_at=?
            AND (expires_at IS NULL OR expires_at>?)
        )`)
        .bind(ledgerId, item.user_id, item.id, item.daily_earning_kobo, periodNumber,
          reference, `${item.name} daily earning`, nowIso, item.id, item.user_id,
          item.last_credited_at, nowIso),
      env.DB.prepare(`UPDATE user_vip_packages SET last_credited_at=?
        WHERE id=? AND user_id=? AND status='active' AND last_credited_at=?
          AND EXISTS (SELECT 1 FROM wallet_ledger WHERE activation_id=? AND period_number=? AND reference=?)`)
        .bind(newLast, item.id, item.user_id, item.last_credited_at, item.id, periodNumber, reference),
    ]);
  }
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    try {
      const response = await handle(request, env);
      const merged = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) merged.set(key, value);
      merged.set('X-Content-Type-Options', 'nosniff');
      merged.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      merged.set('X-Frame-Options', 'DENY');
      merged.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      return new Response(response.body, { status: response.status, headers: merged });
    } catch (error) {
      // Never send SQL errors or secrets to the browser; inspect Worker logs for server-side details.
      console.error('API request failed:', errorMessage(error));
      return json({ error: 'The server could not complete that request.' }, 500, headers);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(creditDuePackages(env).catch(error => console.error('VIP credit job failed:', errorMessage(error))));
  },
};