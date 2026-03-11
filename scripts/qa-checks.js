#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PAGES = ['index.html', 'docs.html', 'dashboard.html'];
const STATIC_REQUIRED = ['style.css', 'static/og.jpg'];

const routeToFile = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/docs': 'docs.html',
  '/docs.html': 'docs.html',
  '/dashboard': 'dashboard.html',
  '/dashboard.html': 'dashboard.html',
};

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function listIds(html) {
  const ids = [];
  const re = /\sid=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) ids.push(m[1]);
  return ids;
}

function findLinks(html) {
  const links = [];
  const re = /<(?:a|link)[^>]+(?:href)=["']([^"']+)["'][^>]*>/g;
  let m;
  while ((m = re.exec(html))) links.push(m[1]);
  return links;
}

function stripScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

function hasMeta(html, matcher) {
  return matcher.test(html);
}

function checkStatic() {
  const errors = [];
  for (const file of STATIC_REQUIRED) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push(`Missing required asset: ${file}`);
    }
  }
  return errors;
}

function checkHtmlLite() {
  const errors = [];
  for (const page of PAGES) {
    const html = read(page);

    if (!/^<!DOCTYPE html>/i.test(html.trimStart())) {
      errors.push(`${page}: Missing or invalid DOCTYPE`);
    }
    if (!/<html[^>]*\slang=["']en["']/i.test(html)) {
      errors.push(`${page}: Missing <html lang="en">`);
    }
    if (!/<title>[^<]+<\/title>/i.test(html)) {
      errors.push(`${page}: Missing <title>`);
    }
    if (!/<meta\s+name=["']description["'][^>]+content=["'][^"']{30,}["']/i.test(html)) {
      errors.push(`${page}: Missing useful meta description`);
    }
    if (!/<h1[\s>]/i.test(html)) {
      errors.push(`${page}: Missing <h1>`);
    }

    const ids = listIds(html);
    const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dupe) errors.push(`${page}: Duplicate id="${dupe}"`);
  }
  return errors;
}

function checkSeoMeta() {
  const errors = [];
  for (const page of PAGES) {
    const html = read(page);

    const required = [
      [/rel=["']canonical["']/i, 'canonical link'],
      [/property=["']og:title["']/i, 'og:title'],
      [/property=["']og:description["']/i, 'og:description'],
      [/property=["']og:type["']/i, 'og:type'],
      [/property=["']og:url["']/i, 'og:url'],
      [/property=["']og:image["']/i, 'og:image'],
      [/name=["']twitter:card["']/i, 'twitter:card'],
      [/name=["']twitter:title["']/i, 'twitter:title'],
      [/name=["']twitter:description["']/i, 'twitter:description'],
      [/name=["']twitter:image["']/i, 'twitter:image'],
    ];

    for (const [matcher, label] of required) {
      if (!hasMeta(html, matcher)) {
        errors.push(`${page}: Missing ${label}`);
      }
    }
  }
  return errors;
}

function resolveRoute(href, sourcePage) {
  if (href.startsWith('#')) return { page: sourcePage, hash: href.slice(1) };
  if (!href.startsWith('/')) {
    if (/\.(?:css|js|jpg|jpeg|png|svg|webp|ico)$/i.test(href)) {
      return { asset: href, page: null, hash: '' };
    }
    href = href.startsWith('./') ? href.slice(1) : `/${href}`;
  }
  const [pathname, hash = ''] = href.split('#');
  const clean = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const target = routeToFile[clean] || routeToFile[`${clean}.html`];
  return { page: target || null, hash };
}

function checkLinks() {
  const errors = [];
  const pageIds = {};
  for (const page of PAGES) pageIds[page] = new Set(listIds(stripScripts(read(page))));

  for (const page of PAGES) {
    const html = stripScripts(read(page));
    const links = findLinks(html);

    for (const href of links) {
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:')) {
        continue;
      }

      if (href.startsWith('/static/') || href === '/style.css') {
        const localPath = href.replace(/^\//, '');
        if (!fs.existsSync(path.join(ROOT, localPath))) {
          errors.push(`${page}: Broken asset link ${href}`);
        }
        continue;
      }

      const resolved = resolveRoute(href, page);
      if (resolved.asset) {
        if (!fs.existsSync(path.join(ROOT, resolved.asset.replace(/^\//, '')))) {
          errors.push(`${page}: Broken asset link ${href}`);
        }
        continue;
      }
      if (!resolved.page) {
        errors.push(`${page}: Broken internal route ${href}`);
        continue;
      }

      if (!fs.existsSync(path.join(ROOT, resolved.page))) {
        errors.push(`${page}: Route points to missing file ${href} -> ${resolved.page}`);
        continue;
      }

      if (resolved.hash && !pageIds[resolved.page].has(resolved.hash)) {
        errors.push(`${page}: Missing anchor target ${href}`);
      }
    }
  }

  return errors;
}

async function waitForServer(url, ms = 7000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start in ${ms}ms`);
}

async function runSmoke() {
  const errors = [];
  const warnings = [];
  let canBoot = true;
  try {
    require.resolve('express', { paths: [ROOT] });
    require.resolve('better-sqlite3', { paths: [ROOT] });
    require.resolve('multer', { paths: [ROOT] });
  } catch (err) {
    canBoot = false;
    warnings.push('Smoke checks skipped: runtime dependencies are not installed (run npm install).');
  }
  if (!canBoot) return { errors, warnings };

  const port = Number(process.env.QA_PORT || 4310);
  const base = `http://127.0.0.1:${port}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-qa-'));
  const env = {
    ...process.env,
    PORT: String(port),
    DB_PATH: path.join(tmpRoot, 'db.sqlite'),
    SITES_DIR: path.join(tmpRoot, 'sites'),
  };

  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });

  try {
    await waitForServer(`${base}/api/health`);

    const checks = [
      ['GET', '/', 200],
      ['GET', '/docs', 200],
      ['GET', '/dashboard', 200],
      ['GET', '/api/health', 200],
      ['GET', '/api/stats', 200],
      ['GET', '/static/og.jpg', 200],
    ];

    for (const [method, route, expect] of checks) {
      const res = await fetch(`${base}${route}`, { method });
      if (res.status !== expect) {
        errors.push(`Smoke ${method} ${route}: expected ${expect}, got ${res.status}`);
      }
    }

    const uploadRes = await fetch(`${base}/api/upload`, {
      method: 'POST',
      headers: {
        'x-api-key': 'pages_agent_Kx9mR4pQ3w',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: [{ path: 'index.html', content: Buffer.from('<h1>qa</h1>').toString('base64') }],
      }),
    });

    if (uploadRes.status !== 200) {
      errors.push(`Smoke POST /api/upload failed with status ${uploadRes.status}`);
    }
  } finally {
    child.kill('SIGTERM');
  }

  return { errors, warnings };
}

(async function main() {
  const allErrors = [];
  const allWarnings = [];

  allErrors.push(...checkStatic());
  allErrors.push(...checkHtmlLite());
  allErrors.push(...checkSeoMeta());
  allErrors.push(...checkLinks());
  const smoke = await runSmoke();
  allErrors.push(...smoke.errors);
  allWarnings.push(...smoke.warnings);

  if (allErrors.length) {
    console.error('QA checks failed:\n');
    for (const err of allErrors) console.error(`- ${err}`);
    if (allWarnings.length) {
      console.error('\nQA warnings:\n');
      for (const warning of allWarnings) console.error(`- ${warning}`);
    }
    process.exit(1);
  }

  if (allWarnings.length) {
    console.log('QA warnings:');
    for (const warning of allWarnings) console.log(`- ${warning}`);
  }
  console.log('QA checks passed.');
})();
