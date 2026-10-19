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

function AuthScreen({ onAuth, initialMode = 'login', onBack }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirmPassword) { setError('Your passwords do not match.'); return; }
    if (mode === 'register' && !acceptedTerms) { setError('Please confirm that you have read and accepted the account terms.'); return; }
    setBusy(true);
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
        <button type="button" className="switch-auth auth-back" onClick={onBack}>← Back to home</button>
        <p className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'LET’S GET STARTED'}</p>
        <h2>{mode === 'login' ? 'Sign in to your hub' : 'Create your account'}</h2>
        <p className="muted">{mode === 'login' ? 'Your dashboard is just a sign-in away.' : 'Set up your secure account in a minute.'}</p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <label>Full name<input autoComplete="name" required minLength="2" maxLength="80" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" /></label>}
          <label>Email address<input autoComplete="email" type="email" required maxLength="254" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" required minLength={mode === 'register' ? 10 : 1} maxLength="128" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 10 characters' : 'Enter your password'} /></label>
          {mode === 'register' && <>
            <label>Confirm password<input autoComplete="new-password" type="password" required minLength="10" maxLength="128" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Enter the same password again" /></label>
            <label className="terms-check"><input type="checkbox" required checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} /> <span>I confirm my details are accurate and I have read the platform terms and privacy information.</span></label>
            <p className="fine-print">Use a unique password of at least 10 characters. Email verification and password recovery must be configured separately.</p>
          </>}
          {error && <div role="alert" className="error-message">{error}</div>}
          <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <span>↗</span></button>
        </form>
        <p className="switch-auth">{mode === 'login' ? 'New to the hub?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setConfirmPassword(''); setAcceptedTerms(false); }}>{mode === 'login' ? 'Create account' : 'Sign in'}</button></p>
        <p className="fine-print">Keep your password private. Never share your sign-in details with anyone.</p>
      </section>
    </main>
  );
}

function LandingScreen({ onSignIn, onRegister }) {
  const packages = [
    ['VIP 1', '₦200', 'daily earning'],
    ['VIP 2', '₦450', 'daily earning'],
    ['VIP 3', '₦1,200', 'daily earning'],
    ['VIP 4', '₦2,200', 'daily earning'],
    ['VIP 5', '₦8,400', 'daily earning'],
    ['VIP 6', '₦14,500', 'daily earning'],
  ];
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="brand landing-brand" href="#home" aria-label="Treasure Minning Hub home">
          <span className="brand-icon">T✦</span><span>Treasure <b>Minning Hub</b></span>
        </a>
        <nav className="landing-links" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a><a href="#vip-levels">VIP levels</a><a href="#security">Security</a>
        </nav>
        <div className="landing-nav-actions">
          <button className="nav-signin" onClick={onSignIn}>Sign in</button>
          <button className="nav-cta" onClick={onRegister}>Get started <span>↗</span></button>
        </div>
      </header>

      <section className="landing-hero" id="home">
        <div className="hero-copy">
          <div className="hero-pill"><span className="secure-dot" /> YOUR GOALS. YOUR DASHBOARD. YOUR PACE.</div>
          <h1>Make room for<br />your next <em>big thing.</em></h1>
          <p className="hero-description">A clearer way to manage your Treasure Minning Hub account, track package activity and follow your wallet records — all from one simple dashboard.</p>
          <div className="hero-actions">
            <button className="hero-primary" onClick={onRegister}>Create your account <span>↗</span></button>
            <button className="hero-secondary" onClick={onSignIn}>I already have an account</button>
          </div>
          <div className="hero-trust"><span>✦</span> Clear activity records <i /> <span>✦</span> Secure account access</div>
        </div>
        <div className="hero-visual" aria-label="Illustration of the Treasure Minning Hub dashboard">
          <div className="visual-glow" />
          <div className="visual-orbit orbit-a" /><div className="visual-orbit orbit-b" />
          <div className="hero-coin coin-large">₦</div><div className="hero-coin coin-small">✦</div>
          <div className="preview-card">
            <div className="preview-head"><span className="preview-logo">T✦</span><div><b>Your treasure hub</b><small>ACCOUNT OVERVIEW</small></div><span className="preview-dots">•••</span></div>
            <div className="preview-balance"><small>WALLET OVERVIEW</small><strong>₦ ••••••</strong><span>Balance shown after sign in</span></div>
            <div className="preview-chart"><div className="chart-label"><span>Activity overview</span><span>Recent</span></div><div className="chart-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
            <div className="preview-foot"><span><i /> Account dashboard</span><span>Secure access ↗</span></div>
          </div>
          <div className="floating-note"><span className="note-icon">✓</span><div><b>Everything in one place</b><small>Packages · wallet · activity</small></div></div>
        </div>
        <div className="hero-bottom-label"><span>01 / A CLEARER VIEW</span><span>BUILT FOR YOUR EVERYDAY</span></div>
      </section>

      <section className="landing-benefits" id="how-it-works">
        <div className="landing-section-intro"><span className="eyebrow">A SIMPLE PLACE TO START</span><h2>Less guesswork.<br /><em>More clarity.</em></h2><p>Know where to go, what is active and what has been recorded. Your account tools are organised to keep things straightforward.</p></div>
        <div className="benefit-list">
          <article><span className="benefit-icon">◫</span><div><h3>One personal dashboard</h3><p>See account information, package status and wallet activity in one place.</p></div><span className="benefit-number">01</span></article>
          <article><span className="benefit-icon">◇</span><div><h3>Package details at a glance</h3><p>Review available VIP levels and their displayed daily earning settings before making a decision.</p></div><span className="benefit-number">02</span></article>
          <article><span className="benefit-icon">↗</span><div><h3>Track recorded activity</h3><p>Keep an eye on transactions and package events recorded in your account.</p></div><span className="benefit-number">03</span></article>
        </div>
      </section>

      <section className="landing-vips" id="vip-levels">
        <div className="landing-section-heading"><div><span className="eyebrow">EXPLORE THE LEVELS</span><h2>Find the level that<br /><em>fits your plan.</em></h2></div><p>Compare the displayed daily earning settings. Package availability and purchase prices depend on the platform's current configuration.</p></div>
        <div className="landing-vip-grid">{packages.map((pkg, i) => <article className={i === 2 ? 'landing-vip featured-vip' : 'landing-vip'} key={pkg[0]}><div className="vip-card-top"><span>{pkg[0]}</span><b>{['◈','✧','✦','◇','✺','✷'][i]}</b></div><strong>{pkg[1]}</strong><small>{pkg[2]}</small><div className="vip-card-rule" /><p>{i === 2 ? 'A balanced level to compare' : 'Review package details after sign in'}</p><button onClick={onRegister}>Explore package <span>↗</span></button></article>)}</div>
        <p className="landing-disclaimer">Displayed figures are package settings, not guaranteed returns. Review all terms and package prices before purchasing. Do not spend money you cannot afford to lose.</p>
      </section>

      <section className="landing-security" id="security">
        <div className="security-emblem"><span>✦</span><i /><b>SECURE<br />BY DESIGN</b></div>
        <div><span className="eyebrow">YOUR ACCOUNT MATTERS</span><h2>A little more confidence<br />in every sign-in.</h2><p>Treasure Minning Hub is designed around private account access, clear transaction references and server-verified payment events. Always keep your password private and confirm payment details before proceeding.</p><button className="hero-secondary" onClick={onRegister}>Create your account <span>↗</span></button></div>
      </section>

      <section className="landing-final-cta"><span className="eyebrow">READY WHEN YOU ARE</span><h2>Your hub starts here.</h2><p>Create an account to access your personal dashboard and package information.</p><button className="hero-primary" onClick={onRegister}>Get started <span>↗</span></button></section>
      <footer className="landing-footer"><a className="brand landing-brand" href="#home"><span className="brand-icon">T✦</span><span>Treasure <b>Minning Hub</b></span></a><span>© {new Date().getFullYear()} Treasure Minning Hub</span><span>Secure account access · Clear records</span></footer>
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
  const [checkoutPackage, setCheckoutPackage] = useState(null);
  const [authMode, setAuthMode] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);

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
    setUser(null); setDashboard(null); setAdminData(null); setShowAdmin(false); setNotice('You have signed out.');
  }

  async function reload() {
    setError('');
    try { await refresh(); setNotice('Dashboard refreshed.'); }
    catch (err) { setError(err.message); }
  }

  async function loadAdminOverview() {
    setAdminLoading(true); setAdminError('');
    try { setAdminData(await request('/admin/overview')); setShowAdmin(true); }
    catch (err) { setAdminError(err.message); setShowAdmin(true); }
    finally { setAdminLoading(false); }
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /><p>Opening your treasure hub…</p></div>;
  if (!user && !authMode) return <LandingScreen onSignIn={() => setAuthMode('login')} onRegister={() => setAuthMode('register')} />;
  if (!user) return <AuthScreen onAuth={async account => { setUser(account); setAuthMode(null); try { await refresh(); } catch (err) { setError(err.message); } }} initialMode={authMode} onBack={() => setAuthMode(null)} />;

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
        <header className="topbar"><div><span className="eyebrow">YOUR PERSONAL DASHBOARD</span><h1>Good to see you, {user.name?.split(' ')[0] || 'there'} <span className="wave">✦</span></h1></div><div className="top-actions">{user.isAdmin && <button className="logout-button" onClick={showAdmin ? () => setShowAdmin(false) : loadAdminOverview}>{showAdmin ? 'User dashboard' : 'Admin dashboard'}</button>}<button className="icon-button" onClick={reload} title="Refresh dashboard" aria-label="Refresh dashboard">↻</button><div className="avatar">{(user.name || user.email || 'T').slice(0,1).toUpperCase()}</div><button className="logout-button" onClick={logout}>Sign out</button></div></header>
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
        {error && <div role="alert" className="error-message page-error">{error}</div>}
        {showAdmin && <section className="section-block admin-panel" aria-label="Administrator dashboard">
          <div className="section-heading"><div><span className="eyebrow">RESTRICTED WORKSPACE</span><h2>Administrator dashboard</h2></div><button className="text-button" onClick={loadAdminOverview} disabled={adminLoading}>{adminLoading ? 'Loading…' : 'Refresh data ↻'}</button></div>
          <p className="section-intro">Operational overview and recent records. Sensitive actions such as payouts and package configuration are not available in this view.</p>
          {adminError && <div role="alert" className="error-message">{adminError}</div>}
          {adminLoading && !adminData ? <p className="muted">Loading administrator data…</p> : adminData && <>
            <div className="stats-grid admin-stats">
              <article className="stat-card"><div className="stat-heading">REGISTERED USERS</div><strong>{adminData.summary.users}</strong><p>Total accounts</p></article>
              <article className="stat-card"><div className="stat-heading">ACTIVE VIP PACKAGES</div><strong>{adminData.summary.activePackages}</strong><p>Across all users</p></article>
              <article className="stat-card"><div className="stat-heading">PENDING PAYMENTS</div><strong>{adminData.summary.pendingOrders}</strong><p>Awaiting provider confirmation</p></article>
              <article className="stat-card"><div className="stat-heading">PROCESSED PAYMENTS</div><strong>{adminData.summary.processedOrders}</strong><p>Marked processed</p></article>
              <article className="stat-card"><div className="stat-heading">VIP CREDITS RECORDED</div><strong>{money(adminData.summary.totalVipCredits)}</strong><p>Ledger total</p></article>
            </div>
            <div className="section-block"><div className="section-heading"><h2>Recent registrations</h2><span className="section-count">{adminData.users.length} shown</span></div><label className="admin-search">Search recent users<input type="search" value={adminUserSearch} onChange={event => setAdminUserSearch(event.target.value)} placeholder="Filter by name, email or account ID" /></label><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Account ID</th><th>Joined</th></tr></thead><tbody>{adminData.users.filter(item => [item.name,item.email,item.id].some(value => String(value || "").toLowerCase().includes(adminUserSearch.toLowerCase().trim()))).map(item => <tr key={item.id}><td>{item.name}</td><td>{item.email}</td><td className="reference-cell">{item.id}</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></div>
            <div className="section-block"><div className="section-heading"><h2>Recent payment orders</h2></div><div className="table-wrap"><table><thead><tr><th>Reference</th><th>User ID</th><th>VIP</th><th>Amount</th><th>Status</th></tr></thead><tbody>{adminData.orders.map(item => <tr key={item.reference}><td className="reference-cell">{item.reference}</td><td>{item.user_id}</td><td>VIP {item.package_id}</td><td>{money(item.amount)}</td><td>{item.status}</td></tr>)}</tbody></table></div></div>
            <div className="section-block"><div className="section-heading"><h2>Recent wallet ledger entries</h2><span className="section-count">{adminData.ledger.length} records</span></div><div className="table-wrap"><table><thead><tr><th>Created</th><th>Account ID</th><th>Type</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{adminData.ledger.map(item => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td className="reference-cell">{item.user_id}</td><td>{item.entry_type}</td><td>{money(item.amount)}</td><td className="reference-cell">{item.reference}</td></tr>)}</tbody></table></div></div>
            <div className="section-block"><div className="section-heading"><h2>VIP package configuration</h2></div><div className="table-wrap"><table><thead><tr><th>Package</th><th>Daily earning</th><th>Price</th><th>Purchasable</th></tr></thead><tbody>{adminData.packages.map(item => <tr key={item.id}><td>{item.name}</td><td>{money(item.dailyEarning)}</td><td>{item.price == null ? 'Not configured' : money(item.price)}</td><td>{item.enabled ? 'Enabled' : 'Disabled'}</td></tr>)}</tbody></table></div></div>
          </>}
        </section>}
        {!showAdmin && <>
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
        </>}
        <footer className="footer"><span>© {new Date().getFullYear()} Treasure Minning Hub</span><span>Secure by design · Transparent records</span></footer>
      </main>
    </div>
  );
}

export default App;