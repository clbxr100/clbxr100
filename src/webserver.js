// Tiny HTTP framework replacing Express: static files + JSON routes.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

function createApp({ staticDir }) {
  const routes = new Map(); // 'METHOD /path' -> handler(req, res)

  function route(method, urlPath, handler) {
    routes.set(`${method} ${urlPath}`, handler);
  }

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  function serveStatic(req, res, pathname) {
    const safe = path.normalize(pathname).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(staticDir, safe || 'index.html');
    if (!filePath.startsWith(staticDir)) return sendJson(res, 403, { error: 'Forbidden' });
    fs.stat(filePath, (err, st) => {
      if (!err && st.isDirectory()) filePath = path.join(filePath, 'index.html');
      fs.readFile(filePath, (err2, data) => {
        if (err2) {
          // SPA fallback: unknown non-API paths get the app shell.
          if (!pathname.startsWith('/api/')) {
            return fs.readFile(path.join(staticDir, 'index.html'), (err3, shell) => {
              if (err3) return sendJson(res, 404, { error: 'Not found' });
              res.writeHead(200, { 'Content-Type': MIME['.html'] });
              res.end(shell);
            });
          }
          return sendJson(res, 404, { error: 'Not found' });
        }
        const ext = path.extname(filePath).toLowerCase();
        // App code must never be stale after a deploy — the game is tiny,
        // so html/js/css are always revalidated; only media gets cached.
        const fresh = ['.html', '.js', '.mjs', '.css'].includes(ext);
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': fresh ? 'no-cache' : 'max-age=86400',
        });
        res.end(data);
      });
    });
  }

  function readBody(req, limit = 64 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (chunks.length === 0) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error('Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const handler = routes.get(`${req.method} ${url.pathname}`);
    if (handler) {
      try {
        req.query = url.searchParams;
        req.body = req.method === 'POST' ? await readBody(req) : {};
        await handler(req, res, { sendJson: (status, obj) => sendJson(res, status, obj) });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.message || 'Server error' });
      }
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
    sendJson(res, 404, { error: 'Not found' });
  });

  return { server, route, sendJson };
}

module.exports = { createApp };
