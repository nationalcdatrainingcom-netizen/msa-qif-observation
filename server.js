const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const path = require('path');
const crypto = require('crypto');
const certification = require('./certification');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Crash protection ─────────────────────────────────────────────
// Express 4 doesn't catch errors thrown inside async route handlers; one
// failed database query (e.g. a missing table) used to take the whole site
// down. Every route handler registered below is wrapped so its errors go to
// the error handler at the bottom of this file and return a 500 instead.
function catchAsync(fn) {
  return function (req, res, next) {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (e) {
      next(e);
    }
  };
}
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (routePath, ...handlers) => {
    if (handlers.length === 0) return original(routePath); // app.get('setting')
    return original(routePath, ...handlers.map(h => (typeof h === 'function' && h.length < 4) ? catchAsync(h) : h));
  };
}
// Last line of defence: log instead of exiting on anything that slips through.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

// ── DB ────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
// An idle connection dropping (e.g. a database restart) must not crash the app.
pool.on('error', (err) => console.error('Postgres pool error:', err.message));

// Init / migrate tables
async function initDB() {
  const client = await pool.connect();
  try {
    // ── New tables ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS centers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        mentor_seats INTEGER NOT NULL DEFAULT 0,
        mentee_seats INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','program_director','mentor','mentee')),
        full_name TEXT NOT NULL,
        center_id INTEGER REFERENCES centers(id) ON DELETE SET NULL,
        mentor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        must_change_password BOOLEAN DEFAULT TRUE,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reflections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('mentor','mentee')),
        reflection_type TEXT NOT NULL CHECK (reflection_type IN ('weekly','daily','end_of_domain')),
        week_number INTEGER,
        domain_number INTEGER,
        reflection_date DATE,
        responses JSONB NOT NULL DEFAULT '{}',
        shared_with_mentor BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_reflections_user ON reflections(user_id);
      CREATE INDEX IF NOT EXISTS idx_reflections_lookup ON reflections(user_id, reflection_type, week_number, reflection_date);

      CREATE TABLE IF NOT EXISTS training_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        completed_modules INTEGER[] NOT NULL DEFAULT '{}',
        current_module INTEGER,
        scenario_idx INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_training_progress_user ON training_progress(user_id);

      -- Coaching call library: each entry is either a pasted link
      -- (YouTube, etc.) or an uploaded video stored in 1 MB chunks.
      CREATE TABLE IF NOT EXISTS coaching_videos (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        call_date DATE,
        source_type TEXT NOT NULL CHECK (source_type IN ('link','upload')),
        video_url TEXT,
        filename TEXT,
        mime_type TEXT,
        size_bytes BIGINT,
        status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading','ready')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS coaching_video_chunks (
        video_id INTEGER NOT NULL REFERENCES coaching_videos(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        data BYTEA NOT NULL,
        PRIMARY KEY (video_id, chunk_index)
      );
    `);

    // ── Public website: research trial applications + paid subscribers ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS research_applications (
        id SERIAL PRIMARY KEY,
        program_name TEXT NOT NULL,
        director_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        city TEXT,
        state TEXT,
        license_number TEXT,
        preschool_classrooms INTEGER NOT NULL,
        notes TEXT,
        agreements JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','waitlist','declined')),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        checkout_session_id TEXT UNIQUE NOT NULL,
        program_name TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        email TEXT NOT NULL,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Clean up any uploads that were interrupted by a restart
    await client.query(`DELETE FROM coaching_videos WHERE status='uploading' AND created_at < NOW() - INTERVAL '1 day'`);

    // ── Migrate legacy mentees table to reference users.id ────────
    // The old mentees table had: id, mentor_id, name, classroom
    // We keep mentees table for QIF compatibility, but add a user_id column
    // so QIF observations stay linked even after the user logs in.
    await client.query(`
      ALTER TABLE IF EXISTS mentees
        ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `);

    // ── Seed bootstrap admin if no admin exists ───────────────────
    const adminCheck = await client.query("SELECT COUNT(*) FROM users WHERE role='admin'");
    if (parseInt(adminCheck.rows[0].count) === 0) {
      const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || 'mary@childrenscenterinc.com';
      const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'msa-admin-2026';
      const hash = await bcrypt.hash(bootstrapPassword, 10);
      await client.query(
        `INSERT INTO users (email, password_hash, role, full_name, must_change_password)
         VALUES ($1, $2, 'admin', 'Mary Wardlaw', TRUE)`,
        [bootstrapEmail.toLowerCase(), hash]
      );
      console.log(`Bootstrap admin created: ${bootstrapEmail} / ${bootstrapPassword}`);
    }

    // ── Admin password reset (set on the host, used once) ─────────
    // To recover an admin login, set ADMIN_RESET_EMAIL and
    // ADMIN_RESET_PASSWORD on the host and redeploy. That admin's password
    // becomes the temporary one and they must choose a new password at
    // sign-in. Each email/password pair is applied only once (remembered
    // in admin_password_resets), so leaving the settings in place does not
    // undo a password changed later. Remove both settings afterwards.
    const resetEmail = (process.env.ADMIN_RESET_EMAIL || '').trim().toLowerCase();
    const resetPassword = (process.env.ADMIN_RESET_PASSWORD || '').trim();
    if (resetEmail || resetPassword) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_password_resets (
          fingerprint TEXT PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT NOW()
        );
      `);
      const fingerprint = crypto.createHash('sha256').update(`${resetEmail}\n${resetPassword}`).digest('hex');
      const admin = await client.query("SELECT id FROM users WHERE LOWER(email)=$1 AND role='admin'", [resetEmail]);
      const used = await client.query('SELECT 1 FROM admin_password_resets WHERE fingerprint=$1', [fingerprint]);
      if (!resetEmail || resetPassword.length < 8) {
        console.log('Admin reset skipped: set ADMIN_RESET_EMAIL and an ADMIN_RESET_PASSWORD of at least 8 characters.');
      } else if (admin.rows.length === 0) {
        console.log(`Admin reset skipped: no admin account with email ${resetEmail}.`);
      } else if (used.rows.length > 0) {
        console.log(`Admin reset for ${resetEmail} was already applied; remove ADMIN_RESET_EMAIL and ADMIN_RESET_PASSWORD.`);
      } else {
        const hash = await bcrypt.hash(resetPassword, 10);
        await client.query(
          'UPDATE users SET password_hash=$1, must_change_password=TRUE, active=TRUE WHERE id=$2',
          [hash, admin.rows[0].id]
        );
        await client.query('INSERT INTO admin_password_resets (fingerprint) VALUES ($1)', [fingerprint]);
        console.log(`Admin password reset applied for ${resetEmail}. Sign in with the temporary password, then remove ADMIN_RESET_EMAIL and ADMIN_RESET_PASSWORD.`);
      }
    }

    // ── One-time: ensure Rebecca's admin account exists ───────────
    // This block runs every startup but only inserts if the row is missing.
    // Once Rebecca has signed in and changed her password, this becomes a no-op.
    const rebeccaEmail = 'rebecca@inspiredgrowthllc.com';
    const rebeccaCheck = await client.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [rebeccaEmail]);
    if (rebeccaCheck.rows.length === 0) {
      const rebeccaTempPassword = 'msa-inspired-2026';
      const rebeccaHash = await bcrypt.hash(rebeccaTempPassword, 10);
      await client.query(
        `INSERT INTO users (email, password_hash, role, full_name, must_change_password, active)
         VALUES ($1, $2, 'admin', 'Rebecca Munlyn', TRUE, TRUE)`,
        [rebeccaEmail, rebeccaHash]
      );
      console.log(`Rebecca's admin account created: ${rebeccaEmail} / ${rebeccaTempPassword}`);
    }

    console.log('DB initialized');
  } finally {
    client.release();
  }
}

// Trust Render's proxy so secure cookies + correct protocol detection work
app.set('trust proxy', 1);

// ── Stripe ────────────────────────────────────────────────────────
// Paid subscriptions go through Stripe Checkout. Configure on the host:
//   STRIPE_SECRET_KEY      sk_live_… (or sk_test_… while testing)
//   STRIPE_PRICE_ID        price_… — the recurring price in the Stripe dashboard
//   STRIPE_WEBHOOK_SECRET  whsec_… — from the webhook endpoint pointed at
//                          https://<site>/api/stripe/webhook
// Until the key and price are set, the website shows "contact us" instead.
// Values pasted into the host's settings often pick up stray spaces or quotes.
const envValue = name => (process.env[name] || '').trim().replace(/^["']|["']$/g, '');
const STRIPE_SECRET_KEY = envValue('STRIPE_SECRET_KEY');
const STRIPE_PRICE_ID = envValue('STRIPE_PRICE_ID');
const STRIPE_WEBHOOK_SECRET = envValue('STRIPE_WEBHOOK_SECRET');
const stripe = STRIPE_SECRET_KEY ? Stripe(STRIPE_SECRET_KEY) : null;

// What a price costs at quantity 1, in cents. Per-unit prices carry
// unit_amount; tiered/volume prices keep it null and put amounts on tiers;
// "customer chooses" prices have no fixed amount (null).
function startingAmount(price) {
  if (price.unit_amount != null) return { cents: price.unit_amount, from: false };
  if (price.billing_scheme === 'tiered' && Array.isArray(price.tiers) && price.tiers.length) {
    const t = price.tiers[0];
    return { cents: (t.unit_amount || 0) + (t.flat_amount || 0), from: true };
  }
  return { cents: null, from: false };
}
function describePrice(price) {
  if (price.custom_unit_amount) return 'customer chooses the amount';
  if (price.billing_scheme === 'tiered') return `tiered (${price.tiers_mode || 'unknown mode'}) pricing`;
  return 'per-unit pricing';
}
console.log(`Stripe: secret key ${STRIPE_SECRET_KEY ? 'set' : 'MISSING'}, price ID ${STRIPE_PRICE_ID ? 'set' : 'MISSING'}, webhook secret ${STRIPE_WEBHOOK_SECRET ? 'set' : 'MISSING'}`);

// The webhook needs the raw request body to verify Stripe's signature, so it
// is registered before the JSON body parser.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Stripe webhook signature check failed:', e.message);
    return res.status(400).send('Bad signature');
  }
  const obj = event.data.object;
  if (event.type === 'checkout.session.completed') {
    await pool.query(
      `UPDATE subscriptions SET status='active', stripe_customer_id=$1, stripe_subscription_id=$2, updated_at=NOW()
        WHERE checkout_session_id=$3`,
      [obj.customer, obj.subscription, obj.id]
    );
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    await pool.query(
      'UPDATE subscriptions SET status=$1, updated_at=NOW() WHERE stripe_subscription_id=$2',
      [obj.status, obj.id]
    );
  }
  res.json({ received: true });
});

// ── Public landing page ───────────────────────────────────────────
// mentorsuccessacademy.com shows the marketing landing page at "/"; the app's
// own address keeps showing the sign-in page there. The landing page is also
// reachable on any host at /welcome, and sign-in at /login.
const LANDING_HOSTS = (process.env.LANDING_HOSTS || 'mentorsuccessacademy.com,www.mentorsuccessacademy.com')
  .split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
const landingPage = path.join(__dirname, 'public', 'landing.html');
// Only the landing page on the public domain should be indexed: every other
// host (e.g. the onrender.com address) and the /welcome copy are noindex.
// App pages also carry a noindex meta tag.
app.use((req, res, next) => {
  if (!LANDING_HOSTS.includes(req.hostname.toLowerCase()) || req.path === '/welcome') {
    res.set('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});
app.get('/', (req, res, next) => LANDING_HOSTS.includes(req.hostname.toLowerCase()) ? res.sendFile(landingPage) : next());
app.get('/welcome', (req, res) => res.sendFile(landingPage));

// ── Search engines ────────────────────────────────────────────────
const SITE_URL = (process.env.PUBLIC_SITE_URL || `https://${LANDING_HOSTS[0] || 'mentorsuccessacademy.com'}`).replace(/\/$/, '');
app.get('/robots.txt', (req, res) => {
  const onDomain = LANDING_HOSTS.includes(req.hostname.toLowerCase());
  res.type('text/plain').send(onDomain
    ? [
        'User-agent: *',
        'Disallow: /api/',
        '',
        `Sitemap: ${SITE_URL}/sitemap.xml`,
        ''
      ].join('\n')
    : 'User-agent: *\nDisallow: /\n');
});
// lastmod = when this version of the server started, i.e. the last deploy
const SITEMAP_LASTMOD = new Date().toISOString().slice(0, 10);
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${SITE_URL}/</loc><lastmod>${SITEMAP_LASTMOD}</lastmod></url>\n` +
    '</urlset>\n'
  );
});
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  // Sessions live in Postgres so logins survive restarts and deploys.
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'msa-platform-secret-2026',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    httpOnly: true,
    // SameSite=None is required so the session cookie is sent when this app
    // is embedded as an iframe inside the MSA Hub (different origin).
    // SameSite=None mandates Secure=true, which Render provides via HTTPS.
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Auth guards
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    // Admin impersonation: when admin has actAsCenterId set and the
    // requested role is program_director, treat admin as the director.
    const effectiveRole = (req.session.role === 'admin' && req.session.actAsCenterId)
      ? 'program_director'
      : req.session.role;
    if (!roles.includes(effectiveRole)) return res.status(403).json({ error: 'Forbidden' });
    // Stash the effective center for downstream handlers
    req.effectiveCenterId = (req.session.role === 'admin' && req.session.actAsCenterId)
      ? req.session.actAsCenterId
      : req.session.centerId;
    req.effectiveRole = effectiveRole;
    req.isImpersonating = !!(req.session.role === 'admin' && req.session.actAsCenterId);
    next();
  };
}

// Allow admin OR director (with optional center scope check)
function requireAdminOrDirector(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'admin' && req.session.role !== 'program_director') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Generate readable temp password (e.g. "msa-river-4827")
function generateTempPassword() {
  const words = ['river','meadow','sunrise','harbor','willow','lantern','compass','cedar','garden','summit'];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `msa-${word}-${num}`;
}

// ── AUTH ──────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1) AND active=TRUE', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.fullName = user.full_name;
    req.session.centerId = user.center_id;
    req.session.mentorUserId = user.mentor_user_id;
    req.session.mustChangePassword = user.must_change_password;

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
        mustChangePassword: user.must_change_password
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.email, u.role, u.full_name, u.center_id, u.mentor_user_id, u.must_change_password,
            c.name as center_name,
            m.full_name as mentor_name
     FROM users u
     LEFT JOIN centers c ON u.center_id = c.id
     LEFT JOIN users m ON u.mentor_user_id = m.id
     WHERE u.id=$1`, [req.session.userId]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json(result.rows[0]);
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  try {
    const u = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.session.userId]);
    const ok = await bcrypt.compare(currentPassword || '', u.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=$1, must_change_password=FALSE WHERE id=$2', [hash, req.session.userId]);
    req.session.mustChangePassword = false;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── ADMIN: CENTERS & PROGRAM DIRECTORS ────────────────────────────

app.get('/api/admin/centers', requireRole('admin'), async (req, res) => {
  const result = await pool.query(`
    SELECT c.*,
      (SELECT COUNT(*) FROM users WHERE center_id=c.id AND role='mentor' AND active=TRUE) as mentor_count,
      (SELECT COUNT(*) FROM users WHERE center_id=c.id AND role='mentee' AND active=TRUE) as mentee_count,
      (SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name, 'email', u.email))
         FROM users u WHERE u.center_id=c.id AND u.role='program_director' AND u.active=TRUE) as directors
    FROM centers c ORDER BY c.name
  `);
  // Flag empty centers so the admin UI can gray them out
  const rows = result.rows.map(c => ({
    ...c,
    mentor_count: parseInt(c.mentor_count) || 0,
    mentee_count: parseInt(c.mentee_count) || 0,
    is_empty: (parseInt(c.mentor_count) || 0) === 0 && (parseInt(c.mentee_count) || 0) === 0
  }));
  res.json(rows);
});

app.post('/api/admin/centers', requireRole('admin'), async (req, res) => {
  const { name, mentorSeats, menteeSeats, directorName, directorEmail } = req.body;
  if (!name || !directorName || !directorEmail) return res.status(400).json({ error: 'Center name, director name, and director email required' });
  try {
    const center = await pool.query(
      'INSERT INTO centers (name, mentor_seats, mentee_seats) VALUES ($1,$2,$3) RETURNING *',
      [name, mentorSeats || 0, menteeSeats || 0]
    );
    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    const director = await pool.query(
      `INSERT INTO users (email, password_hash, role, full_name, center_id, must_change_password)
       VALUES ($1,$2,'program_director',$3,$4,TRUE) RETURNING id, email, full_name`,
      [directorEmail.toLowerCase(), hash, directorName, center.rows[0].id]
    );
    res.json({ center: center.rows[0], director: director.rows[0], tempPassword });
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(400).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/centers/:id', requireRole('admin'), async (req, res) => {
  const { name, mentorSeats, menteeSeats } = req.body;
  const result = await pool.query(
    'UPDATE centers SET name=$1, mentor_seats=$2, mentee_seats=$3 WHERE id=$4 RETURNING *',
    [name, mentorSeats, menteeSeats, req.params.id]
  );
  res.json(result.rows[0]);
});

app.post('/api/admin/centers/:id/reset-director-password', requireRole('admin'), async (req, res) => {
  const { directorId } = req.body;
  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 10);
  await pool.query(
    'UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2 AND role=$3',
    [hash, directorId, 'program_director']
  );
  res.json({ success: true, tempPassword });
});

// Admin views all reflections across all centers
app.get('/api/admin/reflections', requireRole('admin'), async (req, res) => {
  const result = await pool.query(`
    SELECT r.*, u.full_name as user_name, u.email, u.role as user_role,
           c.name as center_name,
           m.full_name as mentor_name, m.id as paired_mentor_id
    FROM reflections r
    JOIN users u ON r.user_id = u.id
    LEFT JOIN centers c ON u.center_id = c.id
    LEFT JOIN users m ON u.mentor_user_id = m.id
    ORDER BY r.updated_at DESC
  `);
  res.json(result.rows);
});

// ──────────────────────────────────────────────────────────────────
// LEAP QUIZ INTEGRATION
// Pulls profile labels from the LEAP Quiz app via the bulk lookup
// endpoint. URL is configurable via env so we can rename later.
// ──────────────────────────────────────────────────────────────────
const LEAP_QUIZ_URL = process.env.LEAP_QUIZ_URL || 'https://selcs-quiz.onrender.com';

async function fetchLeapProfiles(emails) {
  if (!emails || emails.length === 0) return {};
  try {
    const r = await fetch(`${LEAP_QUIZ_URL}/api/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails })
    });
    if (!r.ok) {
      console.warn('LEAP lookup failed:', r.status);
      return {};
    }
    const data = await r.json();
    return data.lookup || {};
  } catch (e) {
    console.warn('LEAP lookup error:', e.message);
    return {};
  }
}

// ──────────────────────────────────────────────────────────────────
// CENTER DETAIL — used by both admin (read-only) and director (edit).
// Returns center info, all mentors/mentees with their LEAP profiles,
// and the current pairings. The same endpoint serves both roles
// because the FRONTEND decides whether to render edit controls.
// ──────────────────────────────────────────────────────────────────
app.get('/api/center/:id/detail', requireAdminOrDirector, async (req, res) => {
  const centerId = parseInt(req.params.id);
  if (!centerId) return res.status(400).json({ error: 'Invalid center id' });

  // Scope check: directors can only view their own center
  if (req.session.role === 'program_director' && req.session.centerId !== centerId) {
    return res.status(403).json({ error: 'You can only view your own center' });
  }

  try {
    const center = await pool.query('SELECT * FROM centers WHERE id=$1', [centerId]);
    if (center.rows.length === 0) return res.status(404).json({ error: 'Center not found' });

    const directors = await pool.query(
      `SELECT id, full_name, email FROM users
       WHERE center_id=$1 AND role='program_director' AND active=TRUE
       ORDER BY full_name`, [centerId]);

    const mentors = await pool.query(
      `SELECT id, full_name, email, must_change_password, created_at FROM users
       WHERE center_id=$1 AND role='mentor' AND active=TRUE
       ORDER BY full_name`, [centerId]);

    const mentees = await pool.query(
      `SELECT m.id, m.full_name, m.email, m.must_change_password, m.created_at,
              m.mentor_user_id, mentor.full_name as mentor_name
       FROM users m
       LEFT JOIN users mentor ON m.mentor_user_id = mentor.id
       WHERE m.center_id=$1 AND m.role='mentee' AND m.active=TRUE
       ORDER BY m.full_name`, [centerId]);

    // ── Pull LEAP profiles for everyone in one call ──
    const allEmails = [
      ...mentors.rows.map(u => u.email),
      ...mentees.rows.map(u => u.email)
    ];
    const leapProfiles = await fetchLeapProfiles(allEmails);

    // Attach LEAP to each user
    const attachLeap = (u) => ({
      ...u,
      leap: leapProfiles[u.email.toLowerCase()] || { found: false }
    });

    // ── Per-user training progress (mentors only) ──
    const mentorIds = mentors.rows.map(m => m.id);
    let trainingByUser = {};
    if (mentorIds.length > 0) {
      const trainingResult = await pool.query(
        `SELECT user_id, completed_modules, current_module, updated_at
         FROM training_progress WHERE user_id = ANY($1::int[])`,
        [mentorIds]
      );
      trainingResult.rows.forEach(t => {
        trainingByUser[t.user_id] = {
          completedCount: (t.completed_modules || []).length,
          completedModules: t.completed_modules || [],
          currentModule: t.current_module,
          updatedAt: t.updated_at
        };
      });
    }

    // ── Per-mentee observations count (distinct weeks observed) ──
    const menteeIds = mentees.rows.map(m => m.id);
    let observationsByMentee = {};
    if (menteeIds.length > 0) {
      try {
        const obsResult = await pool.query(
          `SELECT mentee_id,
                  COUNT(DISTINCT week_number) as weeks_observed,
                  MAX(week_number) as latest_week,
                  MAX(observed_at) as last_observation
           FROM tally_observations
           WHERE mentee_id = ANY($1::int[])
           GROUP BY mentee_id`,
          [menteeIds]
        );
        obsResult.rows.forEach(o => {
          observationsByMentee[o.mentee_id] = {
            weeksObserved: parseInt(o.weeks_observed) || 0,
            latestWeek: o.latest_week,
            lastObservation: o.last_observation
          };
        });
      } catch (e) {
        // tally_observations table may not exist in some environments — fail gracefully
        console.warn('Observations count query failed:', e.message);
      }
    }

    // ── Reflection counts and recent meeting status per user ──
    const allUserIds = [...mentorIds, ...menteeIds];
    let reflectionsByUser = {};
    let lastMeetingByUser = {};
    if (allUserIds.length > 0) {
      const reflResult = await pool.query(
        `SELECT user_id,
                COUNT(*) FILTER (WHERE reflection_type='weekly') as weekly_count,
                COUNT(*) FILTER (WHERE reflection_type='daily') as daily_count,
                COUNT(*) FILTER (WHERE reflection_type='end_of_domain') as end_count,
                MAX(updated_at) as last_reflection
         FROM reflections
         WHERE user_id = ANY($1::int[])
         GROUP BY user_id`,
        [allUserIds]
      );
      reflResult.rows.forEach(r => {
        reflectionsByUser[r.user_id] = {
          weeklyCount: parseInt(r.weekly_count) || 0,
          dailyCount: parseInt(r.daily_count) || 0,
          endCount: parseInt(r.end_count) || 0,
          lastReflection: r.last_reflection
        };
      });

      // Most recent weekly reflection answer to the meeting question per user
      const meetingResult = await pool.query(
        `SELECT DISTINCT ON (user_id) user_id, week_number, responses, updated_at
         FROM reflections
         WHERE user_id = ANY($1::int[])
           AND reflection_type = 'weekly'
           AND responses ? 'meeting_check'
         ORDER BY user_id, updated_at DESC`,
        [allUserIds]
      );
      meetingResult.rows.forEach(m => {
        const ans = m.responses && m.responses.meeting_check;
        lastMeetingByUser[m.user_id] = {
          answer: ans || null,
          week: m.week_number,
          answeredAt: m.updated_at
        };
      });
    }

    // Attach training + reflections + meeting to mentor; observations + reflections + meeting to mentee
    const attachMentor = (u) => ({
      ...attachLeap(u),
      training: trainingByUser[u.id] || { completedCount: 0, completedModules: [], currentModule: null, updatedAt: null },
      reflections: reflectionsByUser[u.id] || { weeklyCount: 0, dailyCount: 0, endCount: 0, lastReflection: null },
      lastMeeting: lastMeetingByUser[u.id] || null
    });
    const attachMentee = (u) => ({
      ...attachLeap(u),
      observations: observationsByMentee[u.id] || { weeksObserved: 0, latestWeek: null, lastObservation: null },
      reflections: reflectionsByUser[u.id] || { weeklyCount: 0, dailyCount: 0, endCount: 0, lastReflection: null },
      lastMeeting: lastMeetingByUser[u.id] || null
    });

    // Build pairings: each mentor with their mentees
    const pairings = mentors.rows.map(m => ({
      mentor: attachMentor(m),
      mentees: mentees.rows
        .filter(me => me.mentor_user_id === m.id)
        .map(attachMentee)
    }));

    // Unpaired mentees
    const unpairedMentees = mentees.rows
      .filter(me => !me.mentor_user_id)
      .map(attachMentee);

    // ── Center health summary ──
    const totalMentors = mentors.rows.length;
    const totalMentees = mentees.rows.length;
    const pairedMentees = mentees.rows.filter(me => me.mentor_user_id).length;
    const leapCompleteMentors = mentors.rows.filter(m => leapProfiles[m.email.toLowerCase()] && leapProfiles[m.email.toLowerCase()].found).length;
    const leapCompleteMentees = mentees.rows.filter(m => leapProfiles[m.email.toLowerCase()] && leapProfiles[m.email.toLowerCase()].found).length;

    // Reflection counts for this center
    const reflStats = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE r.reflection_type='weekly') as weekly_count,
             COUNT(*) FILTER (WHERE r.reflection_type='daily') as daily_count,
             COUNT(*) FILTER (WHERE r.reflection_type='end_of_domain') as end_count,
             COUNT(DISTINCT r.user_id) as users_with_reflections
      FROM reflections r
      JOIN users u ON r.user_id = u.id
      WHERE u.center_id = $1
    `, [centerId]);

    const health = {
      totalMentors,
      totalMentees,
      mentorSeats: center.rows[0].mentor_seats,
      menteeSeats: center.rows[0].mentee_seats,
      pairedMentees,
      unpairedMentees: totalMentees - pairedMentees,
      leapCompleteMentors,
      leapCompleteMentees,
      leapPendingMentors: totalMentors - leapCompleteMentors,
      leapPendingMentees: totalMentees - leapCompleteMentees,
      reflections: reflStats.rows[0],
      isEmpty: totalMentors === 0 && totalMentees === 0
    };

    res.json({
      center: center.rows[0],
      directors: directors.rows,
      pairings,
      unpairedMentees,
      health,
      viewerRole: req.session.role,
      isImpersonating: !!(req.session.role === 'admin' && req.session.actAsCenterId === centerId)
    });
  } catch (e) {
    console.error('Center detail error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ──────────────────────────────────────────────────────────────────
// ADMIN IMPERSONATION ("Act as Director" toggle)
// Admin can toggle on impersonation for a specific center; this lets
// them use director endpoints to make changes on the director's behalf.
// ──────────────────────────────────────────────────────────────────
app.post('/api/admin/act-as-director', requireAuth, async (req, res) => {
  // Debug log — appears in Render logs so we can see what's happening
  console.log('[act-as-director] sessionUserId=', req.session.userId,
              'role=', req.session.role,
              'body=', JSON.stringify(req.body));
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only', currentRole: req.session.role });
  }
  const { centerId } = req.body;
  if (!centerId) return res.status(400).json({ error: 'centerId required' });
  try {
    const c = await pool.query('SELECT id FROM centers WHERE id=$1', [centerId]);
    if (c.rows.length === 0) return res.status(404).json({ error: 'Center not found' });
    req.session.actAsCenterId = parseInt(centerId);
    // Force the session to save before responding (avoids race where the
    // browser-side next request might race the session-write).
    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session save failed' });
      }
      res.json({ success: true, actAsCenterId: req.session.actAsCenterId });
    });
  } catch (e) {
    console.error('act-as-director error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/stop-acting', requireAuth, async (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  delete req.session.actAsCenterId;
  req.session.save(err => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).json({ error: 'Session save failed' });
    }
    res.json({ success: true });
  });
});

app.get('/api/admin/impersonation-status', requireAuth, (req, res) => {
  res.json({
    role: req.session.role,
    actAsCenterId: req.session.actAsCenterId || null,
    isImpersonating: !!(req.session.role === 'admin' && req.session.actAsCenterId)
  });
});

// Admin: paired view — see mentor and mentee reflections side by side
app.get('/api/admin/pair/:mentorId/reflections', requireRole('admin'), async (req, res) => {
  const mentorId = req.params.mentorId;
  const mentor = await pool.query('SELECT * FROM users WHERE id=$1 AND role=$2', [mentorId, 'mentor']);
  if (mentor.rows.length === 0) return res.status(404).json({ error: 'Mentor not found' });
  const mentees = await pool.query('SELECT * FROM users WHERE mentor_user_id=$1 AND role=$2', [mentorId, 'mentee']);
  const mentorReflections = await pool.query(
    'SELECT * FROM reflections WHERE user_id=$1 ORDER BY week_number, reflection_type, reflection_date',
    [mentorId]
  );
  const menteeReflections = {};
  for (const m of mentees.rows) {
    const r = await pool.query(
      'SELECT * FROM reflections WHERE user_id=$1 ORDER BY week_number, reflection_type, reflection_date',
      [m.id]
    );
    menteeReflections[m.id] = r.rows;
  }
  res.json({ mentor: mentor.rows[0], mentees: mentees.rows, mentorReflections: mentorReflections.rows, menteeReflections });
});

// ── DIRECTOR: MENTOR/MENTEE MANAGEMENT ────────────────────────────

app.get('/api/director/center', requireRole('program_director'), async (req, res) => {
  const center = await pool.query('SELECT * FROM centers WHERE id=$1', [req.session.centerId]);
  if (center.rows.length === 0) return res.status(404).json({ error: 'Center not found' });
  const mentors = await pool.query(
    `SELECT id, email, full_name, must_change_password, created_at
     FROM users WHERE center_id=$1 AND role='mentor' AND active=TRUE ORDER BY full_name`,
    [req.session.centerId]
  );
  const mentees = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.must_change_password, u.created_at, u.mentor_user_id,
            m.full_name as mentor_name
     FROM users u LEFT JOIN users m ON u.mentor_user_id = m.id
     WHERE u.center_id=$1 AND u.role='mentee' AND u.active=TRUE ORDER BY u.full_name`,
    [req.session.centerId]
  );
  res.json({
    center: center.rows[0],
    mentors: mentors.rows,
    mentees: mentees.rows,
    mentorSeatsUsed: mentors.rows.length,
    menteeSeatsUsed: mentees.rows.length
  });
});

app.post('/api/director/pairs', requireRole('program_director'), async (req, res) => {
  const { mentorName, mentorEmail, menteeName, menteeEmail } = req.body;
  if (!mentorName || !mentorEmail || !menteeName || !menteeEmail) {
    return res.status(400).json({ error: 'All four fields required' });
  }
  try {
    // Seat checks
    const center = await pool.query('SELECT * FROM centers WHERE id=$1', [req.session.centerId]);
    const seats = center.rows[0];
    const mentorCount = await pool.query(
      "SELECT COUNT(*) FROM users WHERE center_id=$1 AND role='mentor' AND active=TRUE",
      [req.session.centerId]
    );
    const menteeCount = await pool.query(
      "SELECT COUNT(*) FROM users WHERE center_id=$1 AND role='mentee' AND active=TRUE",
      [req.session.centerId]
    );
    if (parseInt(mentorCount.rows[0].count) >= seats.mentor_seats) {
      return res.status(400).json({ error: 'No mentor seats available' });
    }
    if (parseInt(menteeCount.rows[0].count) >= seats.mentee_seats) {
      return res.status(400).json({ error: 'No mentee seats available' });
    }

    // Check if mentor email already exists in this center (allow re-pairing)
    let mentorRow;
    const existingMentor = await pool.query(
      "SELECT * FROM users WHERE LOWER(email)=LOWER($1) AND role='mentor' AND active=TRUE",
      [mentorEmail]
    );
    let mentorTempPassword = null;
    if (existingMentor.rows.length > 0) {
      if (existingMentor.rows[0].center_id !== req.session.centerId) {
        return res.status(400).json({ error: 'Mentor email belongs to a different center' });
      }
      mentorRow = existingMentor.rows[0];
    } else {
      mentorTempPassword = generateTempPassword();
      const hash = await bcrypt.hash(mentorTempPassword, 10);
      const ins = await pool.query(
        `INSERT INTO users (email, password_hash, role, full_name, center_id, must_change_password)
         VALUES ($1,$2,'mentor',$3,$4,TRUE) RETURNING *`,
        [mentorEmail.toLowerCase(), hash, mentorName, req.session.centerId]
      );
      mentorRow = ins.rows[0];
    }

    // Create mentee
    const menteeTempPassword = generateTempPassword();
    const menteeHash = await bcrypt.hash(menteeTempPassword, 10);
    const menteeIns = await pool.query(
      `INSERT INTO users (email, password_hash, role, full_name, center_id, mentor_user_id, must_change_password)
       VALUES ($1,$2,'mentee',$3,$4,$5,TRUE) RETURNING *`,
      [menteeEmail.toLowerCase(), menteeHash, menteeName, req.session.centerId, mentorRow.id]
    );

    res.json({
      mentor: { id: mentorRow.id, email: mentorRow.email, fullName: mentorRow.full_name, tempPassword: mentorTempPassword, isNew: !!mentorTempPassword },
      mentee: { id: menteeIns.rows[0].id, email: menteeIns.rows[0].email, fullName: menteeIns.rows[0].full_name, tempPassword: menteeTempPassword, isNew: true }
    });
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(400).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/director/users/:id/reset-password', requireRole('program_director'), async (req, res) => {
  const target = await pool.query(
    'SELECT * FROM users WHERE id=$1 AND center_id=$2 AND role IN (\'mentor\',\'mentee\')',
    [req.params.id, req.session.centerId]
  );
  if (target.rows.length === 0) return res.status(404).json({ error: 'User not found in your center' });
  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 10);
  await pool.query('UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2', [hash, req.params.id]);
  res.json({ success: true, tempPassword, email: target.rows[0].email, fullName: target.rows[0].full_name });
});

app.delete('/api/director/users/:id', requireRole('program_director'), async (req, res) => {
  // Soft delete (set inactive) so reflections aren't lost
  const result = await pool.query(
    'UPDATE users SET active=FALSE WHERE id=$1 AND center_id=$2 AND role IN (\'mentor\',\'mentee\') RETURNING id',
    [req.params.id, req.session.centerId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'User not found in your center' });
  res.json({ success: true });
});

// ── REFLECTIONS ───────────────────────────────────────────────────

// Get question definitions for a reflection type (for rendering the form)
app.get('/api/reflections/questions', requireAuth, async (req, res) => {
  const { type, role, week, domain } = req.query;
  if (!type || !role) return res.status(400).json({ error: 'type and role required' });
  let q = 'SELECT * FROM reflection_questions WHERE reflection_type=$1 AND role=$2';
  const params = [type, role];
  if (week) { q += ` AND week_number=$${params.length+1}`; params.push(parseInt(week)); }
  if (domain) { q += ` AND domain_number=$${params.length+1}`; params.push(parseInt(domain)); }
  q += ' ORDER BY question_order';
  try {
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get my reflections (with optional filters)
app.get('/api/reflections/mine', requireAuth, async (req, res) => {
  const { type, week, date } = req.query;
  let q = 'SELECT * FROM reflections WHERE user_id=$1';
  const params = [req.session.userId];
  if (type) { q += ` AND reflection_type=$${params.length+1}`; params.push(type); }
  if (week) { q += ` AND week_number=$${params.length+1}`; params.push(parseInt(week)); }
  if (date) { q += ` AND reflection_date=$${params.length+1}`; params.push(date); }
  q += ' ORDER BY week_number, reflection_date DESC';
  const result = await pool.query(q, params);
  res.json(result.rows);
});

// Save / upsert a reflection
app.post('/api/reflections', requireAuth, async (req, res) => {
  if (!['mentor','mentee'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Only mentors and mentees can submit reflections' });
  }
  const { reflectionType, weekNumber, domainNumber, reflectionDate, responses, sharedWithMentor } = req.body;
  if (!reflectionType) return res.status(400).json({ error: 'Reflection type required' });

  try {
    // Upsert: weekly is one per (user, week); daily is one per (user, week, date); end_of_domain is one per (user, domain)
    let existing;
    if (reflectionType === 'weekly') {
      existing = await pool.query(
        'SELECT id FROM reflections WHERE user_id=$1 AND reflection_type=$2 AND week_number=$3',
        [req.session.userId, 'weekly', weekNumber]
      );
    } else if (reflectionType === 'daily') {
      existing = await pool.query(
        'SELECT id FROM reflections WHERE user_id=$1 AND reflection_type=$2 AND week_number=$3 AND reflection_date=$4',
        [req.session.userId, 'daily', weekNumber, reflectionDate]
      );
    } else if (reflectionType === 'end_of_domain') {
      existing = await pool.query(
        'SELECT id FROM reflections WHERE user_id=$1 AND reflection_type=$2 AND domain_number=$3',
        [req.session.userId, 'end_of_domain', domainNumber]
      );
    } else {
      return res.status(400).json({ error: 'Invalid reflection type' });
    }

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE reflections SET responses=$1, shared_with_mentor=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
        [JSON.stringify(responses || {}), !!sharedWithMentor, existing.rows[0].id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO reflections (user_id, role, reflection_type, week_number, domain_number, reflection_date, responses, shared_with_mentor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.session.userId, req.session.role, reflectionType, weekNumber || null, domainNumber || null, reflectionDate || null, JSON.stringify(responses || {}), !!sharedWithMentor]
      );
    }
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Toggle share status on an existing reflection
app.put('/api/reflections/:id/share', requireAuth, async (req, res) => {
  const { sharedWithMentor } = req.body;
  const result = await pool.query(
    'UPDATE reflections SET shared_with_mentor=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *',
    [!!sharedWithMentor, req.params.id, req.session.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found or not yours' });
  res.json(result.rows[0]);
});

// Mentor view: see reflections that their mentees have shared
app.get('/api/reflections/shared-with-me', requireRole('mentor'), async (req, res) => {
  const result = await pool.query(`
    SELECT r.*, u.full_name as mentee_name, u.email as mentee_email
    FROM reflections r
    JOIN users u ON r.user_id = u.id
    WHERE u.mentor_user_id=$1 AND r.shared_with_mentor=TRUE
    ORDER BY r.updated_at DESC
  `, [req.session.userId]);
  res.json(result.rows);
});

// Get reflection content (questions for all weeks, role-filtered)
app.get('/api/reflections/content', requireAuth, (req, res) => {
  try {
    const fs = require('fs');
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, 'reflection-content.json'), 'utf-8'));
    res.json(content);
  } catch (e) {
    console.error('Failed to load reflection content:', e);
    res.status(500).json({ error: 'Could not load reflection content' });
  }
});

// Mentee view: who is my mentor
app.get('/api/mentee/my-mentor', requireRole('mentee'), async (req, res) => {
  if (!req.session.mentorUserId) return res.json({ mentor: null });
  const result = await pool.query(
    'SELECT id, full_name, email FROM users WHERE id=$1',
    [req.session.mentorUserId]
  );
  res.json({ mentor: result.rows[0] || null });
});

// ── LEGACY QIF/MENTEES ENDPOINTS (kept for QIF tool compatibility) ─

// Map: legacy mentor "session" comes from new users session if role=mentor
app.get('/api/mentor/me', (req, res) => {
  if (!req.session.userId || req.session.role !== 'mentor') return res.status(401).json({ error: 'Not logged in as mentor' });
  res.json({ mentorId: req.session.userId, mentorName: req.session.fullName });
});

app.get('/api/mentees', requireRole('mentor'), async (req, res) => {
  // Return mentees from the new users table for this mentor
  const result = await pool.query(
    `SELECT u.id, u.full_name as name, '' as classroom, u.id as user_id
     FROM users u WHERE u.mentor_user_id=$1 AND u.role='mentee' AND u.active=TRUE ORDER BY u.full_name`,
    [req.session.userId]
  );
  // Also return any legacy mentees (created via old QIF flow) that haven't been migrated
  // The legacy mentees table only exists on databases that predate v3.
  const legacy = await pool.query(
    'SELECT id, name, classroom, user_id FROM mentees WHERE mentor_id=$1',
    [req.session.userId]
  ).catch(e => { if (e.code === '42P01') return { rows: [] }; throw e; });
  // Merge — legacy takes priority for backwards-compat if user_id matches
  const seen = new Set(result.rows.map(r => r.user_id));
  const merged = [...result.rows];
  for (const l of legacy.rows) {
    if (!seen.has(l.user_id)) merged.push(l);
  }
  res.json(merged);
});

app.post('/api/mentees', requireRole('mentor'), async (req, res) => {
  // For QIF tool — creates a legacy mentee record (not a login user)
  // Real mentee accounts are created by the program director.
  const { name, classroom } = req.body;
  const result = await pool.query(
    'INSERT INTO mentees (mentor_id, name, classroom) VALUES ($1,$2,$3) RETURNING *',
    [req.session.userId, name, classroom || '']
  );
  res.json(result.rows[0]);
});

// ──────────────────────────────────────────────────────────────────
// TRAINING PROGRESS — server-side so mentors can access on any device.
// The training.html page POSTs completed module IDs here so they sync
// across phone/tablet/laptop and so directors can see progress.
// ──────────────────────────────────────────────────────────────────
app.get('/api/training/progress', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT completed_modules, current_module, scenario_idx, updated_at FROM training_progress WHERE user_id=$1',
    [req.session.userId]
  );
  if (result.rows.length === 0) {
    return res.json({ completed: [], current: null, scenarioIdx: 0, updated_at: null });
  }
  const row = result.rows[0];
  res.json({
    completed: row.completed_modules || [],
    current: row.current_module,
    scenarioIdx: row.scenario_idx || 0,
    updated_at: row.updated_at
  });
});

app.post('/api/training/progress', requireAuth, async (req, res) => {
  const { completed, current, scenarioIdx } = req.body;
  if (!Array.isArray(completed)) return res.status(400).json({ error: 'completed array required' });
  // Sanitize: only positive integers
  const clean = completed.filter(n => Number.isInteger(n) && n > 0 && n <= 100);
  try {
    await pool.query(`
      INSERT INTO training_progress (user_id, completed_modules, current_module, scenario_idx, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id) DO UPDATE
      SET completed_modules = EXCLUDED.completed_modules,
          current_module = EXCLUDED.current_module,
          scenario_idx = EXCLUDED.scenario_idx,
          updated_at = NOW()
    `, [req.session.userId, clean, current || null, scenarioIdx || 0]);
    res.json({ success: true, completed: clean });
  } catch (e) {
    console.error('Training progress save error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ──────────────────────────────────────────────────────────────────
// COACHING CALL LIBRARY — recorded coaching calls shown beside the
// training dashboard. Any signed-in user can watch; admins add/remove.
// Uploads are streamed straight into 1 MB rows so large recordings
// never sit in memory and survive redeploys without a persistent disk.
// ──────────────────────────────────────────────────────────────────
const VIDEO_CHUNK_SIZE = 1024 * 1024;
const MAX_VIDEO_BYTES = (parseInt(process.env.MAX_VIDEO_MB, 10) || 1024) * 1024 * 1024;

function cleanDate(d) {
  return (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : null;
}

app.get('/api/coaching-videos', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, title, description, to_char(call_date, 'YYYY-MM-DD') AS call_date, source_type, video_url, filename, mime_type, size_bytes, created_at
       FROM coaching_videos WHERE status='ready'
      ORDER BY call_date DESC NULLS LAST, created_at DESC`
  );
  res.json({ videos: result.rows, canManage: req.session.role === 'admin', maxUploadMb: MAX_VIDEO_BYTES / 1024 / 1024 });
});

app.post('/api/coaching-videos/link', requireRole('admin'), async (req, res) => {
  const { title, description, callDate, url } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  let parsed;
  try { parsed = new URL(String(url || '').trim()); } catch (e) { parsed = null; }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Please paste a full link starting with https://' });
  }
  const result = await pool.query(
    `INSERT INTO coaching_videos (title, description, call_date, source_type, video_url, created_by)
     VALUES ($1, $2, $3, 'link', $4, $5) RETURNING id`,
    [title.trim(), (description || '').trim() || null, cleanDate(callDate), parsed.toString(), req.session.userId]
  );
  res.json({ success: true, id: result.rows[0].id });
});

// Raw file body; metadata travels in the query string.
app.post('/api/coaching-videos/upload', requireRole('admin'), async (req, res) => {
  const title = String(req.query.title || '').trim();
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
  const declared = parseInt(req.headers['content-length'], 10);
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (!mime.startsWith('video/')) return res.status(400).json({ error: 'Please choose a video file' });
  if (declared > MAX_VIDEO_BYTES) {
    return res.status(413).json({ error: `Video is larger than the ${MAX_VIDEO_BYTES / 1024 / 1024} MB limit` });
  }

  const created = await pool.query(
    `INSERT INTO coaching_videos (title, description, call_date, source_type, filename, mime_type, size_bytes, status, created_by)
     VALUES ($1, $2, $3, 'upload', $4, $5, 0, 'uploading', $6) RETURNING id`,
    [title, String(req.query.description || '').trim() || null, cleanDate(req.query.callDate),
     String(req.query.filename || 'video').slice(0, 200), mime, req.session.userId]
  );
  const videoId = created.rows[0].id;

  let pending = [];
  let pendingLen = 0;
  let chunkIndex = 0;
  let total = 0;
  let failed = false;

  async function flush(buf) {
    await pool.query(
      'INSERT INTO coaching_video_chunks (video_id, chunk_index, data) VALUES ($1, $2, $3)',
      [videoId, chunkIndex++, buf]
    );
  }
  async function fail(status, message) {
    if (failed) return;
    failed = true;
    req.resume(); // drain and discard whatever is left of the body
    await pool.query('DELETE FROM coaching_videos WHERE id=$1', [videoId]).catch(() => {});
    if (!res.headersSent) res.status(status).json({ error: message });
  }

  req.on('data', async (data) => {
    if (failed) return;
    total += data.length;
    if (total > MAX_VIDEO_BYTES) {
      return fail(413, `Video is larger than the ${MAX_VIDEO_BYTES / 1024 / 1024} MB limit`);
    }
    pending.push(data);
    pendingLen += data.length;
    if (pendingLen < VIDEO_CHUNK_SIZE) return;
    req.pause();
    try {
      let buf = Buffer.concat(pending, pendingLen);
      while (buf.length >= VIDEO_CHUNK_SIZE) {
        await flush(buf.subarray(0, VIDEO_CHUNK_SIZE));
        buf = buf.subarray(VIDEO_CHUNK_SIZE);
      }
      pending = buf.length ? [buf] : [];
      pendingLen = buf.length;
      req.resume();
    } catch (e) {
      console.error('Coaching video chunk error:', e);
      fail(500, 'Upload failed while saving');
    }
  });

  req.on('end', async () => {
    if (failed) return;
    try {
      if (pendingLen) await flush(Buffer.concat(pending, pendingLen));
      if (total === 0) return fail(400, 'The file was empty');
      await pool.query(`UPDATE coaching_videos SET status='ready', size_bytes=$1 WHERE id=$2`, [total, videoId]);
      res.json({ success: true, id: videoId });
    } catch (e) {
      console.error('Coaching video finalize error:', e);
      fail(500, 'Upload failed while saving');
    }
  });

  req.on('aborted', () => fail(400, 'Upload was cancelled'));
  req.on('error', () => fail(400, 'Upload was interrupted'));
});

// Streams an uploaded video with HTTP Range support so the player can seek.
app.get('/api/coaching-videos/:id/stream', requireAuth, async (req, res) => {
  const meta = await pool.query(
    `SELECT mime_type, size_bytes FROM coaching_videos WHERE id=$1 AND source_type='upload' AND status='ready'`,
    [req.params.id]
  );
  if (meta.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  const size = Number(meta.rows[0].size_bytes);
  let start = 0;
  let end = size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    if (range[1] === '') {
      start = Math.max(0, size - parseInt(range[2], 10));
    } else {
      start = parseInt(range[1], 10);
      if (range[2] !== '') end = Math.min(parseInt(range[2], 10), size - 1);
    }
    if (start > end || start >= size) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', meta.rows[0].mime_type || 'video/mp4');
  res.setHeader('Content-Length', end - start + 1);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const first = Math.floor(start / VIDEO_CHUNK_SIZE);
  const last = Math.floor(end / VIDEO_CHUNK_SIZE);
  try {
    for (let i = first; i <= last; i++) {
      if (res.destroyed) return;
      const r = await pool.query(
        'SELECT data FROM coaching_video_chunks WHERE video_id=$1 AND chunk_index=$2',
        [req.params.id, i]
      );
      if (r.rows.length === 0) break;
      const chunkStart = i * VIDEO_CHUNK_SIZE;
      const from = Math.max(start - chunkStart, 0);
      const to = Math.min(end - chunkStart + 1, r.rows[0].data.length);
      if (!res.write(r.rows[0].data.subarray(from, to))) {
        await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve); });
      }
    }
    res.end();
  } catch (e) {
    console.error('Coaching video stream error:', e);
    res.destroy();
  }
});

app.delete('/api/coaching-videos/:id', requireRole('admin'), async (req, res) => {
  const result = await pool.query('DELETE FROM coaching_videos WHERE id=$1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// MSA Certified Mentor test + certificates (see certification.js)
const cert = certification.register(app, pool, { requireAuth, requireRole });

// Tally observations
app.get('/api/observations/tally/:menteeId', requireRole('mentor'), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM tally_observations WHERE mentee_id=$1 ORDER BY observed_at',
    [req.params.menteeId]
  );
  res.json(result.rows);
});

app.post('/api/observations/tally', requireRole('mentor'), async (req, res) => {
  const { menteeId, domainId, interactionType, weekNumber, dayNumber, timeOfDay, tallies, notes } = req.body;
  const existing = await pool.query(
    'SELECT id FROM tally_observations WHERE mentee_id=$1 AND domain_id=$2 AND interaction_type=$3 AND week_number=$4 AND day_number=$5',
    [menteeId, domainId, interactionType, weekNumber, dayNumber]
  );
  let result;
  if (existing.rows.length > 0) {
    result = await pool.query(
      'UPDATE tally_observations SET tallies=$1, notes=$2, time_of_day=$3, observed_at=NOW() WHERE id=$4 RETURNING *',
      [JSON.stringify(tallies), notes, timeOfDay, existing.rows[0].id]
    );
  } else {
    result = await pool.query(
      'INSERT INTO tally_observations (mentee_id, domain_id, interaction_type, week_number, day_number, time_of_day, tallies, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [menteeId, domainId, interactionType, weekNumber, dayNumber, timeOfDay, JSON.stringify(tallies), notes]
    );
  }
  res.json(result.rows[0]);
});

// Weekly goals
app.get('/api/goals/:menteeId', requireRole('mentor'), async (req, res) => {
  const result = await pool.query('SELECT * FROM weekly_goals WHERE mentee_id=$1 ORDER BY created_at', [req.params.menteeId]);
  res.json(result.rows);
});

app.post('/api/goals', requireRole('mentor'), async (req, res) => {
  const { menteeId, domainId, interactionType, weekNumber, chosenGoal, mentorNotes } = req.body;
  const existing = await pool.query(
    'SELECT id FROM weekly_goals WHERE mentee_id=$1 AND domain_id=$2 AND interaction_type=$3 AND week_number=$4',
    [menteeId, domainId, interactionType, weekNumber]
  );
  let result;
  if (existing.rows.length > 0) {
    result = await pool.query(
      'UPDATE weekly_goals SET chosen_goal=$1, mentor_notes=$2 WHERE id=$3 RETURNING *',
      [chosenGoal, mentorNotes, existing.rows[0].id]
    );
  } else {
    result = await pool.query(
      'INSERT INTO weekly_goals (mentee_id, domain_id, interaction_type, week_number, chosen_goal, mentor_notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [menteeId, domainId, interactionType, weekNumber, chosenGoal, mentorNotes]
    );
  }
  res.json(result.rows[0]);
});

// Mentee resources (PDF library)
app.get('/api/resources', async (req, res) => {
  let query, params;
  if (req.query.domain) {
    query = 'SELECT id, domain_id, interaction_type, week_number, title, filename, uploaded_at FROM mentee_resources WHERE domain_id=$1 ORDER BY week_number';
    params = [req.query.domain];
  } else {
    query = 'SELECT id, domain_id, interaction_type, week_number, title, filename, uploaded_at FROM mentee_resources ORDER BY domain_id, week_number';
    params = [];
  }
  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.get('/api/resources/:id/pdf', async (req, res) => {
  const result = await pool.query('SELECT filename, pdf_data FROM mentee_resources WHERE id=$1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="' + result.rows[0].filename + '"');
  res.send(result.rows[0].pdf_data);
});

app.post('/api/resources/upload', async (req, res) => {
  if (req.headers['x-admin-key'] !== (process.env.ADMIN_KEY || 'msa-admin-2024')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { domainId, interactionType, weekNumber, title, filename, pdfBase64 } = req.body;
  if (!domainId || !interactionType || !weekNumber || !title || !filename || !pdfBase64) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const buf = Buffer.from(pdfBase64, 'base64');
  const existing = await pool.query(
    'SELECT id FROM mentee_resources WHERE interaction_type=$1 AND week_number=$2',
    [interactionType, weekNumber]
  );
  let result;
  if (existing.rows.length > 0) {
    result = await pool.query(
      'UPDATE mentee_resources SET title=$1, filename=$2, pdf_data=$3, uploaded_at=NOW() WHERE id=$4 RETURNING id',
      [title, filename, buf, existing.rows[0].id]
    );
  } else {
    result = await pool.query(
      'INSERT INTO mentee_resources (domain_id, interaction_type, week_number, title, filename, pdf_data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [domainId, interactionType, weekNumber, title, filename, buf]
    );
  }
  res.json({ success: true, id: result.rows[0].id });
});

app.delete('/api/resources/:id', async (req, res) => {
  if (req.headers['x-admin-key'] !== (process.env.ADMIN_KEY || 'msa-admin-2024')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const result = await pool.query('DELETE FROM mentee_resources WHERE id=$1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ── PUBLIC WEBSITE ────────────────────────────────────────────────
function cleanText(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// Every box the director must tick to apply for the free research trial
const RESEARCH_AGREEMENTS = [
  'licensedUS', 'privatelyOwned', 'twoPreschoolClassrooms',
  'comparisonDesign', 'surveysBothClassrooms', 'twelveWeekCommitment', 'researchConsent'
];

app.post('/api/public/research-application', async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ success: true }); // honeypot field — bots fill it in
  const app_ = {
    programName: cleanText(b.programName),
    directorName: cleanText(b.directorName),
    email: cleanText(b.email).toLowerCase(),
    phone: cleanText(b.phone, 40),
    city: cleanText(b.city, 100),
    state: cleanText(b.state, 40),
    licenseNumber: cleanText(b.licenseNumber, 80),
    preschoolClassrooms: parseInt(b.preschoolClassrooms, 10),
    notes: cleanText(b.notes, 2000)
  };
  if (!app_.programName || !app_.directorName || !isEmail(app_.email) || !app_.state || !app_.licenseNumber) {
    return res.status(400).json({ error: 'Please fill in the program name, director name, a valid email, state and license number.' });
  }
  if (!(app_.preschoolClassrooms >= 2)) {
    return res.status(400).json({ error: 'The research trial needs at least 2 classrooms serving children 2½ and older.' });
  }
  const agreements = {};
  for (const key of RESEARCH_AGREEMENTS) {
    if (!(b.agreements && b.agreements[key] === true)) {
      return res.status(400).json({ error: 'Every eligibility and commitment box must be checked to apply.' });
    }
    agreements[key] = true;
  }
  await pool.query(
    `INSERT INTO research_applications
       (program_name, director_name, email, phone, city, state, license_number, preschool_classrooms, notes, agreements)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [app_.programName, app_.directorName, app_.email, app_.phone, app_.city, app_.state,
     app_.licenseNumber, app_.preschoolClassrooms, app_.notes, JSON.stringify(agreements)]
  );
  res.json({ success: true });
});

// Price shown on the landing page comes straight from Stripe, so changing the
// price in the Stripe dashboard (and STRIPE_PRICE_ID) updates the website.
let pricingCache = { at: 0, data: null };
app.get('/api/public/pricing', async (req, res) => {
  if (!stripe || !STRIPE_PRICE_ID) return res.json({ available: false });
  if (pricingCache.data && Date.now() - pricingCache.at < 10 * 60 * 1000) return res.json(pricingCache.data);
  try {
    const price = await stripe.prices.retrieve(STRIPE_PRICE_ID, { expand: ['tiers'] });
    const start = startingAmount(price);
    pricingCache = {
      at: Date.now(),
      data: {
        available: true,
        amount: start.cents,
        from: start.from,
        currency: price.currency,
        interval: price.recurring ? price.recurring.interval : null,
        intervalCount: price.recurring ? price.recurring.interval_count : null
      }
    };
    res.json(pricingCache.data);
  } catch (e) {
    console.error('Stripe price lookup failed:', e.message);
    res.json({ available: false });
  }
});

app.post('/api/public/checkout', async (req, res) => {
  if (!stripe || !STRIPE_PRICE_ID) return res.status(503).json({ error: 'Online checkout is not available yet.' });
  const b = req.body || {};
  const programName = cleanText(b.programName);
  const contactName = cleanText(b.contactName);
  const email = cleanText(b.email).toLowerCase();
  if (!programName || !contactName || !isEmail(email)) {
    return res.status(400).json({ error: 'Please enter your program name, your name and a valid email.' });
  }
  const origin = process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`;
  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    customer_email: email,
    allow_promotion_codes: true,
    metadata: { programName, contactName },
    subscription_data: { metadata: { programName, contactName } },
    success_url: `${origin}/welcome?subscribed=1`,
    cancel_url: `${origin}/welcome#pricing`
  });
  await pool.query(
    'INSERT INTO subscriptions (checkout_session_id, program_name, contact_name, email) VALUES ($1,$2,$3,$4)',
    [checkout.id, programName, contactName, email]
  );
  res.json({ url: checkout.url });
});

app.get('/api/admin/research-applications', requireRole('admin'), async (req, res) => {
  const result = await pool.query('SELECT * FROM research_applications ORDER BY created_at DESC');
  res.json(result.rows);
});

app.patch('/api/admin/research-applications/:id', requireRole('admin'), async (req, res) => {
  const status = req.body && req.body.status;
  if (!['new', 'accepted', 'waitlist', 'declined'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  const result = await pool.query('UPDATE research_applications SET status=$1 WHERE id=$2 RETURNING id', [status, req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Admin-only check of the Stripe setup: which settings are present (never
// their values), whether the key is test or live, and what Stripe says about
// the price. Open /api/admin/stripe-status while signed in as an admin.
app.get('/api/admin/stripe-status', requireRole('admin'), async (req, res) => {
  const mode = k => k.startsWith('sk_live_') ? 'live' : k.startsWith('sk_test_') ? 'test'
    : k.startsWith('rk_live_') ? 'live (restricted key)' : k.startsWith('rk_test_') ? 'test (restricted key)' : 'unrecognized';
  const out = {
    secretKey: STRIPE_SECRET_KEY ? `set (${mode(STRIPE_SECRET_KEY)})` : 'MISSING: add STRIPE_SECRET_KEY',
    priceId: !STRIPE_PRICE_ID ? 'MISSING: add STRIPE_PRICE_ID'
      : STRIPE_PRICE_ID.startsWith('price_') ? `set (${STRIPE_PRICE_ID})`
      : `WRONG: "${STRIPE_PRICE_ID.slice(0, 12)}..." should start with price_ (a prod_ ID is the product, not the price)`,
    webhookSecret: !STRIPE_WEBHOOK_SECRET ? 'MISSING: add STRIPE_WEBHOOK_SECRET'
      : STRIPE_WEBHOOK_SECRET.startsWith('whsec_') ? 'set' : 'WRONG: should start with whsec_',
    webhookUrl: `${process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`}/api/stripe/webhook`
  };
  if (stripe && STRIPE_PRICE_ID) {
    try {
      const price = await stripe.prices.retrieve(STRIPE_PRICE_ID, { expand: ['tiers'] });
      const start = startingAmount(price);
      out.priceDetails = `${describePrice(price)}; amount at quantity 1: ${start.cents == null ? 'none set' : (start.cents / 100).toFixed(2) + ' ' + price.currency.toUpperCase()}`;
      out.price = !price.recurring ? 'WRONG: this price is one-time; create a Recurring price'
        : !start.cents ? `WRONG: this price charges nothing at quantity 1 (${describePrice(price)}). Edit the product in Stripe and add a Recurring price with a fixed amount, then use its price_ ID`
        : `OK: ${start.from ? 'from ' : ''}${(start.cents / 100).toFixed(2)} ${price.currency.toUpperCase()} every ${price.recurring.interval_count > 1 ? price.recurring.interval_count + ' ' : ''}${price.recurring.interval}${price.active ? '' : ' (but this price is ARCHIVED; make it active)'}`;
    } catch (e) {
      out.price = `Stripe error: ${e.message}`;
    }
  }
  res.json(out);
});

app.get('/api/admin/subscriptions', requireRole('admin'), async (req, res) => {
  const result = await pool.query("SELECT * FROM subscriptions WHERE status <> 'pending' ORDER BY created_at DESC");
  res.json(result.rows);
});

// ── PAGE ROUTES ───────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/center/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'center-detail.html')));
app.get('/director', (req, res) => res.sendFile(path.join(__dirname, 'public', 'director.html')));
app.get('/mentor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mentor-home.html')));
app.get('/mentee', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mentee-home.html')));
app.get('/reflections', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reflections.html')));
app.get('/change-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'change-password.html')));
app.get('/qif', (req, res) => res.sendFile(path.join(__dirname, 'public', 'qif.html')));
app.get('/training', (req, res) => res.sendFile(path.join(__dirname, 'public', 'training.html')));
app.get('/admin-upload', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-upload.html')));

// ── Error handler (must stay after all routes) ────────────────────
app.use((err, req, res, next) => {
  console.error(`Error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Server error' });
});

initDB().then(() => cert.initTables()).then(() => {
  app.listen(PORT, () => console.log(`MSA Platform running on port ${PORT}`));
}).catch(e => {
  console.error('DB init failed:', e);
  process.exit(1);
});
