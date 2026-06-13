// Stores (or removes) a browser's push subscription together with the FIFA codes
// of the teams it wants alerts for. Keyed by a hash of the push endpoint so the
// same device upserts rather than duplicating. Always 200s so the client can
// treat "push not configured" the same as "saved".

const { redis, redisConfigured, SUBS, subId, readBody } = require('./_lib');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, reason: 'method' });
        return;
    }
    if (!redisConfigured()) {
        res.status(200).json({ ok: false, reason: 'storage-not-configured' });
        return;
    }

    let body;
    try { body = await readBody(req); } catch (e) { body = {}; }
    const { action, subscription, favs } = body || {};
    const endpoint = subscription && subscription.endpoint;
    if (!endpoint) {
        res.status(400).json({ ok: false, reason: 'no-endpoint' });
        return;
    }

    const field = subId(endpoint);
    try {
        if (action === 'unsubscribe') {
            await redis('HDEL', SUBS, field);
            res.status(200).json({ ok: true, action: 'unsubscribe' });
            return;
        }
        // subscribe / upsert (also used to refresh the favorites list)
        const record = JSON.stringify({
            subscription,
            favs: Array.isArray(favs) ? favs.slice(0, 48) : [],
            updated: Date.now(),
        });
        await redis('HSET', SUBS, field, record);
        res.status(200).json({ ok: true, action: 'subscribe', favs: (favs || []).length });
    } catch (e) {
        res.status(200).json({ ok: false, reason: 'store-error' });
    }
};
