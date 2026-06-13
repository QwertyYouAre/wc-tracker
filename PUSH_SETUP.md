# Web Push setup

Background match alerts (kick-off / goal / full-time) for favorited teams, even
when no tab is open. Architecture:

```
Browser ──subscribe──▶ /api/subscribe ──▶ Upstash Redis (subscriptions + favs)
                                                  ▲
GitHub Actions (every 5 min) ──▶ /api/push-tick ──┘
                                     │ polls ESPN, diffs vs snapshot,
                                     └─▶ web-push ──▶ subscribers' browsers
```

If any of the below is missing, the app silently falls back to **in-tab alerts**
(which already work whenever a tab is open) — nothing breaks.

## 1. Provision Upstash Redis
Vercel dashboard → your `wc-tracker` project → **Storage** → **Marketplace** →
**Upstash** (Redis) → create a free database and connect it to the project. This
auto-adds `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars.

## 2. Generate VAPID keys
```bash
npx web-push generate-vapid-keys
```
Add to Vercel → Settings → Environment Variables (Production):

| Var | Value |
|-----|-------|
| `VAPID_PUBLIC_KEY`  | the public key from the command |
| `VAPID_PRIVATE_KEY` | the private key from the command |
| `VAPID_SUBJECT`     | `mailto:you@example.com` |
| `PUSH_TICK_SECRET`  | any long random string (protects the tick endpoint) |

## 3. Wire the scheduler (GitHub Actions)
`.github/workflows/push-tick.yml` is already in the repo. Add the repo secret so
it can authenticate:

GitHub → repo **Settings** → **Secrets and variables** → **Actions** → New secret
→ `PUSH_TICK_SECRET` = the same value you set in Vercel.

It runs every ~5 min. Trigger a manual run from the **Actions** tab to test.

> **Latency:** GitHub cron fires at most every 5 min and can lag under load, so
> goal alerts may be up to ~5 min late. For near-instant alerts, pick **one** of:
> - **Vercel Cron:** `vercel.json` declares a cron on `/api/push-tick`. ⚠️ The
>   Hobby plan **rejects the whole deployment** if the schedule runs more often
>   than once per day, so it's set to daily (`0 0 * * *`). **On Pro, change it to
>   `* * * * *`** for 1-minute alerts. Set a `CRON_SECRET` env var in Vercel —
>   Vercel sends it as `Authorization: Bearer <CRON_SECRET>`, which
>   `api/push-tick.js` already accepts. **Don't run both** GitHub Actions and a
>   frequent Vercel Cron at once — disable one to avoid double-polling.
> - **External pinger** (cron-job.org, 1-min free): POST to `/api/push-tick` with
>   header `Authorization: Bearer <PUSH_TICK_SECRET>`.

## 4. Deploy
```bash
git add -A && git commit -m "Add Web Push" && git push
```
Vercel auto-installs `web-push` (from `package.json`) and builds the `/api`
functions. No build/output settings change — the static files still serve as-is.

## 5. Test it
1. Open the site, **Favorites** → ★ a team, then **🔔 Notify me** (grant the
   browser prompt). This subscribes you.
2. Actions tab → run **push-tick** manually. First run just seeds the snapshot.
3. During a live match involving your team, the next run pushes the alert — close
   all tabs first to confirm background delivery.

## Notes
- In-tab and push alerts share the same notification `tag` (the ESPN event id),
  so an open tab won't double-notify — the OS coalesces them.
- Dead subscriptions (HTTP 404/410) are auto-pruned on send.
- The service worker (`sw.js`) serves the **app shell** (HTML/JS/CSS) network-first
  so a deploy reaches online visitors immediately, falling back to cache only when
  offline; flags/icons are cache-first. **Live score data is never cached** (ESPN
  and `/api/*` bypass the worker entirely). Bump `CACHE` in `sw.js` when you want to
  invalidate cached static assets.
