// Vercel Serverless Function — proxies football-data.org World Cup matches.
//
// Why this exists: football-data.org requires an API token and does not allow
// direct browser calls (CORS + the key must stay secret). This function holds
// the token server-side (env var FOOTBALL_DATA_TOKEN) and returns a slim,
// public-safe payload. It always responds 200 with { ok } so the client can
// treat "not configured / upstream down" the same as "no scores yet" and just
// keep showing the openfootball schedule.
//
// Setup: add FOOTBALL_DATA_TOKEN in Vercel → Project → Settings →
// Environment Variables (get a free token at football-data.org), then redeploy.

module.exports = async (req, res) => {
    const token = process.env.FOOTBALL_DATA_TOKEN;
    if (!token) {
        res.status(200).json({ ok: false, reason: 'no-token', matches: [] });
        return;
    }

    try {
        const upstream = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
            headers: { 'X-Auth-Token': token },
        });

        if (!upstream.ok) {
            res.status(200).json({ ok: false, reason: `upstream-${upstream.status}`, matches: [] });
            return;
        }

        const data = await upstream.json();
        const matches = (data.matches || []).map((m) => ({
            utcDate: m.utcDate,
            status: m.status, // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED | ...
            minute: m.minute ?? null,
            home: m.homeTeam && m.homeTeam.tla,
            away: m.awayTeam && m.awayTeam.tla,
            homeName: m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName),
            awayName: m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName),
            homeScore: m.score && m.score.fullTime ? m.score.fullTime.home : null,
            awayScore: m.score && m.score.fullTime ? m.score.fullTime.away : null,
        }));

        // Cache at Vercel's edge so many visitors share one upstream call
        // (free tier is ~10 req/min).
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
        res.status(200).json({ ok: true, count: matches.length, matches });
    } catch (e) {
        res.status(200).json({ ok: false, reason: 'error', matches: [] });
    }
};
