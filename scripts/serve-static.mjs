/**
 * Static file server for the ConfluenceX dashboard on Render.
 *
 * Replaces `npx serve -s dist -l 10000`. Two reasons:
 *
 *   1. Security headers. `serve` has no configuration surface for response
 *      headers, so the deployed site was shipping with no CSP, no HSTS,
 *      no X-Frame-Options and no X-Content-Type-Options. On a fintech
 *      product that is a real gap.
 *   2. `serve` is a devDependency. Render installs devDependencies during
 *      build, so this worked, but it tied production to a build-time-only
 *      package.
 *
 * Deliberately dependency-free (Node stdlib only) so it has no install
 * surface of its own. Port comes from PORT, defaulting to 10000 to match
 * the previous command.
 *
 * Usage: node scripts/serve-static.mjs [dist-dir]
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] || 'dist');
const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Baseline security headers.
 *
 * `script-src` keeps 'unsafe-inline' because index.html ships an inline
 * boot-splash <script>/<style> block that must run before the React bundle
 * loads. Moving that inline block to an external file and dropping
 * 'unsafe-inline' is the follow-up; it is tracked rather than done here so
 * this change cannot blank the app on deploy.
 *
 * 'wasm-unsafe-eval' is required by lightweight-charts / the chart WASM
 * bundle. connect-src covers the BWTS API plus the market-data and auth
 * origins the dashboard actually calls.
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // SPA + PWA shell needs workers; chart rendering may use blob workers.
    "worker-src 'self' blob:",
    "connect-src 'self' https://traderslounge-bwts-api.onrender.com https://api.twelvedata.com https://api.binance.com https://api.coingecko.com https://s.tradingview.com wss://traderslounge-bwts-api.onrender.com",
    "frame-src 'self' https://s.tradingview.com https://*.tradingview.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/** Hashed assets are immutable; HTML must never be cached stale. */
function cacheControl(pathname) {
  if (pathname === '/' || pathname.endsWith('.html')) {
    return 'no-cache, must-revalidate';
  }
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (pathname === '/sw.js' || pathname === '/manifest.json') {
    return 'no-cache, must-revalidate';
  }
  return 'public, max-age=3600';
}

function applyHeaders(res, pathname) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader('Cache-Control', cacheControl(pathname));
}

/** Resolve a URL path to a file inside ROOT, or null if it escapes/traverses. */
function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(join(ROOT, normalize(decoded)));
  // Directory-traversal guard: the resolved path must stay under ROOT.
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

if (!existsSync(ROOT)) {
  console.error(`[serve-static] build output not found: ${ROOT}`);
  process.exit(1);
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  const { pathname } = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  let file = resolveFile(pathname);
  let served = pathname;

  // SPA fallback: any unknown non-asset route renders the app shell so
  // client-side routing works on a hard refresh or a shared deep link.
  if (!file) {
    if (pathname.startsWith('/assets/') || extname(pathname) === '') {
      file = resolveFile('/index.html');
      served = '/index.html';
    }
  }

  if (!file) {
    applyHeaders(res, pathname);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  applyHeaders(res, served);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`[serve-static] serving ${ROOT} on http://${HOST}:${PORT}`);
});
