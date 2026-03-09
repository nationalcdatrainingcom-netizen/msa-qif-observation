const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Init tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS mentors (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        pin TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS mentees (
        id SERIAL PRIMARY KEY,
        mentor_id INTEGER REFERENCES mentors(id),
        name TEXT NOT NULL,
        classroom TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tally_observations (
        id SERIAL PRIMARY KEY,
        mentee_id INTEGER REFERENCES mentees(id),
        domain_id TEXT NOT NULL,
        interaction_type TEXT NOT NULL,
        week_number INTEGER NOT NULL,
        day_number INTEGER NOT NULL,
        time_of_day TEXT NOT NULL,
        tallies JSONB NOT NULL DEFAULT '{}',
        notes TEXT,
        observed_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS weekly_goals (
        id SERIAL PRIMARY KEY,
        mentee_id INTEGER REFERENCES mentees(id),
        domain_id TEXT NOT NULL,
        interaction_type TEXT NOT NULL,
        week_number INTEGER NOT NULL,
        chosen_goal TEXT,
        mentor_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS full_observations (
        id SERIAL PRIMARY KEY,
        mentee_id INTEGER REFERENCES mentees(id),
        observation_type TEXT NOT NULL,
        domain_id TEXT,
        scores JSONB NOT NULL DEFAULT '{}',
        notes TEXT,
        observed_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS mentee_resources (
        id SERIAL PRIMARY KEY,
        domain_id TEXT NOT NULL,
        interaction_type TEXT NOT NULL,
        week_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        pdf_data BYTEA NOT NULL,
        uploaded_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('DB initialized');
  } finally {
    client.release();
  }
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'msa-qif-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// ── AUTH ──────────────────────────────────────────────────────────

// Register or login mentor
app.post('/api/mentor/login', async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
  try {
    let result = await pool.query('SELECT * FROM mentors WHERE LOWER(name) = LOWER($1)', [name]);
    if (result.rows.length === 0) {
      // New mentor — register
      const ins = await pool.query('INSERT INTO mentors (name, pin) VALUES ($1, $2) RETURNING *', [name, pin]);
      req.session.mentorId = ins.rows[0].id;
      req.session.mentorName = ins.rows[0].name;
      return res.json({ success: true, mentor: ins.rows[0], isNew: true });
    } else {
      const mentor = result.rows[0];
      if (mentor.pin !== pin) return res.status(401).json({ error: 'Incorrect PIN' });
      req.session.mentorId = mentor.id;
      req.session.mentorName = mentor.name;
      return res.json({ success: true, mentor, isNew: false });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/mentor/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/mentor/me', (req, res) => {
  if (!req.session.mentorId) return res.status(401).json({ error: 'Not logged in' });
  res.json({ mentorId: req.session.mentorId, mentorName: req.session.mentorName });
});

// ── MENTEES ───────────────────────────────────────────────────────

app.get('/api/mentees', async (req, res) => {
  if (!req.session.mentorId) return res.status(401).json({ error: 'Not logged in' });
  const result = await pool.query('SELECT * FROM mentees WHERE mentor_id = $1 ORDER BY name', [req.session.mentorId]);
  res.json(result.rows);
});

app.post('/api/mentees', async (req, res) => {
  if (!req.session.mentorId) return res.status(401).json({ error: 'Not logged in' });
  const { name, classroom } = req.body;
  const result = await pool.query(
    'INSERT INTO mentees (mentor_id, name, classroom) VALUES ($1, $2, $3) RETURNING *',
    [req.session.mentorId, name, classroom || '']
  );
  res.json(result.rows[0]);
});

// ── TALLY OBSERVATIONS ────────────────────────────────────────────

app.get('/api/observations/tally/:menteeId', async (req, res) => {
  if (!req.session.mentorId) return res.status(401).json({ error: 'Not logged in' });
  const result = await pool.query(
    'SELECT * FROM tally_observations WHERE mentee_id = $1 ORDER BY observed_at',
    [req.params.menteeId]
  );
  res.json(result.rows);
});

app.post('/api/observations/tally', async (req, res) => {
  if (!req.session.mentorId) return res.status(401).json({ error: 'Not logged in' });
  const { menteeId, domainId, interactionType, weekNumber, dayNumber, timeOfDay, tallies, notes } = req.body;

  // Check if record exists for this exact slot
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

// ── WEEKLY GOALS ──────────────────────────────────────────────────

app.get('/api/goals/:menteeId', async (req, res) => {
  if (!req.session.mentorId) return res.status(401).json({ error: 'Not logged in' });
  const result = await pool.query('SELECT * FROM weekly_goals WHERE mentee_id=$1 ORDER BY created_at', [req.params.menteeId]);
  res.json(result.rows);
});

app.post('/api/goals', async (req, res) => {
  if (!req.session.mentorId) return res.status(401).json({ error: 'Not logged in' });
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

// ── MENTEE RESOURCES ─────────────────────────────────────────────

// List available resources
app.get('/api/resources', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, domain_id, interaction_type, week_number, title, filename, uploaded_at FROM mentee_resources ORDER BY week_number',
    );
    res.json(result.rows);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Download a resource as PDF
app.get('/api/resources/:id/pdf', async (req, res) => {
  try {
    const result = await pool.query('SELECT filename, pdf_data FROM mentee_resources WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = result.rows[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + row.filename + '"');
    res.send(row.pdf_data);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload a resource PDF (admin only — simple secret header check)
app.post('/api/resources/upload', async (req, res) => {
  if (req.headers['x-admin-key'] !== (process.env.ADMIN_KEY || 'msa-admin-2024')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { domainId, interactionType, weekNumber, title, filename, pdfBase64 } = req.body;
  if (!domainId || !interactionType || !weekNumber || !title || !filename || !pdfBase64) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const buf = Buffer.from(pdfBase64, 'base64');
    // Upsert — replace if same week/interaction already exists
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
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── ROUTES ────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-upload.html')));
app.get('/qif', (req, res) => res.sendFile(path.join(__dirname, 'public', 'qif.html')));
app.get('/training', (req, res) => res.sendFile(path.join(__dirname, 'public', 'training.html')));

initDB().then(() => {
  app.listen(PORT, () => console.log(`MSA QIF v2 running on port ${PORT}`));
}).catch(e => {
  console.error('DB init failed:', e);
  process.exit(1);
});
