// Vercel Serverless Function — API-Football (api-sports.io) match detail.
// Given ?home=&away=&season=, finds the World Cup fixture and returns real
// events (goals/cards) + statistics (possession/shots/…), oriented to the
// requested home/away. Token (API_FOOTBALL_KEY) stays server-side.
// Always 200 { ok } so the client can degrade gracefully.

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const contains = (a, b) => a && b && (a.includes(b) || b.includes(a));

module.exports = async (req, res) => {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) { res.status(200).json({ ok: false, reason: 'no-token' }); return; }

    const home = req.query && req.query.home;
    const away = req.query && req.query.away;
    const season = (req.query && req.query.season) || '2026';
    if (!home || !away) { res.status(200).json({ ok: false, reason: 'no-teams' }); return; }

    const H = { 'x-apisports-key': key };
    const base = 'https://v3.football.api-sports.io';
    const nh = norm(home), na = norm(away);
    const sideOf = (name) => { const n = norm(name); if (contains(n, nh)) return 'home'; if (contains(n, na)) return 'away'; return null; };

    try {
        const fr = await fetch(`${base}/fixtures?league=1&season=${encodeURIComponent(season)}`, { headers: H });
        const fj = await fr.json();
        const list = fj.response || [];
        if (fj.errors && (Array.isArray(fj.errors) ? fj.errors.length : Object.keys(fj.errors).length)) {
            res.status(200).json({ ok: false, reason: 'upstream-errors', errors: fj.errors });
            return;
        }

        const fx = list.find((f) => sideOf(f.teams.home.name) && sideOf(f.teams.away.name)
            && sideOf(f.teams.home.name) !== sideOf(f.teams.away.name));
        if (!fx) { res.status(200).json({ ok: true, found: false, fixtures: list.length }); return; }

        const fid = fx.fixture.id;
        const [er, sr] = await Promise.all([
            fetch(`${base}/fixtures/events?fixture=${fid}`, { headers: H }).then((r) => r.json()).catch(() => ({})),
            fetch(`${base}/fixtures/statistics?fixture=${fid}`, { headers: H }).then((r) => r.json()).catch(() => ({})),
        ]);

        const events = (er.response || []).map((e) => {
            let type = null;
            if (e.type === 'Goal') type = /own/i.test(e.detail || '') ? 'og' : 'goal';
            else if (e.type === 'Card') type = /red/i.test(e.detail || '') ? 'red' : 'yellow';
            if (!type) return null;
            return {
                min: (e.time && e.time.elapsed) || 0,
                type,
                side: sideOf(e.team && e.team.name) || 'home',
                player: e.player && e.player.name,
                assist: (e.assist && e.assist.name) || null,
            };
        }).filter(Boolean);

        const num = (statsArr, type) => {
            const it = (statsArr || []).find((s) => s.type === type);
            if (!it || it.value == null) return 0;
            return parseInt(String(it.value), 10) || 0;
        };
        let stats = null;
        if (sr.response && sr.response.length >= 2) {
            stats = { poss: [0, 0], shots: [0, 0], onTarget: [0, 0], corners: [0, 0], fouls: [0, 0] };
            for (const t of sr.response) {
                const i = sideOf(t.team && t.team.name) === 'away' ? 1 : 0;
                stats.poss[i] = num(t.statistics, 'Ball Possession');
                stats.shots[i] = num(t.statistics, 'Total Shots');
                stats.onTarget[i] = num(t.statistics, 'Shots on Goal');
                stats.corners[i] = num(t.statistics, 'Corner Kicks');
                stats.fouls[i] = num(t.statistics, 'Fouls');
            }
        }

        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
        res.status(200).json({ ok: true, found: true, status: fx.fixture.status && fx.fixture.status.short, events, stats });
    } catch (e) {
        res.status(200).json({ ok: false, reason: 'error' });
    }
};
