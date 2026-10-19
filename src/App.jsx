import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const money = (value) => new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', maximumFractionDigits: 2
}).format(Number(value || 0));

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Something went wrong. Please try again.');
  return payload;
}

function Countdown({ timestamp }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!timestamp) return <span>Waiting for activation</span>;
  const seconds = Math.max(0, Math.floor((new Date(timestamp).getTime() - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return <span>{hours}h {minutes}m {secs}s</span>;
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkoutPackage, setCheckoutPackage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const data = await request(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
      });
      onAuth(data.user);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-shell">
      <section className="auth-art">
        <div className="brand-mark">T<span>✦</span></div>
        <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
        <h1>Build your<br /><em>treasure story.</em></h1>
        <p className="muted auth-copy">One clear dashboard for your VIP packages, earnings schedule and wallet activity.</p>
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <div className="gold-coin">₦</div>
      </section>
      <section className="auth-panel">
        <div className="mobile-brand brand-mark">T<span>✦</span></div>
        <p className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'LET’S GET STARTED'}</p>
        <h2>{mode === 'login' ? 'Sign in to your hub' : 'Create your account'}</h2>
        <p className="muted">{mode === 'login' ? 'Your dashboard is just a sign-in away.' : 'Set up your secure account in a minute.'}</p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <label>Full name<input autoComplete="name" required minLength="2" maxLength="80" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" /></label>}
          <label>Email address<input autoComplete="email" type="email" required maxLength="254" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" required minLength={mode === 'register' ? 10 : 1} maxLength="128" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 10 characters' : 'Enter your password'} /></label>
          {error && <div role="alert" className="error-message">{error}</div>}
          <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <span>↗</span></button>
        </form>
        <p className="switch-auth">{mode === 'login' ? 'New to the hub?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create account' : 'Sign in'}</button></p>
        <p className="fine-print">Keep your password private. Never share your sign-in details with anyone.</p>
      </section>
    </main>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [paymentProvider, setPaymentProvider] = useState('korapay');

  const refresh = useCallback(async () => {
    const data = await request('/dashboard');
    setDashboard(data);
  }, []);

  useEffect(() => {
    let alive = true;
    request('/auth/me').then(data => {
      if (!alive) return;
      setUser(data.user);
      return request('/dashboard').then(d => { if (alive) setDashboard(d); });
    }).catch(() => {
      if (alive) { setUser(null); setDashboard(null); }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const totalDaily = useMemo(() => (dashboard?.activations || []).reduce((sum, item) => sum + Number(item.dailyEarning || 0), 0), [dashboard]);

  async function checkout(pkg) {
    setError(''); setNotice(''); setCheckoutPackage(pkg.id);
    try {
      const data = await request('/vip/checkout', { method: 'POST', body: JSON.stringify({ packageId: pkg.id, provider: paymentProvider }) });
      const allowedCheckoutHost = paymentProvider === 'flutterwave' ? 'https://checkout.flutterwave.com/' : 'https://checkout.korapay.com/';
      if (!data.checkoutUrl || !data.checkoutUrl.startsWith(allowedCheckoutHost)) throw new Error('The payment provider returned an invalid checkout link.');
      window.location.assign(data.checkoutUrl);
    } catch (err) { setError(err.message); setCheckoutPackage(null); }
  }

  async function logout() {
    try { await request('/auth/logout', { method: 'POST', body: '{}' }); } catch {}
    setUser(null); setDashboard(null); setNotice('You have signed out.');
  }

  async function reload() {
    setError('');
    try { await refresh(); setNotice('Dashboard refreshed.'); }
    catch (err) { setError(err.message); }
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /><p>Opening your treasure hub…</p></div>;
  if (!user) return <AuthScreen onAuth={async account => { setUser(account); try { await refresh(); } catch (err) { setError(err.message); } }} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Treasure Minning Hub home"><span className="brand-icon">T✦</span><span>Treasure <b>Minning Hub</b></span></a>
        <div className="side-label">WORKSPACE</div>
        <a className="nav-item active" href="#overview"><span>▦</span> Overview</a>
        <a className="nav-item" href="#packages"><span>◇</span> VIP packages</a>
        <a className="nav-item" href="#activity"><span>↗</span> Wallet activity</a>
        <div className="sidebar-bottom"><div className="secure-pill"><span className="secure-dot" /> Account protected</div><p>Stay sharp. Keep your login private.</p></div>
      </aside>
      <main className="main-content" id="overview">
        <header className="topbar"><div><span className="eyebrow">YOUR PERSONAL DASHBOARD</span><h1>Good to see you, {user.name?.split(' ')[0] || 'there'} <span className="wave">✦</span></h1></div><div className="top-actions"><button className="icon-button" onClick={reload} title="Refresh dashboard" aria-label="Refresh dashboard">↻</button><div className="avatar">{(user.name || user.email || 'T').slice(0,1).toUpperCase()}</div><button className="logout-button" onClick={logout}>Sign out</button></div></header>
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
        {error && <div role="alert" className="error-message page-error">{error}</div>}
        <section className="welcome-banner">
          <div><span className="banner-kicker">YOUR PROGRESS, AT A GLANCE</span><h2>Small steps. Clear records.<br /><em>One focused journey.</em></h2><p>Your earnings schedule and package activity, all in one place.</p></div>
          <div className="banner-art"><div className="banner-ring" /><div className="banner-gem">✦</div><div className="banner-spark spark-a">✧</div><div className="banner-spark spark-b">✦</div></div>
        </section>
        <section className="stats-grid">
          <article className="stat-card balance-card"><div className="stat-heading">GAC WALLET BALANCE <span>₦</span></div><strong>{money(dashboard?.balance)}</strong><p>Available balance</p><div className="stat-decoration">✦</div></article>
          <article className="stat-card"><div className="stat-heading">DAILY VIP EARNINGS <span>↗</span></div><strong>{money(totalDaily)}</strong><p>Across active packages</p><div className="stat-foot">{dashboard?.activations?.length || 0} active package(s)</div></article>
          <article className="stat-card"><div className="stat-heading">TOTAL EARNED <span>◷</span></div><strong>{money(dashboard?.totalEarned)}</strong><p>Recorded VIP credits</p><div className="stat-foot">Based on wallet ledger</div></article>
        </section>
        <section className="section-block" id="packages">
          <div className="section-heading"><div><span className="eyebrow">CHOOSE YOUR LEVEL</span><h2>VIP packages</h2></div><span className="section-count">6 LEVELS</span></div>
          <p className="section-intro">Daily earning figures shown below are package settings, not a guarantee of returns. A package is activated only after payment verification is connected and confirmed.</p>
          <div className="payment-provider-picker">
            <label htmlFor="payment-provider">Payment method</label>
            <select id="payment-provider" value={paymentProvider} onChange={event => setPaymentProvider(event.target.value)}>
              <option value="korapay">Kora</option>
              <option value="flutterwave">Flutterwave</option>
            </select>
            <p className="muted">Choose your preferred secure checkout provider. Availability depends on server configuration.</p>
          </div>
          <div className="package-grid">
            {(dashboard?.packages || []).map((pkg, index) => <article className={`package-card ${index === 2 ? 'featured' : ''}`} key={pkg.id}>
              <div className="package-top"><span className="vip-label">VIP {pkg.level}</span><span className="package-symbol">{['◈','✧','✦','◇','✺','✷'][index]}</span></div>
              <h3>{pkg.name}</h3><div className="daily-amount">{money(pkg.dailyEarning)}<small>/ day</small></div>
              <div className="package-divider" /><p className="package-status">{pkg.priceConfigured ? `Package price: ${money(pkg.price)}` : 'Package price not configured'}</p>
              <button className="package-button" disabled={pkg.active || !pkg.enabled || !pkg.priceConfigured || checkoutPackage === pkg.id} onClick={() => checkout(pkg)}>{pkg.active ? 'Active package' : checkoutPackage === pkg.id ? 'Opening secure checkout…' : pkg.enabled && pkg.priceConfigured ? 'Continue to payment ↗' : 'Not available yet'}</button>
            </article>)}
          </div>
        </section>
        <section className="section-block activity-block" id="activity">
          <div className="section-heading"><div><span className="eyebrow">YOUR RECORDS</span><h2>Active packages & activity</h2></div><button className="text-button" onClick={reload}>Refresh ↻</button></div>
          <div className="table-wrap"><table><thead><tr><th>Package</th><th>Daily earning</th><th>Next credit</th><th>Status</th></tr></thead><tbody>
            {(dashboard?.activations || []).length ? dashboard.activations.map(item => <tr key={item.id}><td><strong>{item.packageName}</strong><small>Activated {new Date(item.activatedAt).toLocaleDateString()}</small></td><td>{money(item.dailyEarning)}</td><td><Countdown timestamp={item.nextCreditAt} /></td><td><span className="status-pill">● {item.status}</span></td></tr>) : <tr><td colSpan="4" className="empty-state"><div className="empty-icon">◇</div><strong>No active packages yet</strong><p>Verified activations will appear here when payment integration is configured.</p></td></tr>}
          </tbody></table></div>
        </section>
        <section className="section-block ledger-block">
          <div className="section-heading"><div><span className="eyebrow">TRANSACTION HISTORY</span><h2>Recent wallet activity</h2></div></div>
          <div className="table-wrap"><table><thead><tr><th>Activity</th><th>Reference</th><th>Date</th><th>Amount</th></tr></thead><tbody>
            {(dashboard?.ledger || []).length ? dashboard.ledger.map(item => <tr key={item.id}><td><strong>{item.description}</strong><small>{item.type}</small></td><td className="reference-cell">{item.reference}</td><td>{new Date(item.createdAt).toLocaleString()}</td><td className={item.amount >= 0 ? 'positive-amount' : ''}>{item.amount >= 0 ? '+' : ''}{money(item.amount)}</td></tr>) : <tr><td colSpan="4" className="empty-state compact-empty">No wallet transactions recorded yet.</td></tr>}
          </tbody></table></div>
        </section>
        <footer className="footer"><span>© {new Date().getFullYear()} Treasure Minning Hub</span><span>Secure by design · Transparent records</span></footer>
      </main>
    </div>
  );
}

export default App;