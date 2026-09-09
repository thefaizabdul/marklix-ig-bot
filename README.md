# Instagram DM Auto-Reply Bot — Marklix

Sends one fixed welcome message to anyone who DMs your Instagram account. Same message
for everyone, sent once per conversation (won't repeat itself to the same person for
24 hours by default — configurable).

## What you need before you start

- Your Instagram account must be a **Professional (Business/Creator) account**, linked
  to a **Facebook Page**.
- Your Meta app **"Marklix"** (App ID `1355801803388028`) — you already have this.
- A place to host this code so Meta can reach it over the internet (steps below use
  [Render](https://render.com), free tier works fine for this).

---

## Step 1 — Deploy the code to Render

1. Go to [render.com](https://render.com) and sign up / log in (you can use GitHub login).
2. Push this folder to a new GitHub repo (or use Render's "Deploy from a public Git
   repo" if you upload it there some other way).
3. In Render: **New > Web Service** → connect the repo.
4. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free is fine to start.
5. Under **Environment**, add these variables (leave `PAGE_ACCESS_TOKEN` blank for now,
   you'll get it in Step 3):
   - `VERIFY_TOKEN` → make up any random string, e.g. `marklix_verify_8x92`
   - `APP_SECRET` → from Step 2 below
   - `PAGE_ACCESS_TOKEN` → from Step 3 below
   - `AUTO_REPLY_TEXT` → your message (optional — a good default is already built in)
   - `RESET_HOURS` → `24` (or whatever you prefer)
6. Deploy. Once live, note your public URL, e.g. `https://marklix-ig-bot.onrender.com`.

---

## Step 2 — Get your App Secret

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → open
   **Marklix**.
2. Left sidebar → **App settings > Basic**.
3. Copy the **App Secret** (click "Show", you may need to re-enter your Facebook
   password). Paste it into Render as `APP_SECRET`, then redeploy.

---

## Step 3 — Connect Instagram + get an access token

This bot uses the newer **Instagram API with Instagram Login** (not the older
Page-linked Messenger flow), so everything happens under the Instagram API use case:

1. In the Marklix app dashboard → **Use cases** → **Instagram API** → **Customize**.
2. Under **"1. Add required messaging permissions"**, make sure these are added:
   `instagram_business_basic`, `instagram_business_manage_comments`,
   `instagram_business_manage_messages`.
3. Under **App roles > Roles**, add the Instagram account (e.g. `planwedsee`) as an
   **Instagram tester**. That account then has to accept the invite — note that this
   often does **not** show up in the Instagram mobile app; accept it instead at
   [instagram.com/accounts/manage_access](https://www.instagram.com/accounts/manage_access/)
   (Edit profile → Apps and websites → **Tester invitations** tab → Approve).
4. Back in **API setup with Instagram login**, under **"2. Generate access tokens"**,
   click **Add account**, then **Generate token** next to the account. This opens an
   Instagram login/consent popup — log in as that account and click **Allow**.
5. Copy the resulting **Instagram User access token** (starts with `IGAA...`) into
   Render as `PAGE_ACCESS_TOKEN`, then redeploy. This token is a short-lived Business
   Login token (~1 hour) unless generated as a long-lived token from the App
   Dashboard flow (60 days) — plan to refresh it periodically.
6. Also toggle **Webhook Subscription** to **On** for that account in the same table.

> Note: while your app is in "Development" mode, messaging only works for accounts
> added as Instagram Testers under **App roles > Roles**. To DM-auto-reply for
> *anyone* who messages you, you'll need to submit the app for **App Review**
> (requesting `instagram_business_manage_messages`) and switch the app to **Live**
> mode. Meta reviews this fairly quickly for straightforward use cases — you'll need
> a short screen recording showing the bot working, which I can help you script.

Under the hood, `server.js` talks to `graph.instagram.com` (not
`graph.facebook.com`) and sends the access token as an `Authorization: Bearer`
header — that's specific to this Instagram-Login-based token type, so if you ever
regenerate a token make sure it's this same kind (starts with `IGAA`).

---

## Step 4 — Set up the Webhook

1. In the Marklix app dashboard → **Webhooks** (left sidebar).
2. Choose **Instagram** as the object.
3. Click **Subscribe to this object** and enter:
   - **Callback URL:** `https://YOUR-RENDER-URL/webhook`
   - **Verify token:** the exact same string you set as `VERIFY_TOKEN` in Render.
4. Click **Verify and Save** — if it fails, double check the Render service is live
   and the verify token matches exactly.
5. Subscribe to the **messages** field.

---

## Step 5 — Test it

1. From a different Instagram account (or ask a friend), send your business account
   a DM.
2. Within a few seconds you should get the fixed auto-reply back.
3. Send a second message right after — you should **not** get a second reply (that's
   the once-per-conversation logic working). Wait past `RESET_HOURS` and message again
   to confirm it replies again.
4. Check your Render logs (**Logs** tab) to see request activity and catch any errors.

---

## Changing the reply text later

Just update the `AUTO_REPLY_TEXT` environment variable in Render and redeploy —
no code changes needed.

---

## Step 6 — CRM integration (Vowframe, crm.marklix.in)

Every DM now also creates or updates an **Enquiry** in your Vowframe CRM automatically —
no separate setup beyond three environment variables:

- `CRM_SITE_URL` → `https://crm.marklix.in`
- `CRM_USERNAME` → the WordPress username the Application Password belongs to (e.g. `fyzoomedia`)
- `CRM_APP_PASSWORD` → the Application Password generated under that user's
  **Profile > Application Passwords** (looks like `abcd 1234 efgh 5678 ijkl 9012`)

Add these three in Render's Environment tab and redeploy. Leave them blank if you ever
want to turn CRM saving off — the bot will just skip that step silently.

How it behaves:

- **First DM from someone** → looks up their Instagram profile name (via the Graph API),
  then creates a new Enquiry with source "Instagram", stage "New Enquiry", status "Warm",
  and a note containing their message.
- **Any later DM from the same person** → adds a note to their *existing* Enquiry instead
  of creating a duplicate — so their conversation stays as one clean thread in the CRM.
- Phone and email are left blank on the enquiry (a DM doesn't hand those over automatically)
  — whoever follows up fills those in once they get them.
- The enquiry is created under the `fyzoomedia` account, which has full Admin access, so
  it's visible to your whole team in the shared Enquiries list, not just one person.

This was tested locally against a mock server (see `test/mock-crm.js`) to confirm the
authentication and request format are correct before wiring it to the real CRM — you don't
need to do anything with that file, it's just for reference.

## Files in this project

- `server.js` — the webhook server (verification, signature check, sending replies, CRM hook).
- `store.js` — tiny file-based tracker: last-replied time per sender, and their CRM Enquiry ID.
- `crm.js` — talks to the Vowframe CRM's REST API to create/update Enquiries.
- `.env.example` — template for local testing (copy to `.env`, never commit the real one).
- `package.json` — dependencies (`express`, `dotenv`, `node-fetch`).
- `test/mock-crm.js` — a fake CRM server used to verify `crm.js` works, without touching your real site.

## Running locally (optional, for testing before deploying)

```bash
npm install
cp .env.example .env   # then fill in your real values
npm start
```

You'll need a tool like [ngrok](https://ngrok.com) to expose `localhost:3000` to the
internet temporarily if you want Meta to reach your local machine during testing.
