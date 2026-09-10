// Servidor estático mínimo para probar mimar-inteligente/ en local (desktop
// o Android vía chrome://inspect). Necesario porque el módulo usa imports
// relativos que no resuelven al abrir el HTML como archivo file://. Sirve
// la raíz del proyecto tal cual, sin tocar producción.
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PORT = 8935;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/mimar-inteligente/index.html';
  else if (p === '/mimar-inteligente/' || p === '/mimar-inteligente') p = '/mimar-inteligente/index.html';
  const full = path.join(ROOT, p);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});
server.listen(PORT, () => console.log(`Mimar T Inteligente disponible en http://localhost:${PORT}/mimar-inteligente/`));
