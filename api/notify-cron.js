// GET/POST /api/notify-cron  — the heartbeat behind push alerts.
//
// An external scheduler (GitHub Actions / cron-job.org) hits this once a minute
// with the shared secret. Each run: pull ESPN's scoreboard, compare it to the
// state we saved last minute, and for every followed team that just kicked off,
// scored, or finished, send a Web Push to its subscribers. Then save the new
// state for next time.
//
// Auth: send the secret as header `x-cron-key`, `Authorization: Bearer <secret>`,
// or `?key=<secret>`. Set CRON_SECRET in the Vercel env to match.

const redis = require('./_lib/redis');
const push = require('./_lib/push');

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=400';
const SUBS_KEY = 'subs';
const STATE_KEY = 'matchstate';

const authed = (req) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    const hdr = req.headers['x-cron-key'];
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const q = (req.query && req.query.key) || '';
    return hdr === secret || bearer === secret || q === secret;
};

// ESPN scoreboard → [{ id, home, away, homeName, awayName, st, h, a }]
function readScoreboard(data) {
    const out = [];
    for (const ev of (data.events || [])) {
        const comp = ev.competitions && ev.competitions[0];
        const cs = (comp && comp.competitors) || [];
        if (cs.length < 2) continue;
        const home = cs.find((c) => c.homeAway === 'home') || cs[0];
        const away = cs.find((c) => c.homeAway === 'away') || cs[1];
        const state = ev.status && ev.status.type && ev.status.type.state; // pre | in | post
        out.push({
            id: String(ev.id),
            home: home.team.abbreviation,
            away: away.team.abbreviation,
            homeName: home.team.displayName || home.team.name,
            awayName: away.team.displayName || away.team.name,
            st: state,
            h: parseInt(home.score, 10),
            a: parseInt(away.score, 10),
        });
    }
    return out;
}

// Compare new vs saved state and produce notification descriptors.
function diffEvents(cur, prev) {
    const notes = [];
    for (const m of cur) {
        const p = prev[m.id];
        if (!p) continue; // first time we see this match — seed only, never fire
        const hs = isNaN(m.h) ? 0 : m.h, as = isNaN(m.a) ? 0 : m.a;
        const ph = isNaN(p.h) ? 0 : p.h, pa = isNaN(p.a) ? 0 : p.a;

        if (p.st !== 'in' && m.st === 'in') {
            notes.push({ teams: [m.home, m.away], tag: `ko-${m.id}`,
                title: '🟢 Kick-off', body: `${m.homeName} vs ${m.awayName} is under way` });
        }
        if (m.st === 'in' && hs > ph) {
            notes.push({ teams: [m.home, m.away], tag: `goal-${m.id}-${hs}-${as}`,
                title: `⚽ GOAL — ${m.homeName}!`, body: `${m.homeName} ${hs}–${as} ${m.awayName}` });
        }
        if (m.st === 'in' && as > pa) {
            notes.push({ teams: [m.home, m.away], tag: `goal-${m.id}-${hs}-${as}`,
                title: `⚽ GOAL — ${m.awayName}!`, body: `${m.homeName} ${hs}–${as} ${m.awayName}` });
        }
        if (p.st !== 'post' && m.st === 'post') {
            notes.push({ teams: [m.home, m.away], tag: `ft-${m.id}`,
                title: '🏁 Full-time', body: `${m.homeName} ${hs}–${as} ${m.awayName}` });
        }
    }
    return notes;
}

async function handler(req, res) {
    if (!authed(req)) { res.status(401).json({ ok: false, reason: 'unauthorized' }); return; }
    if (!redis.configured() || !push.configured()) {
        res.status(200).json({ ok: false, reason: 'not-configured' }); return;
    }

    try {
        const r = await fetch(ESPN, { cache: 'no-store' });
        if (!r.ok) { res.status(200).json({ ok: false, reason: `espn-${r.status}` }); return; }
        const cur = readScoreboard(await r.json());

        const prevRaw = await redis.get(STATE_KEY);
        const prev = prevRaw ? JSON.parse(prevRaw) : {};

        const notes = diffEvents(cur, prev);

        // Always persist the latest state so the next minute can diff against it.
        const nextState = {};
        for (const m of cur) nextState[m.id] = { st: m.st, h: m.h, a: m.a };
        await redis.set(STATE_KEY, JSON.stringify(nextState));

        let sent = 0, dropped = 0;
        if (notes.length) {
            const subsMap = await redis.hgetall(SUBS_KEY);
            const subs = Object.entries(subsMap).map(([id, json]) => {
                try { return { id, ...JSON.parse(json) }; } catch (_) { return null; }
            }).filter(Boolean);

            const dead = new Set();
            const jobs = [];
            for (const n of notes) {
                const payload = { title: n.title, body: n.body, tag: n.tag, url: '/', icon: '/icon-192.png' };
                for (const s of subs) {
                    const follows = (s.teams || []).some((t) => t === n.teams[0] || t === n.teams[1]);
                    if (!follows) continue;
                    jobs.push(push.send(s.sub, payload).then((rv) => {
                        if (rv.ok) sent++;
                        else if (rv.gone) dead.add(s.id);
                    }));
                }
            }
            await Promise.all(jobs);
            for (const id of dead) { await redis.hdel(SUBS_KEY, id); dropped++; }
        }

        res.status(200).json({ ok: true, events: notes.length, sent, dropped, matches: cur.length });
    } catch (e) {
        res.status(200).json({ ok: false, reason: 'error' });
    }
}

module.exports = handler;
// Exposed for unit testing the pure logic.
module.exports.readScoreboard = readScoreboard;
module.exports.diffEvents = diffEvents;
