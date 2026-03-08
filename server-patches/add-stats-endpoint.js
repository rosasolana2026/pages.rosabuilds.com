// server-patches/add-stats-endpoint.js
// ============================================================
// Patch for server.js — enhanced stats + /api/pages endpoints
// Apply by adding these routes BEFORE the catch-all static server
// ============================================================
//
// Replace the existing GET /api/stats handler with this:
//
// Track server start time for uptime reporting
const SERVER_START = Date.now();

// GET /api/stats — public, enhanced version
// Returns: { total_deploys, pages_live, uptime_seconds }
app.get('/api/stats', (req, res) => {
  const { total } = db.prepare('SELECT COUNT(*) as total FROM sites').get();
  const uptime_seconds = Math.floor((Date.now() - SERVER_START) / 1000);
  res.json({
    total_deploys: total,
    pages_live: total,          // same as total until TTL cleanup is implemented
    uptime_seconds,
    // legacy field for backwards compat
    sites: total,
  });
});

// GET /api/pages — list deployed pages (auth required)
// Alias for /api/sites with richer metadata
app.get('/api/pages', requireAuth, (req, res) => {
  const sites = db.prepare(
    'SELECT * FROM sites WHERE api_key=? ORDER BY created_at DESC'
  ).all(req.apiKey);

  res.json(sites.map(s => ({
    id: s.id,
    url: `https://${s.id}.pages.rosabuilds.com`,
    file_count: s.file_count,
    size_bytes: s.size_bytes,
    size_kb: Math.round((s.size_bytes || 0) / 1024 * 10) / 10,
    created_at: s.created_at,
    updated_at: s.updated_at,
    created_iso: s.created_at ? new Date(s.created_at * 1000).toISOString() : null,
  })));
});

// DELETE /api/pages/:id — remove a page (auth required)
// Alias for /api/sites/:id DELETE
app.delete('/api/pages/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const site = db.prepare('SELECT * FROM sites WHERE id=?').get(id);
  if (!site) return res.status(404).json({ error: 'Page not found' });
  if (site.api_key !== req.apiKey && req.apiKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  removeSiteDir(id);
  db.prepare('DELETE FROM sites WHERE id=?').run(id);
  res.json({ success: true, id });
});
