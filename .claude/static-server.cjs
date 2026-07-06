// Minimal static file server for previewing the app (dev only).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8123;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // Screenshot drop-box: the page POSTs {name, dataURL} and we write the PNG
    // into report/figures/ (dev-only helper for building the report).
    if (req.method === 'POST' && urlPath === '/__shot') {
      let body = '';
      req.on('data', (ch) => (body += ch));
      req.on('end', () => {
        try {
          const { name, dataURL } = JSON.parse(body);
          const safe = String(name).replace(/[^a-z0-9_-]/gi, '');
          const b64 = String(dataURL).split(',')[1];
          const dir = path.join(ROOT, 'report', 'figures');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, safe + '.png'), Buffer.from(b64, 'base64'));
          res.writeHead(200).end('saved ' + safe + '.png');
        } catch (e) {
          res.writeHead(400).end(String(e));
        }
      });
      return;
    }
    let file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
