// POST /api/unsubscribe  { endpoint }  — drop a subscription (user turned alerts off).
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
        const { endpoint } = await readBody(req);
        if (!endpoint) { res.status(400).json({ ok: false }); return; }
        await redis.hdel(SUBS_KEY, idOf(endpoint));
        res.status(200).json({ ok: true });
    } catch (e) {
        res.status(200).json({ ok: false, reason: 'error' });
    }
};
