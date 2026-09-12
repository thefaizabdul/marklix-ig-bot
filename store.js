// store.js
// Tiny file-based tracker: per Instagram sender, whether we've EVER auto-replied
// to them (and, if CRM integration is on) which CRM Enquiry we created for them.
// No database setup needed — good enough for an MVP. Swap for a real DB later if you want.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'leads.json');

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}), 'utf8');
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getSender(senderId) {
  const data = readAll();
  return data[senderId] || null;
}

// Returns true if we should send the auto-reply to this sender right now.
// We send it ONCE EVER per sender: if we've already replied to them at any point
// in the past, we never send it again (no time-based reset).
function shouldReply(senderId) {
  const entry = getSender(senderId);
  return !entry || !entry.lastRepliedAt;
}

function markReplied(senderId) {
  const data = readAll();
  data[senderId] = { ...(data[senderId] || {}), lastRepliedAt: Date.now() };
  writeAll(data);
}

function getDealId(senderId) {
  const entry = getSender(senderId);
  return entry && entry.dealId ? entry.dealId : null;
}

function setDealId(senderId, dealId) {
  const data = readAll();
  data[senderId] = { ...(data[senderId] || {}), dealId };
  writeAll(data);
}

module.exports = { shouldReply, markReplied, getDealId, setDealId };
