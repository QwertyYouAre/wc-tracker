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
> goal alerts may be up to ~5 min late. For near-instant alerts either:
> - **Vercel Cron (needs Pro):** add to `vercel.json`:
>   ```json
>   { "crons": [{ "path": "/api/push-tick", "schedule": "* * * * *" }] }
>   ```
>   Vercel Cron can't send the `Authorization` header, so on Pro also accept the
>   built-in `x-vercel-cron` check (small tweak to `api/push-tick.js`).
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
- The app shell is cached by the service worker (`sw.js`); **live score data is
  never cached** (ESPN/`/api` bypass the cache). After a deploy, returning users
  pick up new app code on their second load (stale-while-revalidate). To force an
  instant update for everyone, bump `CACHE` (`wc-tracker-v1` → `v2`) in `sw.js`.
