const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── PROGRESS STORAGE ──────────────────────────────────────────
// Progress saved to a JSON file on the server.
// Also saved to localStorage on the device as a fallback.
const PROGRESS_FILE = path.join(__dirname, 'progress.json');

function readProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function writeProgress(data) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
  } catch(e) {
    console.error('Could not write progress:', e.message);
  }
}

// GET progress for a user
app.get('/api/progress/:userId', (req, res) => {
  const all = readProgress();
  const user = all[req.params.userId] || { completed: [], current: null };
  res.json(user);
});

// POST (save) progress for a user
app.post('/api/progress/:userId', (req, res) => {
  const all = readProgress();
  all[req.params.userId] = {
    completed: req.body.completed || [],
    current: req.body.current || null,
    lastSaved: new Date().toISOString()
  };
  writeProgress(all);
  res.json({ ok: true });
});

// ── ROUTES ────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/training', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'training.html'));
});

app.get('/qif', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'qif.html'));
});

app.listen(PORT, () => {
  console.log(`MSA Mentor App running on port ${PORT}`);
});
