'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3004;
const SITES_DIR = process.env.SITES_DIR || '/var/www/pages-sites';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'db.sqlite');
const ADMIN_KEY = 'pages_admin_9mK3xQ7pR2w';
const AGENT_KEY = 'pages_agent_Kx9mR4pQ3w';

// Ensure directories exist
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(SITES_DIR, { recursive: true });

// Database setup
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    file_count INTEGER DEFAULT 0,
    size_bytes INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
`);

// Seed default keys
db.prepare('INSERT OR IGNORE INTO api_keys (key, name) VALUES (?, ?)').run(ADMIN_KEY, 'admin');
db.prepare('INSERT OR IGNORE INTO api_keys (key, name) VALUES (?, ?)').run(AGENT_KEY, 'default-agent');

// Middleware
app.use(express.json({ limit: '50mb' }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key, content-type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Auth middleware
function requireAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing x-api-key header' });
  const row = db.prepare('SELECT key FROM api_keys WHERE key = ?').get(key);
  if (!row) return res.status(401).json({ error: 'Invalid API key' });
  req.apiKey = key;
  next();
}

// Generate 8-char hex ID
function genId() {
  return crypto.randomBytes(4).toString('hex');
}

// Sanitize file paths to prevent traversal
function sanitizePath(p) {
  const normalized = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  return normalized.startsWith('/') ? normalized.slice(1) : normalized;
}

// Write files to site directory
function writeFiles(siteId, files) {
  const siteDir = path.join(SITES_DIR, siteId);
  fs.mkdirSync(siteDir, { recursive: true });
  let totalSize = 0;
  for (const f of files) {
    const safePath = sanitizePath(f.path || f.originalname || 'index.html');
    const filePath = path.join(siteDir, safePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const buf = Buffer.from(f.content, 'base64');
    fs.writeFileSync(filePath, buf);
    totalSize += buf.length;
  }
  return { fileCount: files.length, sizeBytes: totalSize };
}

function removeSiteDir(siteId) {
  fs.rmSync(path.join(SITES_DIR, siteId), { recursive: true, force: true });
}

// Multer for multipart uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Extract files from request (multipart or JSON)
function extractFiles(req) {
  if (req.files && req.files.length > 0) {
    return req.files.map(f => ({
      path: f.originalname,
      content: f.buffer.toString('base64'),
    }));
  }
  if (req.body && Array.isArray(req.body.files)) {
    return req.body.files;
  }
  return null;
}

// POST /api/upload
app.post('/api/upload', requireAuth, upload.any(), (req, res) => {
  try {
    const files = extractFiles(req);
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided. Use JSON {files:[{path,content}]} or multipart.' });
    }
    const id = genId();
    const { fileCount, sizeBytes } = writeFiles(id, files);
    db.prepare('INSERT INTO sites (id, api_key, file_count, size_bytes) VALUES (?, ?, ?, ?)').run(id, req.apiKey, fileCount, sizeBytes);
    res.json({ url: `https://${id}.pages.rosabuilds.com`, id });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/update/:id
app.post('/api/update/:id', requireAuth, upload.any(), (req, res) => {
  try {
    const { id } = req.params;
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (site.api_key !== req.apiKey && req.apiKey !== ADMIN_KEY) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const files = extractFiles(req);
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }
    removeSiteDir(id);
    const { fileCount, sizeBytes } = writeFiles(id, files);
    db.prepare('UPDATE sites SET file_count=?, size_bytes=?, updated_at=unixepoch() WHERE id=?').run(fileCount, sizeBytes, id);
    res.json({ url: `https://${id}.pages.rosabuilds.com`, id });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites
app.get('/api/sites', requireAuth, (req, res) => {
  const sites = db.prepare('SELECT * FROM sites WHERE api_key=? ORDER BY created_at DESC').all(req.apiKey);
  res.json(sites.map(s => ({
    id: s.id,
    url: `https://${s.id}.pages.rosabuilds.com`,
    file_count: s.file_count,
    size_bytes: s.size_bytes,
    created_at: s.created_at,
    updated_at: s.updated_at,
  })));
});

// DELETE /api/sites/:id
app.delete('/api/sites/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const site = db.prepare('SELECT * FROM sites WHERE id=?').get(id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (site.api_key !== req.apiKey && req.apiKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  removeSiteDir(id);
  db.prepare('DELETE FROM sites WHERE id=?').run(id);
  res.json({ success: true });
});

// GET /api/health
app.get('/api/health', (req, res) => {
  const { c } = db.prepare('SELECT COUNT(*) as c FROM sites').get();
  res.json({ status: 'ok', sites: c });
});

// GET /api/stats (public)
app.get('/api/stats', (req, res) => {
  const { c } = db.prepare('SELECT COUNT(*) as c FROM sites').get();
  res.json({ sites: c });
});

// Clean URL routes
app.get('/docs', (req, res) => res.sendFile(path.join(__dirname, 'docs.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

// Static files (index.html, style.css, etc.)
app.use(express.static(__dirname, { index: 'index.html' }));

app.listen(PORT, () => {
  console.log(`pages-rosabuilds running on port ${PORT}`);
  console.log(`Sites dir: ${SITES_DIR}`);
  console.log(`DB: ${DB_PATH}`);
});
