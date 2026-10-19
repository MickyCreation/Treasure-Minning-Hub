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
async function dashboard(user, env) {
  const [account, packages, activations, ledger, total] = await Promise.all([
    env.DB.prepare('SELECT balance_kobo FROM users WHERE id=?').bind(user.id).first(),
    env.DB.prepare('SELECT id,level,name,daily_earning_kobo,price_kobo,enabled FROM vip_packages ORDER BY level').all(),
    env.DB.prepare(`SELECT a.id,p.name AS package_name,p.daily_earning_kobo,a.activated_at,a.last_credited_at,a.expires_at,a.status
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
async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (path.startsWith('/api/') && !allowedOrigin(request, env)) return json({ error: 'Origin not allowed.' }, 403);

  if (path === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'Treasure Minning Hub API' });

  if (path === '/api/auth/register' && request.method === 'POST') {
    assertSameOrigin(request, env);
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
    return json({ user: { id, name, email } }, 201, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_SECONDS) });
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    assertSameOrigin(request, env);
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
    return json({ user: { id: row.id, name: row.name, email: row.email } }, 200, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_SECONDS) });
  }

  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Not signed in.' }, 401);
    return json({ user });
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    assertSameOrigin(request, env);
    const token = cookieValue(request, '__Host-tmh_session');
    if (token && /^[a-f0-9]{64}$/.test(token)) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) });
  }

  if (path === '/api/dashboard' && request.method === 'GET') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Please sign in to continue.' }, 401);
    return json(await dashboard(user, env));
  }

  return json({ error: 'Route not found.' }, 404);
}

async function creditDuePackages(env) {
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