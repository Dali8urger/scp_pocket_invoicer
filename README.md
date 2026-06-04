# SCP Pocket EA

Pocket secretary for Shane Collins Plumbing. Lets Shane start jobs from his phone, dictate a 90-second voice note when he leaves, and have Claude turn the transcript into a draft invoice that lands in Danielle's inbox for Xero entry.

## What you're deploying

| Component | Purpose |
|---|---|
| Next.js 14 web app | The actual product Shane and Danielle use |
| Postgres database | Jobs, customers, invoices, catalogue, settings |
| Vercel Blob storage | Job photos |
| Anthropic Claude | Voice transcript → structured invoice |
| OpenAI Whisper | Voice recording → text transcript |
| Resend | Magic-link login + draft invoice emails + daily 6pm summary |

Two users, hard-coded by email: `d8urger@gmail.com` (admin) and `shanecollinsplumbing@gmail.com` (operator). Nobody else can sign in even if they get a link.

## Deployment overview

You need a browser. Nothing installed on your machine.

Total time: about 45 minutes the first time, 30 of which is account setup. Roughly:

1. Create 4 third-party accounts (15 min)
2. Get the code onto GitHub (10 min, web upload only)
3. Connect to Vercel and configure (15 min)
4. Initialise the database with one API call (1 min)
5. Test sign-in (3 min)
6. Install to phone home screen (1 min)

---

## Step 1: accounts

Create these. Sign up with `d8urger@gmail.com` for all four. Do NOT generate API keys yet, the keys go straight from each dashboard into Vercel's env vars later.

| Service | URL | Credit needed | Notes |
|---|---|---|---|
| GitHub | github.com | $0 | Hosts the code. Free tier is fine. |
| Vercel | vercel.com | $0 | Hosts the app + database + cron. Free Hobby tier. Sign up using your GitHub account so they're already linked. |
| OpenAI Platform | platform.openai.com | $5 | For Whisper transcription. Settings → Billing → Add credit. |
| Resend | resend.com | $0 | For email. Free tier is 3,000 emails/month. |
| Anthropic Console | console.anthropic.com | confirm $5+ | You already have this. Just check credit balance. |

---

## Step 2: code onto GitHub

You should have a folder called `scp-pocket-ea` unzipped on your computer.

1. Sign in to **github.com**.
2. Click the green **New** button (or visit github.com/new) to create a new repository.
3. Repository name: `scp-pocket-ea`. Set it to **Private**. Do NOT tick any of the "Add a README/.gitignore/license" boxes.
4. Click **Create repository**.
5. On the empty repo page, click **uploading an existing file** (the link in the middle of the page).
6. Drag the **contents** of the unzipped `scp-pocket-ea` folder into the upload area. Do not drag the folder itself, drag everything inside it including the hidden `.gitignore` and `.env.example` files.
   - If your file browser hides dotfiles, make them visible first. On Mac: `Cmd+Shift+.` in Finder. On Windows: View → Hidden items in File Explorer.
7. Commit message: `Initial commit`. Click **Commit changes**.
8. The upload takes about 30 seconds. The repo should now show files like `package.json`, `src/`, `drizzle/`, `public/`.

---

## Step 3: Vercel project

1. Sign in to **vercel.com**. Use the **Continue with GitHub** button.
2. On the dashboard, click **Add New** → **Project**.
3. Find `scp-pocket-ea` in the list of your GitHub repositories and click **Import**.
4. Vercel detects Next.js automatically. Leave Framework Preset as Next.js, leave Root Directory as `./`, leave Build Command and Output Directory as defaults.
5. **Do NOT click Deploy yet.** First we need to add storage and environment variables.
6. Scroll down to **Environment Variables**. We'll come back to this in Step 5.
7. For now click **Deploy**. The first deploy will fail. That's expected because env vars are missing. Wait for the failure (about 2 minutes) then continue.

---

## Step 4: storage (Postgres + Blob)

These have to be added through the Vercel UI because they auto-inject their connection strings as env vars.

### Postgres database

1. In your project dashboard, click the **Storage** tab.
2. Click **Create Database**.
3. Choose **Postgres**. (It's powered by Neon under the hood; that's fine.)
4. Name it `scp-pocket-ea-db`. Region: pick **Sydney (Asia Pacific 1)**.
5. Click **Create**.
6. After a few seconds you'll see a panel showing connection strings. You don't need to copy anything. Vercel automatically links it to your project.
7. Click **Connect Project** if it asks, and tick all three environments (Production, Preview, Development).

### Blob storage

1. Still in the Storage tab, click **Create Database** again.
2. Choose **Blob**.
3. Name it `scp-pocket-ea-photos`.
4. Click **Create**.
5. Tick all three environments when prompted.

After both are created, the env vars `DATABASE_URL`, `POSTGRES_*`, and `BLOB_READ_WRITE_TOKEN` are automatically attached to your project.

---

## Step 5: generate API keys and set environment variables

Now we generate the API keys. Each one is generated in its own dashboard and pasted directly into Vercel. The keys never go anywhere else.

Open your Vercel project → **Settings** → **Environment Variables**. Keep this tab open.

For each row below: open the source URL in a new tab, generate or copy the value, then paste it into Vercel as a new env var. Tick all three environments when adding each one.

### Required keys

| Variable | Where to get it | Notes |
|---|---|---|
| `AUTH_SECRET` | https://generate-secret.vercel.app/32 | Click the button, copy the string. Used to encrypt sessions. |
| `AUTH_URL` | (set after first deploy) | Leave this for now; we'll come back to it. |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API Keys → Create Key | Name the key `scp-pocket-ea-prod`. Copy the `sk-ant-...` value. Save somewhere temporary (password manager). Paste into Vercel. |
| `OPENAI_API_KEY` | platform.openai.com/api-keys → Create new secret key | Name: `scp-pocket-ea-prod`. Permissions: select **Restricted** then enable only **Audio (Write)** and **Models (Read)**. Copy the `sk-proj-...` value. Paste into Vercel. |
| `RESEND_API_KEY` | resend.com → API Keys → Create API Key | Name: `scp-pocket-ea-prod`. Permission: Sending access. Copy the `re_...` value. Paste into Vercel. |
| `RESEND_FROM` | (paste literal text) | `SCP Pocket EA <onboarding@resend.dev>` |
| `ADMIN_EMAIL` | (paste literal text) | `d8urger@gmail.com` |
| `OPERATOR_EMAIL` | (paste literal text) | `shanecollinsplumbing@gmail.com` |
| `CRON_SECRET` | https://generate-secret.vercel.app/32 | Click again for a fresh different string. **Save this one to your password manager.** You'll need it once for database init. |

### IMPORTANT: Resend sender restriction

By default, Resend's free sandbox sender (`onboarding@resend.dev`) only delivers to the email that owns the Resend account. So **with the default config, magic-link emails to `d8urger@gmail.com` will work fine, but emails to `shanecollinsplumbing@gmail.com` will silently fail until you do one of these:**

- **Easy:** In the Resend dashboard, under **Domains** (or under your account settings depending on Resend version), add `shanecollinsplumbing@gmail.com` as a verified test recipient.
- **Proper:** Add a custom domain (e.g. `mail.shanecollinsplumbing.com.au`) in Resend, verify the DNS records, and update `RESEND_FROM` to use it.

For v0.1 testing with just your email, you can skip this entirely.

---

## Step 6: first real deploy

1. Now that all env vars are set (except `AUTH_URL`), go to **Deployments** tab.
2. Click the three-dot menu on the latest deployment → **Redeploy**. Confirm.
3. Wait about 2 minutes. The deploy should succeed this time.
4. Once it's done, copy the deployment URL. It looks like `https://scp-pocket-ea-xyz123.vercel.app` (or your custom domain if you set one).
5. Go back to **Settings → Environment Variables**, find `AUTH_URL`, set its value to that URL (no trailing slash).
6. **Redeploy one more time** so `AUTH_URL` takes effect.

---

## Step 7: initialise the database

The schema and seed data haven't been loaded into the empty Postgres yet. One-shot API call does it.

Open your deployment URL in the browser and open the developer console (Right-click → Inspect → Console tab). Paste this, replacing `YOUR_CRON_SECRET` with the value you saved in Step 5:

```js
fetch('/api/admin/init', {
  method: 'POST',
  headers: { Authorization: 'Bearer YOUR_CRON_SECRET' }
}).then(r => r.json()).then(console.log)
```

Press Enter. After 5-10 seconds you should see something like:

```json
{
  "ok": true,
  "migration": "11 statements",
  "seed": {
    "admin": "created",
    "operator": "created",
    "settings": "created",
    "catalogue": "30 items"
  }
}
```

If you see that, the database is live. Running it again is harmless (everything is idempotent), but you don't need to.

---

## Step 8: test sign-in

1. Visit your deployment URL.
2. You should see the SCP Pocket EA login page.
3. Enter `d8urger@gmail.com` and click **Send sign-in link**.
4. Within about 30 seconds an email arrives from `onboarding@resend.dev` with subject "Your SCP Pocket EA sign-in link".
5. **Open the email on the same device** (this matters, the link is device-bound for security).
6. Click **Sign in**. You should land on the "Today" view.
7. You're in. Settings, Catalogue, Today, History, all should be reachable.

### Try a smoke test

1. Tap **Start a job**.
2. Customer name: `Test Customer`. Address: `1 Test St`. Note: `Smoke test`.
3. Tap **Start job**.
4. You land on the job detail page.
5. Tap **Tap to start recording**. Speak for 10 seconds. Say something like: *"Took about an hour and a half. Replaced two tap washers in the kitchen. Standard callout."*
6. Tap **Stop and transcribe**.
7. Review the transcript. Tap **Generate draft invoice**.
8. Within about 15 seconds you see the draft preview with line items: standard callout, labour 1.5 hours, tap washer kit.
9. Tap **Save draft and review**.
10. You land on the invoice review page. Edit any line if you want.
11. Tap **Send draft to admin**.
12. Within 30 seconds, a draft invoice email lands in `d8urger@gmail.com`.

If all that works, the app is live.

---

## Step 9: install to phone home screen

### iPhone

1. Open the deployment URL in **Safari** (not Chrome, the install only works from Safari on iOS).
2. Sign in.
3. Tap the **Share** button (square with arrow up).
4. Scroll down and tap **Add to Home Screen**.
5. Confirm the name as `SCP` and tap **Add**.
6. The app now lives as an icon on the home screen. It runs full-screen with no browser chrome.

### Android

1. Open the deployment URL in **Chrome**.
2. Sign in.
3. Tap the three-dot menu.
4. Tap **Add to Home screen** (or **Install app**).
5. Confirm.

---

## Step 10: Shane

Once you're satisfied:

1. In Resend, add `shanecollinsplumbing@gmail.com` as a verified recipient (see "Resend sender restriction" above), OR set up a custom domain.
2. Send Shane `HANDOVER.md` (the one-page guide in this repo).
3. Have him visit the deployment URL on his phone, sign in with his email, and install to home screen.

---

## Costs (mid-2026)

Pessimistic estimate, assuming 5 jobs/day, every day:

| Service | Monthly cost |
|---|---|
| Vercel Hobby | $0 |
| Vercel Postgres (free tier) | $0 |
| Vercel Blob (free tier, 1GB) | $0 |
| OpenAI Whisper ($0.006/min × ~5 min/day × 30) | ~$0.90 |
| Anthropic Claude (Sonnet, ~2k tokens per extraction × 5/day × 30) | ~$2-4 |
| Resend free tier | $0 |
| **Total** | **about $5/month** |

If usage scales 10x (50 jobs/day) you're still under $50/month. Add Vercel Pro ($20/month) only if you outgrow the free tier or want hourly cron granularity. Domain name is optional, ~$15/year if you want `app.shanecollinsplumbing.com.au` instead of `scp-pocket-ea-xyz.vercel.app`.

---

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| Magic-link email never arrives for Shane | Resend default sender only delivers to verified addresses | Add Shane's email as verified recipient in Resend, or set up a custom domain |
| "Microphone access denied" on iPhone | iOS PWA needs explicit mic permission | Settings → Safari → Camera & Microphone → Allow. Re-add to home screen. |
| Deploy succeeds but pages 500 | Missing env var | Check Vercel → Settings → Environment Variables, redeploy after any change |
| Whisper returns error | OpenAI key lacks Audio scope, or out of credit | Regenerate key with Audio (Write) scope, check Settings → Billing |
| Daily summary doesn't fire | Vercel cron only on Production deployment, check cron tab in Vercel dashboard | Look at Logs → Crons in Vercel |
| Database init returns 401 | CRON_SECRET in your fetch doesn't match the env var | Re-copy from Vercel env vars panel, retry |
| All API calls return "Unauthorised" | AUTH_URL doesn't match the actual deployment URL | Check trailing slash, http vs https, redeploy after fixing |

---

## What lives where

```
scp-pocket-ea/
├── src/
│   ├── app/                  Next.js pages and API routes
│   ├── components/           React UI components
│   ├── db/                   Database schema and connection
│   ├── lib/                  Anthropic, OpenAI, Resend, money math
│   ├── auth.ts               NextAuth config (magic-link, whitelist)
│   └── middleware.ts         Route protection
├── drizzle/
│   └── 0000_initial.sql      DB schema (auto-applied by init endpoint)
├── public/                   PWA manifest and icon
├── .env.example              Documented env var list
├── README.md                 You are here
└── HANDOVER.md               Shane's one-page guide
```

## v0.2 roadmap (when you're ready)

- Xero integration: pushes drafts straight to Xero Invoices instead of email-to-admin
- Customer phone numbers and address autocomplete via Google Places
- Job materials checklist (so Shane can tap items as he uses them, even before voice capture)
- Multi-day timesheet view for payroll
- Quote workflow (separate from invoice)
- BAS-ready quarterly export
