# OOS: ticket tracker

Installable phone app (PWA) for tracking ticket lots, each sale, pulling profit and monthly P&L.
It's static files with no build step. Data is kept on the device (works offline) and synced
through Supabase.

## Files

| File | What |
|---|---|
| `index.html` | The whole app (design + logic) |
| `config.js` | Supabase URL + anon/publishable key |
| `supabase/schema.sql` | Table, row-level security, realtime |
| `manifest.webmanifest`, `sw.js`, `icons/` | What makes it installable and work offline |
| `ledger.json` | The data a device starts with when it has nothing saved yet. **Published with the site, so it's public.** |
| `supabase/functions/mail-sync/index.ts` | Edge Function that finds ticket emails in Gmail (see Email sync) |
| `tools/mail-sync.test.mjs` | Tests for it: `npm test` (Node 22.18+ / 24, no installs) |
| `tools/make-icons.ps1` | Regenerates the icons from `icons/logo-source.jpg` (`powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1`) |

## Setup (once, about 10 minutes, free)

1. **Supabase project:** go to supabase.com → New project (Free plan).
2. **Database:** open SQL Editor → paste `supabase/schema.sql` → Run.
3. **Keys:** in Project Settings → API, copy the Project URL and the `anon` / publishable key
   into `config.js`. Don't use the `service_role` / secret key.
4. **Auth URL:** in Authentication → URL Configuration, set Site URL to where the app will live
   (e.g. `https://quandevcz.github.io/resold-/`) so the email confirmation link lands there.
5. **First upload of your data:** run it locally (`npx serve .`, then open the URL it prints) →
   the app loads `ledger.json` → create an account under **Sync** → confirm the email → sign in.
   The ledger now goes up to Supabase.
6. **Deploy:** push to GitHub and turn on Pages (Settings → Pages → Deploy from branch `main`, `/root`).
   `ledger.json` is part of the site, so anyone opening the link starts with that data.
7. **Install on iPhone:** open the Pages URL in Safari → Share → *Add to Home Screen* → open it
   → sign in. On Android, Chrome offers *Install app*.

## How sync works

- Each edit is saved to the device right away, then pushed to your Supabase row 0.4 s later.
- Other devices get it live (realtime) and also re-check whenever the app comes back to the front.
- Offline edits wait and get pushed when the connection is back.
- The whole ledger is one document and **the newest edit wins**. If you edit on two devices while
  both are offline, the one saved later replaces the other. For one person that's fine.
- Free Supabase projects pause after about a week with no requests. Open the dashboard to wake it.
  Local data is not affected.

## Updating the app

After changing files, bump `VERSION` in `sw.js` so phones fetch the new version (it shows on the
second launch).

## Email sync (Gmail → Review)

**Tickets → Sync → Sync ticket emails** searches your Gmail for emails whose subject contains one of
your keywords (Sync → Search keywords). It guesses the event, date, ticket count, price and seats
and puts them in **Review**, where you fix anything that's off and click **Add** (new ticket group or
a sale on an existing group) or **Ignore**. Nothing is added without you clicking Add. Handled
emails don't come back on the next sync. The mailbox is only read, never changed.

It runs as a Supabase Edge Function, because a browser can't talk to a mailbox directly. Needs the
Setup above done first (project, `config.js`, signed in on the Sync page). Then, once:

1. **Gmail app password:** turn on 2-Step Verification for your Google account, then open
   myaccount.google.com/apppasswords, create one (name it "OOS") and copy the 16 letters. You can
   delete it there any time to cut off access. Your normal Google password is never used.
2. **Create the function:** Supabase Dashboard → Edge Functions → Deploy a new function → **Via
   editor**. Name it exactly `mail-sync`, replace the example code with the whole of
   `supabase/functions/mail-sync/index.ts`, and deploy. Leave "Verify JWT" on.
3. **Secrets:** Edge Functions → Secrets → add
   - `GMAIL_USER`: your Gmail address
   - `GMAIL_APP_PASSWORD`: the 16-letter app password
   - `OWNER_EMAIL`: the email you sign in to OOS with. Only that account may read your mail;
     anyone else who signs up gets refused.
4. In the app: Tickets → Sync → Sync ticket emails. The first run looks back 120 days (newest 30
   emails); later runs only look at mail since the last sync.

The app password lives only in Supabase secrets, never in this repo or the browser.
CZK amounts are converted at the app's 24.32 Kč/€; other currencies are flagged so you convert them.
