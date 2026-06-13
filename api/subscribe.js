// POST /api/subscribe  { subscription, teams: ["USA","MEX",...] }
//
// Stores (or refreshes) a browser's push subscription together with the FIFA
// codes of the teams it wants alerts for. Keyed by a hash of the subscription
// endpoint so re-subscribing just overwrites the same record.
const crypto = require('crypto');
const redis = require('./_lib/redis');

const SUBS_KEY = 'subs';
const idOf = (endpoint) => crypto.createHash('sha1').update(endpoint).digest('hex').slice(0, 24);

async function readBody(req) {
    if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
    if (!redis.configured()) { res.status(200).json({ ok: false, reason: 'not-configured' }); return; }
    try {
        const body = await readBody(req);
        const sub = body.subscription;
        const teams = Array.isArray(body.teams) ? body.teams.filter((t) => typeof t === 'string') : [];
        if (!sub || !sub.endpoint) { res.status(400).json({ ok: false, reason: 'bad-subscription' }); return; }

        const record = JSON.stringify({ sub, teams, ts: Date.now() });
        await redis.hset(SUBS_KEY, idOf(sub.endpoint), record);
        res.status(200).json({ ok: true });
    } catch (e) {
        res.status(200).json({ ok: false, reason: 'error' });
    }
};
