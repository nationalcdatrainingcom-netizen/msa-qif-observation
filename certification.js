// ════════════════════════════════════════════════════════════════════
// MSA CERTIFIED MENTOR — annual certification test
// ════════════════════════════════════════════════════════════════════
// Rules:
//   • First certification unlocks after all 12 training modules are done.
//   • Each test is 12 scenarios: one from each week, each with a different
//     Leadership Expression blend, pulled from the training curriculum.
//     Scenarios a mentor has already been tested on are avoided if possible.
//   • One answer per question, locked in; the mentor only learns right/wrong.
//   • Pass = at least 75% (9 of 12). Certification lasts one year from the
//     pass date. Annual calibration opens 30 days before expiration.
//   • Attempts per cycle: the first 3 may be taken back-to-back, the next 2
//     at most one per day, then the test locks until an admin unlocks it.
// Grading happens here on the server; the browser never gets the answers.
// ════════════════════════════════════════════════════════════════════

const QUESTIONS_PER_TEST = 12;
const PASS_PERCENT = 75;
const PASS_SCORE = Math.ceil(QUESTIONS_PER_TEST * PASS_PERCENT / 100); // 9
const IMMEDIATE_ATTEMPTS = 3;
const MAX_ATTEMPTS = 5;
const RENEWAL_WINDOW_DAYS = 30;
const TZ = process.env.CERT_TIMEZONE || 'America/Detroit';

// The curriculum lives in training-curriculum.js (outside public/, so browsers
// can only get it through /api/training/curriculum below). The server picks
// test scenarios and grades answers from the same content mentors train on.
function loadCurriculum() {
  const curriculum = require('./training-curriculum');
  if (!Array.isArray(curriculum) || curriculum.length < QUESTIONS_PER_TEST) {
    throw new Error('CURRICULUM has fewer than ' + QUESTIONS_PER_TEST + ' modules');
  }
  return curriculum;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One scenario per module (week), every blend different. Try a batch of
// random assignments and keep the one that repeats the fewest scenarios
// this mentor has already seen on a previous test.
function pickScenarios(curriculum, seenKeys) {
  const modules = curriculum.slice(0, QUESTIONS_PER_TEST);
  let best = null;
  let bestRepeats = Infinity;
  for (let tries = 0; tries < 400 && bestRepeats > 0; tries++) {
    const usedTypes = new Set();
    const picks = [];
    let repeats = 0;
    let ok = true;
    for (const m of shuffle(modules)) {
      const options = shuffle(m.scenarios.map((s, idx) => ({ idx, type: s.menteeType })))
        .filter(o => !usedTypes.has(o.type));
      if (options.length === 0) { ok = false; break; }
      const fresh = options.find(o => !seenKeys.has(m.id + ':' + o.idx));
      const choice = fresh || options[0];
      if (!fresh) repeats++;
      usedTypes.add(choice.type);
      picks.push({ m: m.id, s: choice.idx });
    }
    if (ok && repeats < bestRepeats) { best = picks; bestRepeats = repeats; }
  }
  best.sort((a, b) => a.m - b.m); // present in week order
  return best.map(p => ({ ...p, order: shuffle([0, 1, 2, 3]) }));
}

function scenarioFor(curriculum, q) {
  const m = curriculum.find(x => x.id === q.m);
  return m ? { module: m, scenario: m.scenarios[q.s] } : null;
}

// What the browser is allowed to see: the scenario, never the answer key.
function publicQuestion(curriculum, q, index) {
  const { module: m, scenario: sc } = scenarioFor(curriculum, q);
  return {
    index,
    moduleId: m.id,
    week: m.week,
    moduleTitle: m.title,
    domainName: m.domainName,
    menteeType: sc.menteeType,
    menteeLabel: sc.menteeLabel,
    menteeDesc: sc.menteeDesc,
    sceneTitle: sc.sceneTitle,
    sceneTag: sc.sceneTag,
    focusBadge: sc.focusBadge,
    scene: sc.scene,
    qcTitle: sc.qcTitle,
    qcSub: sc.qcSub,
    qcText1: sc.qcText1,
    qcText2: sc.qcText2,
    coachTitle: sc.coachTitle,
    question: sc.question,
    options: q.order.map(i => sc.options[i])
  };
}

function isoDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function register(app, pool, { requireAuth, requireRole }) {
  let curriculum = null;
  try {
    curriculum = loadCurriculum();
  } catch (e) {
    console.error('Certification: could not load curriculum —', e.message);
  }

  async function initTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS certification_attempts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('initial','calibration')),
        questions JSONB NOT NULL,
        answers JSONB NOT NULL DEFAULT '[]',
        score INTEGER,
        passed BOOLEAN,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_attempt_open
        ON certification_attempts(user_id) WHERE completed_at IS NULL;

      CREATE TABLE IF NOT EXISTS certifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        attempt_id INTEGER REFERENCES certification_attempts(id) ON DELETE SET NULL,
        kind TEXT NOT NULL,
        score INTEGER,
        certified_on DATE NOT NULL,
        expires_on DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_certifications_user ON certifications(user_id);

      CREATE TABLE IF NOT EXISTS certification_unlocks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        unlocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  }

  // Everything the dashboard, mentor home and admin console need to know.
  async function computeStatus(userId) {
    const [todayRow, certRow, progressRow, openRow, unlockRow, userRow] = await Promise.all([
      pool.query(`SELECT to_char((NOW() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today`, [TZ]),
      pool.query(
        `SELECT id, kind, score, to_char(certified_on,'YYYY-MM-DD') AS certified_on,
                to_char(expires_on,'YYYY-MM-DD') AS expires_on,
                to_char(expires_on - $2::int,'YYYY-MM-DD') AS renewal_opens_on, created_at
           FROM certifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [userId, RENEWAL_WINDOW_DAYS]
      ),
      pool.query('SELECT completed_modules FROM training_progress WHERE user_id=$1', [userId]),
      pool.query(
        `SELECT id, kind, jsonb_array_length(answers) AS answered FROM certification_attempts
          WHERE user_id=$1 AND completed_at IS NULL`,
        [userId]
      ),
      pool.query('SELECT MAX(created_at) AS at FROM certification_unlocks WHERE user_id=$1', [userId]),
      pool.query('SELECT full_name FROM users WHERE id=$1', [userId])
    ]);
    const today = todayRow.rows[0].today;
    const cert = certRow.rows[0] || null;
    const completed = (progressRow.rows[0] && progressRow.rows[0].completed_modules) || [];
    const requiredModules = curriculum ? curriculum.slice(0, QUESTIONS_PER_TEST).map(m => m.id) : [];
    const modulesComplete = requiredModules.filter(id => completed.includes(id)).length;

    // Attempts count toward the limit from the later of the last pass or last admin unlock.
    const cycleStart = [cert && cert.created_at, unlockRow.rows[0].at]
      .filter(Boolean).sort((a, b) => b - a)[0] || new Date(0);
    const failed = await pool.query(
      `SELECT COUNT(*)::int AS n,
              to_char(MAX((completed_at AT TIME ZONE $3)::date), 'YYYY-MM-DD') AS last_day
         FROM certification_attempts
        WHERE user_id=$1 AND completed_at IS NOT NULL AND passed=FALSE AND completed_at > $2`,
      [userId, cycleStart, TZ]
    );
    const attemptsUsed = failed.rows[0].n;
    const lastFailDay = failed.rows[0].last_day;

    const status = {
      fullName: userRow.rows[0] ? userRow.rows[0].full_name : '',
      today,
      questionsPerTest: QUESTIONS_PER_TEST,
      passScore: PASS_SCORE,
      maxAttempts: MAX_ATTEMPTS,
      immediateAttempts: IMMEDIATE_ATTEMPTS,
      modulesComplete,
      modulesRequired: requiredModules.length,
      attemptsUsed,
      certification: cert ? {
        id: cert.id,
        number: 'MSA-' + cert.certified_on.slice(0, 4) + '-' + String(cert.id).padStart(4, '0'),
        certifiedOn: cert.certified_on,
        expiresOn: cert.expires_on,
        renewalOpensOn: cert.renewal_opens_on,
        active: today <= cert.expires_on
      } : null,
      inProgress: openRow.rows[0] ? { attemptId: openRow.rows[0].id, answered: openRow.rows[0].answered } : null,
      nextKind: cert ? 'calibration' : 'initial',
      canStart: false,
      state: null,
      nextAttemptOn: null
    };

    if (!curriculum) { status.state = 'unavailable'; return status; }
    if (status.inProgress) { status.state = 'in_progress'; status.canStart = true; return status; }

    if (cert && today < cert.renewal_opens_on) {
      status.state = 'certified';
      return status;
    }
    if (!cert && modulesComplete < requiredModules.length) {
      status.state = 'not_eligible';
      return status;
    }
    if (attemptsUsed >= MAX_ATTEMPTS) {
      status.state = 'locked';
      return status;
    }
    if (attemptsUsed >= IMMEDIATE_ATTEMPTS && lastFailDay && lastFailDay >= today) {
      status.state = 'wait';
      const next = await pool.query(`SELECT to_char($1::date + 1, 'YYYY-MM-DD') AS d`, [today]);
      status.nextAttemptOn = next.rows[0].d;
      return status;
    }
    status.canStart = true;
    status.state = !cert ? 'eligible' : (status.certification.active ? 'renewal_open' : 'expired');
    return status;
  }

  async function loadAttempt(userId, attemptId) {
    const r = await pool.query(
      'SELECT * FROM certification_attempts WHERE id=$1 AND user_id=$2',
      [attemptId, userId]
    );
    return r.rows[0] || null;
  }

  function attemptPayload(a) {
    const answers = a.answers || [];
    return {
      attemptId: a.id,
      kind: a.kind,
      total: a.questions.length,
      passScore: PASS_SCORE,
      answered: answers.map(x => ({ correct: x.correct })),
      questions: a.questions.map((q, i) => publicQuestion(curriculum, q, i))
    };
  }

  const certRoles = requireRole('mentor', 'admin');

  // Training content for the training page. Withheld while the signed-in
  // user has a certification test open, so they can't look up answers.
  const curriculumJson = curriculum ? JSON.stringify(curriculum) : null;
  app.get('/api/training/curriculum', requireAuth, async (req, res) => {
    if (!curriculumJson) return res.status(503).json({ error: 'Training content is unavailable' });
    const open = await pool.query(
      'SELECT jsonb_array_length(answers) AS answered FROM certification_attempts WHERE user_id=$1 AND completed_at IS NULL',
      [req.session.userId]
    );
    res.setHeader('Cache-Control', 'no-store');
    if (open.rows.length > 0) {
      return res.status(423).json({ locked: true, answered: open.rows[0].answered, total: QUESTIONS_PER_TEST });
    }
    res.type('application/json').send(curriculumJson);
  });

  app.get('/api/certification/status', certRoles, async (req, res) => {
    try {
      res.json(await computeStatus(req.session.userId));
    } catch (e) {
      console.error('Certification status error:', e);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Starts a new test, or resumes the one already in progress.
  app.post('/api/certification/start', certRoles, async (req, res) => {
    try {
      const userId = req.session.userId;
      const status = await computeStatus(userId);
      if (status.inProgress) {
        return res.json(attemptPayload(await loadAttempt(userId, status.inProgress.attemptId)));
      }
      if (!status.canStart) return res.status(403).json({ error: 'The certification test is not available right now.', status });

      const seen = await pool.query('SELECT questions FROM certification_attempts WHERE user_id=$1', [userId]);
      const seenKeys = new Set();
      seen.rows.forEach(r => (r.questions || []).forEach(q => seenKeys.add(q.m + ':' + q.s)));
      const questions = pickScenarios(curriculum, seenKeys);
      const created = await pool.query(
        `INSERT INTO certification_attempts (user_id, kind, questions) VALUES ($1, $2, $3) RETURNING *`,
        [userId, status.nextKind, JSON.stringify(questions)]
      );
      res.json(attemptPayload(created.rows[0]));
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'A test is already in progress. Please refresh.' });
      console.error('Certification start error:', e);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Locks in one answer. Questions are answered in order and cannot be changed.
  app.post('/api/certification/answer', certRoles, async (req, res) => {
    const userId = req.session.userId;
    const { attemptId, index, choice } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        'SELECT * FROM certification_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [attemptId, userId]
      );
      const a = r.rows[0];
      if (!a || a.completed_at) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No test in progress' }); }
      const answers = a.answers || [];
      if (index !== answers.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That question has already been answered' }); }
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid choice' }); }

      const q = a.questions[index];
      const { scenario } = scenarioFor(curriculum, q);
      const correct = q.order[choice] === scenario.correct;
      answers.push({ choice, correct });

      const result = { correct, answered: answers.length, total: a.questions.length };
      if (answers.length === a.questions.length) {
        const score = answers.filter(x => x.correct).length;
        const passed = score >= PASS_SCORE;
        await client.query(
          'UPDATE certification_attempts SET answers=$1, score=$2, passed=$3, completed_at=NOW() WHERE id=$4',
          [JSON.stringify(answers), score, passed, a.id]
        );
        if (passed) {
          await client.query(
            `INSERT INTO certifications (user_id, attempt_id, kind, score, certified_on, expires_on)
             VALUES ($1, $2, $3, $4, (NOW() AT TIME ZONE $5)::date, ((NOW() AT TIME ZONE $5)::date + INTERVAL '1 year')::date)`,
            [userId, a.id, a.kind, score, TZ]
          );
        }
        Object.assign(result, { finished: true, score, passed, passScore: PASS_SCORE });
      } else {
        await client.query('UPDATE certification_attempts SET answers=$1 WHERE id=$2', [JSON.stringify(answers), a.id]);
      }
      await client.query('COMMIT');
      if (result.finished) result.status = await computeStatus(userId);
      res.json(result);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Certification answer error:', e);
      res.status(500).json({ error: 'Server error' });
    } finally {
      client.release();
    }
  });

  // ── Admin: everyone's certification status, and unlocking attempts ──
  app.get('/api/admin/certifications', requireRole('admin'), async (req, res) => {
    try {
      const users = await pool.query(
        `SELECT u.id, u.full_name, u.email, u.role, c.name AS center_name
           FROM users u LEFT JOIN centers c ON c.id = u.center_id
          WHERE u.active=TRUE AND (u.role='mentor'
             OR u.id IN (SELECT user_id FROM certification_attempts))
          ORDER BY c.name NULLS LAST, u.full_name`
      );
      const rows = [];
      for (const u of users.rows) {
        rows.push({ ...u, status: await computeStatus(u.id) });
      }
      res.json(rows);
    } catch (e) {
      console.error('Admin certifications error:', e);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── Director: certification status for the mentors at their own center ──
  app.get('/api/director/certifications', requireRole('program_director'), async (req, res) => {
    const users = await pool.query(
      `SELECT id, full_name, email FROM users
        WHERE center_id=$1 AND role='mentor' AND active=TRUE ORDER BY full_name`,
      [req.effectiveCenterId]
    );
    const rows = [];
    for (const u of users.rows) rows.push({ ...u, status: await computeStatus(u.id) });
    res.json(rows);
  });

  app.post('/api/admin/certifications/:userId/unlock', requireRole('admin'), async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const u = await pool.query('SELECT id FROM users WHERE id=$1', [userId]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await pool.query('INSERT INTO certification_unlocks (user_id, unlocked_by) VALUES ($1, $2)', [userId, req.session.userId]);
    res.json({ success: true, status: await computeStatus(userId) });
  });

  return { initTables };
}

module.exports = { register, pickScenarios, loadCurriculum, PASS_SCORE, QUESTIONS_PER_TEST };
