// Vercel Serverless Function — football-data.org single-match detail.
// Returns the real event timeline (goals, cards, substitutions) for one match,
// looked up by the football-data match id (from /api/scores). Token stays
// server-side. Always 200 { ok } so the client can degrade gracefully.

module.exports = async (req, res) => {
    const token = process.env.FOOTBALL_DATA_TOKEN;
    const id = req.query && req.query.id;
    if (!token) { res.status(200).json({ ok: false, reason: 'no-token' }); return; }
    if (!id) { res.status(200).json({ ok: false, reason: 'no-id' }); return; }

    try {
        const r = await fetch(`https://api.football-data.org/v4/matches/${encodeURIComponent(id)}`, {
            headers: { 'X-Auth-Token': token },
        });
        if (!r.ok) { res.status(200).json({ ok: false, reason: `upstream-${r.status}` }); return; }

        const m = await r.json();
        const events = [];
        for (const g of (m.goals || [])) {
            events.push({
                type: g.type === 'OWN' ? 'og' : (g.type === 'PENALTY' ? 'penalty' : 'goal'),
                minute: g.minute, team: g.team && g.team.tla,
                player: g.scorer && g.scorer.name, assist: (g.assist && g.assist.name) || null,
            });
        }
        for (const b of (m.bookings || [])) {
            events.push({
                type: String(b.card || '').toUpperCase().includes('RED') ? 'red' : 'yellow',
                minute: b.minute, team: b.team && b.team.tla, player: b.player && b.player.name,
            });
        }
        for (const s of (m.substitutions || [])) {
            events.push({
                type: 'sub', minute: s.minute, team: s.team && s.team.tla,
                playerIn: s.playerIn && s.playerIn.name, playerOut: s.playerOut && s.playerOut.name,
            });
        }

        res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
        res.status(200).json({
            ok: true,
            status: m.status,
            home: m.homeTeam && m.homeTeam.tla,
            away: m.awayTeam && m.awayTeam.tla,
            events,
            counts: { goals: (m.goals || []).length, bookings: (m.bookings || []).length, subs: (m.substitutions || []).length },
        });
    } catch (e) {
        res.status(200).json({ ok: false, reason: 'error' });
    }
};
