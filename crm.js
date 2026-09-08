// crm.js
// Pushes Instagram DM leads into the Vowframe CRM (crm.marklix.in) as Enquiries,
// using a WordPress Application Password for auth.

const fetch = require('node-fetch');

const {
  CRM_SITE_URL,        // e.g. https://crm.marklix.in
  CRM_USERNAME,        // WordPress username, e.g. fyzoomedia
  CRM_APP_PASSWORD,    // the "xxxx xxxx xxxx xxxx xxxx xxxx" Application Password
} = process.env;

function crmConfigured() {
  return Boolean(CRM_SITE_URL && CRM_USERNAME && CRM_APP_PASSWORD);
}

function authHeader() {
  const token = Buffer.from(`${CRM_USERNAME}:${CRM_APP_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

function apiUrl(path) {
  return `${CRM_SITE_URL.replace(/\/+$/, '')}/wp-json/vowframe/v1${path}`;
}

async function crmRequest(path, body) {
  const resp = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(`CRM request to ${path} failed (${resp.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Create a new Enquiry (deal) for a first-time Instagram DM sender.
 * Returns the new deal's numeric ID.
 */
async function createEnquiry({ name, senderId, messageText }) {
  const title = name && name.trim() ? name.trim() : `Instagram Lead – ${senderId}`;
  const today = new Date().toISOString().slice(0, 10);

  const deal = await crmRequest('/records/deal', {
    company: title,
    person: name || '',
    phone: '',
    email: '',
    whatsapp: '',
    service: '',
    source: 'Instagram',
    budget: 0,
    value: 0,
    stage: 'new',
    status: 'Warm',
    created: today,
    activities: [
      {
        type: 'note',
        text: messageText ? `Enquiry received via Instagram DM: "${messageText}"` : 'Enquiry received via Instagram DM.',
        date: today,
      },
    ],
  });

  return deal.id;
}

/**
 * Add a follow-up note to an existing Enquiry (for a returning sender).
 */
async function addFollowUpNote(dealId, messageText) {
  const today = new Date().toISOString().slice(0, 10);

  await crmRequest(`/records/deal/${dealId}/activity`, {
    kind: 'note',
    text: `New Instagram DM: "${messageText}"`,
    date: today,
  });
}

module.exports = { crmConfigured, createEnquiry, addFollowUpNote };
