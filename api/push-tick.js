// Secured poller: fetches the ESPN scoreboard, diffs it against the last
// snapshot in Redis, and sends a Web Push for every kick-off / goal / full-time
// that involves a team one of our subscribers favorited. Meant to be called on a
// schedule (GitHub Actions cron, Vercel Cron, or any pinger) with a shared
// secret. Mirrors the in-tab alert logic in app.js (maybeNotifyFavorites).

const webpush = require('web-push');
const { redis, redisConfigured, SUBS, STATE, iconFor } = require('./_lib');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const ESPN_STATE = { pre: 'upcoming', in: 'live', post: 'finished' };

// Build the notification for one detected event.
function buildEvent(type, id, m, side) {
    const line = `${m.homeName} ${m.hs}–${m.as} ${m.awayName}`;
    let title, body, tag, code, renotify = false;
    if (type === 'kickoff') {
        title = '\u{1F7E2} Kick-off';
        body = `${m.homeName} vs ${m.awayName} is under way`;
        tag = `ko-${id}`;
        code = m.home;
    } else if (type === 'goal') {
        const scorer = side === 'home' ? m.homeName : m.awayName;
        code = side === 'home' ? m.home : m.away;
        title = `⚽ GOAL — ${scorer}!`;
        body = line;
        tag = `g-${id}-${m.hs}-${m.as}`;
        renotify = true;
    } else { // full-time
        title = '\u{1F3C1} Full-time';
        body = line;
        tag = `ft-${id}`;
        code = m.home;
    }
    return {
        codes: [m.home, m.away],
        payload: { title, body, tag, icon: iconFor(code), url: '/', renotify },
    };
}

module.exports = async (req, res) => {
    // ---- auth ----
    // Accept either the GitHub Actions secret (PUSH_TICK_SECRET) or the Vercel
    // Cron secret (CRON_SECRET, which Vercel sends as `Authorization: Bearer`).
    const auth = req.headers.authorization || '';
    const ok = ['PUSH_TICK_SECRET', 'CRON_SECRET']
        .map((k) => process.env[k])
        .some((v) => v && auth === `Bearer ${v}`);
    if (!ok) {
        res.status(401).json({ ok: false, reason: 'unauthorized' });
        return;
    }
    if (!redisConfigured() || !process.env.VAPID_PRIVATE_KEY) {
        res.status(200).json({ ok: false, reason: 'not-configured' });
        return;
    }
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@wctracker2026.vercel.app',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
    );

    // ---- 1. current state from ESPN ----
    let data;
    try {
        const r = await fetch(`${ESPN_BASE}/scoreboard?dates=20260611-20260719&limit=400`, { cache: 'no-store' });
        if (!r.ok) { res.status(200).json({ ok: false, reason: `espn-${r.status}` }); return; }
        data = await r.json();
    } catch (e) {
        res.status(200).json({ ok: false, reason: 'espn-fetch' });
        return;
    }

    const cur = {};   // matchId -> {h,a,st}  (snapshot we persist)
    const meta = {};  // matchId -> {home,away,homeName,awayName,hs,as}
    for (const ev of (data.events || [])) {
        const comp = ev.competitions && ev.competitions[0];
        const cs = (comp && comp.competitors) || [];
        if (cs.length < 2) continue;
        const c0home = cs[0].homeAway === 'home';
        const homeC = c0home ? cs[0] : cs[1];
        const awayC = c0home ? cs[1] : cs[0];
        const hs = parseInt(homeC.score, 10);
        const as = parseInt(awayC.score, 10);
        const st = ESPN_STATE[ev.status && ev.status.type && ev.status.type.state] || 'upcoming';
        cur[ev.id] = { h: isNaN(hs) ? 0 : hs, a: isNaN(as) ? 0 : as, st };
        meta[ev.id] = {
            home: homeC.team.abbreviation, away: awayC.team.abbreviation,
            homeName: homeC.team.displayName || homeC.team.abbreviation,
            awayName: awayC.team.displayName || awayC.team.abbreviation,
            hs: isNaN(hs) ? 0 : hs, as: isNaN(as) ? 0 : as,
        };
    }

    // ---- 2. previous snapshot ----
    let prev = {};
    try { const s = await redis('GET', STATE); if (s) prev = JSON.parse(s); } catch (e) { /* treat as empty */ }
    const seeding = Object.keys(prev).length === 0;

    // ---- 3. detect events (never on the first/seed run) ----
    const events = [];
    if (!seeding) {
        for (const id of Object.keys(cur)) {
            const c = cur[id], p = prev[id];
            if (!p) continue;
            const m = meta[id];
            if (p.st !== 'live' && c.st === 'live') events.push(buildEvent('kickoff', id, m));
            if (c.st === 'live') {
                if (c.h > p.h) events.push(buildEvent('goal', id, m, 'home'));
                if (c.a > p.a) events.push(buildEvent('goal', id, m, 'away'));
            }
            if (p.st !== 'finished' && c.st === 'finished') events.push(buildEvent('ft', id, m));
        }
    }

    // ---- 4. persist the new snapshot up front (so a send failure can't replay events) ----
    try { await redis('SET', STATE, JSON.stringify(cur)); } catch (e) { /* best effort */ }

    // ---- 5. fan out to subscribers ----
    let sent = 0, pruned = 0, failed = 0;
    if (events.length) {
        let flat = [];
        try { flat = (await redis('HGETALL', SUBS)) || []; } catch (e) { flat = []; }
        const subs = [];
        for (let i = 0; i < flat.length; i += 2) {
            try { subs.push({ field: flat[i], ...JSON.parse(flat[i + 1]) }); } catch (e) { /* skip bad record */ }
        }

        for (const ev of events) {
            for (const s of subs) {
                const favs = s.favs || [];
                if (!ev.codes.some((c) => favs.includes(c))) continue;
                try {
                    await webpush.sendNotification(s.subscription, JSON.stringify(ev.payload));
                    sent++;
                } catch (err) {
                    // 404/410 → the subscription is dead; drop it.
                    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                        try { await redis('HDEL', SUBS, s.field); pruned++; } catch (e) { /* ignore */ }
                    } else {
                        failed++;
                    }
                }
            }
        }
    }

    res.status(200).json({
        ok: true, seeded: seeding, matches: Object.keys(cur).length,
        events: events.length, sent, pruned, failed,
    });
};
