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
  PAGE_ACCESS_TOKEN,   // Instagram User access token (from "API setup with Instagram login")
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
    // Instagram API with Instagram Login uses the graph.instagram.com host.
    const url = `https://graph.instagram.com/v21.0/${senderId}?fields=name,username`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${PAGE_ACCESS_TOKEN}` },
    });
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

  // Instagram API with Instagram Login: base host is graph.instagram.com, and the
  // Instagram User Access Token is passed as a Bearer token, not a query param.
  const url = 'https://graph.instagram.com/v21.0/me/messages';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PAGE_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
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

// ---------- Privacy Policy (required by Meta before an app can be published) ----------
app.get('/privacy', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Privacy Policy</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #222; }
    h1 { font-size: 1.6em; }
    h2 { font-size: 1.15em; margin-top: 1.8em; }
    footer { margin-top: 3em; font-size: 0.9em; color: #666; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p>This page explains how we handle information when you send a direct message (DM) to our
  Instagram business account, and how our automated reply system processes that information.</p>

  <h2>What we collect</h2>
  <p>When you DM us on Instagram, we receive and may store: your Instagram-assigned sender ID,
  your Instagram name or username (if available via the Instagram API), and the text content of
  the message(s) you send us.</p>

  <h2>How we use it</h2>
  <p>We use this information to: (1) send you an automatic acknowledgement reply once per
  conversation, and (2) create or update a customer enquiry record in our internal CRM system so
  a member of our team can follow up with you. We do not use your information for advertising,
  and we do not sell or rent it to third parties.</p>

  <h2>Where it's stored</h2>
  <p>Your enquiry (name/username, Instagram ID, and message notes) is stored in our internal CRM,
  accessible only to our own team. A small technical log (to avoid sending you the automated
  reply more than once) is kept on our hosting provider's servers.</p>

  <h2>Sharing</h2>
  <p>We do not share your DM content or Instagram profile information with any third party,
  except the service providers that host our CRM and this automation (acting only on our
  instructions, and not for their own purposes).</p>

  <h2>Data retention & your choices</h2>
  <p>We keep enquiry records for as long as reasonably needed to respond to you and maintain our
  business records. If you'd like your information deleted or have any questions about this
  policy, contact us using the details below.</p>

  <h2>Contact</h2>
  <p>Email: <a href="mailto:coffee@marklix.in">coffee@marklix.in</a></p>

  <footer>Last updated: ${new Date().toISOString().slice(0, 10)}</footer>
</body>
</html>`);
});

app.listen(Number(PORT), () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Auto-reply text: "${REPLY_TEXT}"`);
});
