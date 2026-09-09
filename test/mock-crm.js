// Mock Vowframe CRM server for local testing (no external network needed).
// Run alongside the bot with matching CRM_USERNAME / CRM_APP_PASSWORD env vars
// (any values work here — this fake server isn't checking against your real CRM).
const http = require('http');

const EXPECTED_USER = process.env.CRM_USERNAME || 'testuser';
const EXPECTED_PASS = process.env.CRM_APP_PASSWORD || 'testpass';
const EXPECTED_AUTH = 'Basic ' + Buffer.from(`${EXPECTED_USER}:${EXPECTED_PASS}`).toString('base64');

let nextId = 501;
const created = [];
const activities = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    console.log(`[mock-crm] ${req.method} ${req.url}`);
    console.log(`[mock-crm] Authorization header matches expected: ${req.headers.authorization === EXPECTED_AUTH}`);

    let json = {};
    try {
      json = JSON.parse(body || '{}');
    } catch {
      // ignore
    }

    if (req.method === 'POST' && req.url === '/wp-json/vowframe/v1/records/deal') {
      const id = nextId++;
      created.push({ id, ...json });
      console.log('[mock-crm] created deal:', JSON.stringify({ id, company: json.company, source: json.source }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, ...json }));
      return;
    }

    const activityMatch = req.url.match(/^\/wp-json\/vowframe\/v1\/records\/deal\/(\d+)\/activity$/);
    if (req.method === 'POST' && activityMatch) {
      const id = Number(activityMatch[1]);
      activities.push({ id, ...json });
      console.log('[mock-crm] added activity to deal', id, ':', json.text);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id }));
      return;
    }

    const updateMatch = req.url.match(/^\/wp-json\/vowframe\/v1\/records\/deal\/(\d+)$/);
    if (req.method === 'POST' && updateMatch) {
      const id = Number(updateMatch[1]);
      const existing = created.find((d) => d.id === id);
      if (existing) Object.assign(existing, json);
      console.log('[mock-crm] updated deal', id, 'with:', JSON.stringify(json));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, ...json }));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });
});

server.listen(4001, () => console.log('[mock-crm] listening on 4001'));
