# Ticket Sales Tracker

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
| `tools/make-icons.js` | Regenerates the icons (`node tools/make-icons.js`) |

## Setup (once, about 10 minutes, free)

1. **Supabase project:** go to supabase.com → New project (Free plan).
2. **Database:** open SQL Editor → paste `supabase/schema.sql` → Run.
3. **Keys:** in Project Settings → API, copy the Project URL and the `anon` / publishable key
   into `config.js`. Don't use the `service_role` / secret key.
4. **Auth URL:** in Authentication → URL Configuration, set Site URL to where the app will live
   (e.g. `https://quandevcz.github.io/ticket-tracker/`) so the email confirmation link lands there.
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
