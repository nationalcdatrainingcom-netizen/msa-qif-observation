const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/training', (req, res) => res.sendFile(path.join(__dirname, 'public', 'training.html')));
app.get('/qif', (req, res) => res.sendFile(path.join(__dirname, 'public', 'qif.html')));

app.listen(PORT, () => console.log(`MSA Mentor App running on port ${PORT}`));
