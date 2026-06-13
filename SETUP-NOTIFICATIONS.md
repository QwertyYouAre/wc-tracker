# Push notifications — setup

The code for push alerts (kick-off / goal / full-time for your favourite teams,
delivered even when the app is closed) is all in the repo. To make it **live**,
wire up three things on your accounts: a Redis store, the env vars, and an
external 1-minute pinger. ~10 minutes total.

## 1. Provision Upstash Redis (stores subscriptions + match state)

1. Vercel → your **wc-tracker** project → **Storage** → **Create Database** →
   **Upstash for Redis** (Marketplace) → follow the prompts and **connect it to
   the project**.
2. This auto-adds the connection env vars. The code accepts either naming:
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` **or**
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Nothing to do if
   Vercel injects them.

## 2. Add the remaining environment variables

Vercel → project → **Settings → Environment Variables** (Production + Preview).
The VAPID keys below were generated for this project — paste them verbatim:

| Name | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | `BGAPkGtUvEZow5Imd4VGbJI3N5Qr-bKVp1BGkAoIJo6NSbQyBwhKvomaUEHsFr9Uw_nsB63AXRAXnmqh9nfa01E` |
| `VAPID_PRIVATE_KEY` | `u97bqHSitLJnCUq6Uc2_zMQ5370PjV3Df0XpyaMp-VU` |
| `VAPID_SUBJECT` | `mailto:hibarbievr@gmail.com` |
| `CRON_SECRET` | `fwf-ESXM0vZXX8i515W6B4i0Lpp7Wjjs` |

> The public key is also fetched by the browser from `/api/vapid` — it's safe to
> expose. Keep `VAPID_PRIVATE_KEY` and `CRON_SECRET` secret.
> To rotate the VAPID keys later: `npm run vapid` and update both env vars.

**Redeploy** after adding these so the functions pick them up.

## 3. Schedule the 1-minute pinger (external cron)

The poller at `POST /api/notify-cron` must be hit ~once a minute. Vercel Hobby
crons only run daily, so use a free external scheduler:

**cron-job.org (recommended — true 1-minute):**
1. Create a free account → **Create cronjob**.
2. URL: `https://wctracker2026.vercel.app/api/notify-cron`
3. Schedule: **every 1 minute**.
4. Request method: **POST**. Add a header `x-cron-key` = your `CRON_SECRET`.
5. Save & enable.

**GitHub Actions (already included, ~5-minute floor):**
- `.github/workflows/notify-cron.yml` runs every ~5 min once this repo is on
  GitHub. Add the secret: repo → **Settings → Secrets and variables → Actions →
  New repository secret** → `CRON_SECRET` = same value as above.
- Good enough for kick-off/full-time; use cron-job.org too if you want fast
  in-match GOAL alerts.

You can verify it works anytime:
```
curl -X POST https://wctracker2026.vercel.app/api/notify-cron -H "x-cron-key: <CRON_SECRET>"
# → {"ok":true,"events":...,"sent":...,"matches":...}
```

## 4. Using it (per device)

- **Desktop (Chrome/Edge/Firefox):** open the site → **★ Favorites** → pick teams
  → **🔔 Notify me about my teams** → Allow.
- **iPhone/iPad (iOS 16.4+):** Safari → **Share → Add to Home Screen** → open WC
  Tracker from the new icon → **★ Favorites** → pick teams → tap the bell →
  Allow. (iOS only permits web push from the installed app.)
- **Android (Chrome):** works in the browser; optionally “Install app” for an
  app-like icon.

Alerts fire for any match involving a team you've favourited.
