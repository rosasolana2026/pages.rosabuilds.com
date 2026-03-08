# Server Patches

These patches should be applied to the live server at `root@178.156.245.68:/var/www/pages-rosabuilds/server.js`.

## Patch: `add-stats-endpoint.js`

### What it adds

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/stats` | Public | Enhanced: returns `total_deploys`, `pages_live`, `uptime_seconds` |
| `GET /api/pages` | API key | List all deployed pages for your key |
| `DELETE /api/pages/:id` | API key | Remove a page by ID |

### How to apply

**Option A — Manual edit (recommended)**

SSH into the server:

```bash
ssh root@178.156.245.68
cd /var/www/pages-rosabuilds
nano server.js   # or vim
```

1. Add `const SERVER_START = Date.now();` near the top of the file, after the `const` block (around line 15).

2. Find the existing `GET /api/stats` handler (around line 188):
   ```js
   app.get('/api/stats', (req, res) => {
     const { c } = db.prepare('SELECT COUNT(*) as c FROM sites').get();
     res.json({ sites: c });
   });
   ```
   Replace it with the enhanced version from `add-stats-endpoint.js`.

3. Add the `GET /api/pages` and `DELETE /api/pages/:id` routes right after.

4. Save and restart PM2:
   ```bash
   pm2 restart pages-rosabuilds
   pm2 save
   ```

**Option B — Git pull (after committing to main)**

```bash
ssh root@178.156.245.68
cd /var/www/pages-rosabuilds
git pull
npm install --production
pm2 restart pages-rosabuilds
```

### Verify the patch

```bash
# Public stats — no auth needed
curl https://pages.rosabuilds.com/api/stats

# Expected response:
# {"total_deploys":42,"pages_live":42,"uptime_seconds":86400,"sites":42}

# List pages — auth required
curl https://pages.rosabuilds.com/api/pages \
  -H "x-api-key: pages_admin_9mK3xQ7pR2w"
```

### Backwards compatibility

The enhanced `/api/stats` still returns the `sites` field so existing integrations don't break.
