const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ── DB ────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
    `);

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

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'msa-platform-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// Auth guards
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
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
  res.json(result.rows);
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
  const legacy = await pool.query(
    'SELECT id, name, classroom, user_id FROM mentees WHERE mentor_id=$1',
    [req.session.userId]
  );
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

// ── PAGE ROUTES ───────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/director', (req, res) => res.sendFile(path.join(__dirname, 'public', 'director.html')));
app.get('/mentor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mentor-home.html')));
app.get('/mentee', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mentee-home.html')));
app.get('/reflections', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reflections.html')));
app.get('/change-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'change-password.html')));
app.get('/qif', (req, res) => res.sendFile(path.join(__dirname, 'public', 'qif.html')));
app.get('/training', (req, res) => res.sendFile(path.join(__dirname, 'public', 'training.html')));
app.get('/admin-upload', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-upload.html')));

initDB().then(() => {
  app.listen(PORT, () => console.log(`MSA Platform running on port ${PORT}`));
}).catch(e => {
  console.error('DB init failed:', e);
  process.exit(1);
});
