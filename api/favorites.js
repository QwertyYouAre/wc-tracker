// Vercel Serverless Function — personalized view driven by the user's
// favorite teams.
//
// How it knows the favorites: the browser mirrors STATE.favorites into a
// `wc26-favs` cookie (see saveFavorites() in app.js). That cookie is sent
// with every same-site request, so here on the server we can read it without
// any login — it's a personalization hint, not an auth token.
//
// Response shape (always 200, like /api/scores, so the client can treat
// "no token / upstream down / no favorites" all as an empty personalized
// section and keep showing the normal schedule):
//   { ok, favorites: [tla...], count, matches: [...] }
// matches are only those involving a favorited team, soonest first.

// Parse a Cookie header into a plain { name: value } map.
function parseCookies(header) {
    const out = {};
    (header || '').split(';').forEach((pair) => {
        const i = pair.indexOf('=');
        if (i < 0) return;
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        if (name) out[name] = value;
    });
    return out;
}

function readFavorites(req) {
    const raw = parseCookies(req.headers.cookie)['wc26-favs'];
    if (!raw) return [];
    try {
        const arr = JSON.parse(decodeURIComponent(raw));
        // Keep only sane team codes (defensive: cookie is client-writable).
        return Array.isArray(arr)
            ? arr.filter((c) => typeof c === 'string' && /^[A-Z]{2,3}$/.test(c))
            : [];
    } catch (e) {
        return [];
    }
}

module.exports = async (req, res) => {
    const favorites = readFavorites(req);

    // Never cache at the edge: the response is per-user (depends on the cookie).
    res.setHeader('Cache-Control', 'private, no-store');

    if (favorites.length === 0) {
        res.status(200).json({ ok: true, favorites: [], count: 0, matches: [] });
        return;
    }

    const token = process.env.FOOTBALL_DATA_TOKEN;
    if (!token) {
        res.status(200).json({ ok: false, reason: 'no-token', favorites, count: 0, matches: [] });
        return;
    }

    try {
        const upstream = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
            headers: { 'X-Auth-Token': token },
        });

        if (!upstream.ok) {
            res.status(200).json({ ok: false, reason: `upstream-${upstream.status}`, favorites, count: 0, matches: [] });
            return;
        }

        const data = await upstream.json();
        const fav = new Set(favorites);
        const matches = (data.matches || [])
            .map((m) => ({
                id: m.id,
                utcDate: m.utcDate,
                status: m.status,
                minute: m.minute ?? null,
                home: m.homeTeam && m.homeTeam.tla,
                away: m.awayTeam && m.awayTeam.tla,
                homeName: m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName),
                awayName: m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName),
                homeScore: m.score && m.score.fullTime ? m.score.fullTime.home : null,
                awayScore: m.score && m.score.fullTime ? m.score.fullTime.away : null,
            }))
            .filter((m) => fav.has(m.home) || fav.has(m.away))
            .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

        res.status(200).json({ ok: true, favorites, count: matches.length, matches });
    } catch (e) {
        res.status(200).json({ ok: false, reason: 'error', favorites, count: 0, matches: [] });
    }
};
