// Minimal Upstash Redis REST client — no dependency, just fetch.
//
// Works with either env-var naming the Vercel Marketplace may provision:
//   KV_REST_API_URL / KV_REST_API_TOKEN            (Vercel KV)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash native)

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const configured = () => Boolean(URL && TOKEN);

// Run one Redis command, e.g. cmd('HSET', 'subs', id, json).
async function cmd(...args) {
    if (!configured()) throw new Error('redis-not-configured');
    const r = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args.map(String)),
    });
    if (!r.ok) throw new Error(`redis-${r.status}`);
    const data = await r.json();
    return data.result;
}

module.exports = {
    configured,
    cmd,
    hset: (key, field, val) => cmd('HSET', key, field, val),
    hdel: (key, field) => cmd('HDEL', key, field),
    hgetall: async (key) => {
        // Upstash returns HGETALL as a flat [field, value, field, value, ...] array.
        const flat = (await cmd('HGETALL', key)) || [];
        const out = {};
        for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
        return out;
    },
    get: (key) => cmd('GET', key),
    set: (key, val) => cmd('SET', key, val),
};
