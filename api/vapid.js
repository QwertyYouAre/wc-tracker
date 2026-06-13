// GET /api/vapid → tells the client whether push is available and hands back the
// public VAPID key it needs to subscribe. Single source of truth = server env.
const push = require('./_lib/push');
const redis = require('./_lib/redis');

module.exports = (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
        ok: push.configured() && redis.configured(),
        publicKey: push.publicKey() || null,
    });
};
