-- ════════════════════════════════════════════════════════════════════
-- MSA Platform v3 — Schema Migration
-- ════════════════════════════════════════════════════════════════════
-- Run this ONCE in the Render database shell BEFORE deploying the new
-- server.js, OR after the first deploy to migrate any existing data.
--
-- This script is IDEMPOTENT — safe to run multiple times. It will not
-- duplicate data, drop your existing QIF observations, or break the
-- live QIF tool.
--
-- What it does:
--   1. Creates the new tables (centers, users, reflections) if they
--      don't already exist. (server.js also does this on startup, so
--      this is belt-and-suspenders.)
--   2. Adds the new user_id column to the existing mentees table so
--      legacy QIF mentees can be linked to login users later.
--   3. Reports any existing data that needs your attention.
--
-- What it does NOT do:
--   - Auto-migrate your existing PIN-based mentors into login users.
--     That requires email addresses, which the old schema didn't store.
--     The report at the end will tell you which existing mentors need
--     to be re-created via the program director UI.
--   - Touch tally_observations, weekly_goals, or mentee_resources.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1. NEW TABLES
-- ────────────────────────────────────────────────────────────────────

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
CREATE INDEX IF NOT EXISTS idx_reflections_lookup
  ON reflections(user_id, reflection_type, week_number, reflection_date);

-- ────────────────────────────────────────────────────────────────────
-- 2. ADD user_id LINK COLUMN TO LEGACY mentees TABLE
-- ────────────────────────────────────────────────────────────────────
-- The mentees table from the old QIF schema stays in place so that
-- existing tally_observations and weekly_goals records continue to work.
-- We just add a column that lets us optionally link a legacy mentee
-- record to a new login user.

ALTER TABLE IF EXISTS mentees
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────────────
-- 3. SAFETY: ENSURE LEGACY QIF TABLES EXIST
-- ────────────────────────────────────────────────────────────────────
-- If this is a brand-new database, these may not exist yet. server.js
-- creates them on startup, but defining them here too means the
-- migration is self-contained.

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
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- POST-MIGRATION REPORT
-- ════════════════════════════════════════════════════════════════════
-- These are read-only queries — they don't change anything. They tell
-- you what's in the database now and what (if anything) needs your
-- attention.

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo 'MIGRATION REPORT'
\echo '════════════════════════════════════════════════════════════'

\echo ''
\echo '── Tables now present ──'
SELECT tablename FROM pg_tables
  WHERE schemaname='public'
    AND tablename IN ('centers','users','reflections','mentors','mentees',
                      'tally_observations','weekly_goals','full_observations',
                      'mentee_resources')
  ORDER BY tablename;

\echo ''
\echo '── User counts by role ──'
SELECT role, COUNT(*) AS count FROM users GROUP BY role ORDER BY role;

\echo ''
\echo '── Legacy PIN-based mentors (no email — must be re-created) ──'
SELECT id, name, created_at FROM mentors ORDER BY id;

\echo ''
\echo '── Legacy mentees (QIF data) ──'
SELECT m.id, m.name, m.classroom,
       (SELECT name FROM mentors WHERE id=m.mentor_id) AS old_mentor,
       (SELECT full_name FROM users WHERE id=m.user_id) AS linked_login_user,
       (SELECT COUNT(*) FROM tally_observations WHERE mentee_id=m.id) AS observation_count
  FROM mentees m
  ORDER BY m.id;

\echo ''
\echo '── Centers ──'
SELECT id, name, mentor_seats, mentee_seats, created_at FROM centers ORDER BY id;

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo 'NEXT STEPS'
\echo '════════════════════════════════════════════════════════════'
\echo '1. Deploy the new server.js and package.json (push to GitHub).'
\echo '2. Wait for Render to redeploy.'
\echo '3. Log in at the home page using the bootstrap admin credentials:'
\echo '     mary@childrenscenterinc.com / msa-admin-2026'
\echo '   (You will be forced to change the password on first login.)'
\echo '4. Create the first center + program director from the admin UI.'
\echo '5. Have the program director log in and add mentor/mentee pairs.'
\echo ''
\echo 'The legacy PIN-based mentors listed above (if any) will NOT be'
\echo 'auto-migrated. If those mentors should keep their QIF history,'
\echo 'have a program director re-create them as login users with the'
\echo 'SAME mentor name, then run a follow-up SQL to link the legacy'
\echo 'mentee records (set mentees.user_id = the new mentor user id).'
\echo '════════════════════════════════════════════════════════════'
