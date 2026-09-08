// server.js
// Instagram DM auto-reply bot.
// Sends ONE fixed reply to anyone who DMs your Instagram account, once per conversation
// (won't spam the same person again until RESET_HOURS have passed since their last reply).

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const { shouldReply, markReplied, getDealId, setDealId } = require('./store');
const crm = require('./crm');

const {
  VERIFY_TOKEN,        // any string you make up — must match what you enter in the Meta App Dashboard
  APP_SECRET,          // from Meta App Dashboard > Settings > Basic > App Secret
  PAGE_ACCESS_TOKEN,   // Page access token for the Facebook Page linked to your Instagram account
  AUTO_REPLY_TEXT,     // the fixed message to send
  RESET_HOURS = '24',  // how long before the same person can get the auto-reply again
  PORT = '3000',
} = process.env;

const DEFAULT_REPLY =
  "Hey! 👋 Thanks for reaching out to Marklix! We've got your message and someone from our team will get back to you shortly. Talk soon! 🚀";

const REPLY_TEXT = AUTO_REPLY_TEXT && AUTO_REPLY_TEXT.trim() ? AUTO_REPLY_TEXT : DEFAULT_REPLY;

const app = express();

// IMPORTANT: we need the raw body to verify Meta's signature, so we capture it here.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---------- 1. Webhook verification (Meta calls this once when you click "Verify and Save") ----------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully.');
    return res.status(200).send(challenge);
  }
  console.warn('Webhook verification failed. Check VERIFY_TOKEN matches the dashboard.');
  return res.sendStatus(403);
});

// ---------- 2. Signature check (make sure the request really came from Meta) ----------
function isValidSignature(req) {
  if (!APP_SECRET) return true; // allow running without it in local/dev testing, but set this in production
  const signature = req.get('x-hub-signature-256');
  if (!signature) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---------- 3. Incoming DM events ----------
app.post('/webhook', async (req, res) => {
  // Always respond 200 fast so Meta doesn't retry/backoff on you.
  res.sendStatus(200);

  if (!isValidSignature(req)) {
    console.warn('Invalid signature on incoming webhook request — ignoring.');
    return;
  }

  const body = req.body;
  if (body.object !== 'instagram') return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      try {
        await handleMessagingEvent(event);
      } catch (err) {
        console.error('Error handling messaging event:', err);
      }
    }
  }
});

async function handleMessagingEvent(event) {
  const senderId = event.sender && event.sender.id;
  const message = event.message;

  if (!senderId || !message) return;
  if (message.is_echo) return; // ignore messages your own account sent
  if (message.is_deleted) return;

  const messageText = message.text || '';

  // 1. Push this message into the CRM as a lead, regardless of the auto-reply cooldown.
  await recordLeadInCrm(senderId, messageText);

  // 2. Auto-reply, but only once per conversation window (avoid spamming the same person).
  const resetHours = Number(RESET_HOURS) || 24;
  if (!shouldReply(senderId, resetHours)) {
    console.log(`Already replied to ${senderId} within the last ${resetHours}h — skipping reply.`);
    return;
  }

  await sendReply(senderId, REPLY_TEXT);
  markReplied(senderId);
}

async function fetchSenderName(senderId) {
  if (!PAGE_ACCESS_TOKEN) return '';
  try {
    const url = `https://graph.facebook.com/v19.0/${senderId}?fields=name,username&access_token=${encodeURIComponent(
      PAGE_ACCESS_TOKEN
    )}`;
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return '';
    return data.name || data.username || '';
  } catch (err) {
    console.error('Could not fetch Instagram sender profile:', err.message);
    return '';
  }
}

async function recordLeadInCrm(senderId, messageText) {
  if (!crm.crmConfigured()) return; // CRM env vars not set — skip silently

  try {
    const existingDealId = getDealId(senderId);

    if (existingDealId) {
      await crm.addFollowUpNote(existingDealId, messageText);
      console.log(`Added follow-up note to CRM enquiry ${existingDealId} for ${senderId}`);
      return;
    }

    const name = await fetchSenderName(senderId);
    const dealId = await crm.createEnquiry({ name, senderId, messageText });
    setDealId(senderId, dealId);
    console.log(`Created CRM enquiry ${dealId} for ${senderId}`);
  } catch (err) {
    console.error('Failed to record lead in CRM:', err.message);
  }
}

async function sendReply(recipientId, text) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error('PAGE_ACCESS_TOKEN is not set — cannot send reply.');
    return;
  }

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(
    PAGE_ACCESS_TOKEN
  )}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('Failed to send Instagram reply:', resp.status, data);
  } else {
    console.log(`Auto-reply sent to ${recipientId}`);
  }
}

// ---------- Health check ----------
app.get('/', (_req, res) => res.send('IG DM auto-reply bot is running.'));

app.listen(Number(PORT), () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Auto-reply text: "${REPLY_TEXT}"`);
});
