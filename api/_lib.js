// Shared helpers for the push endpoints. Filenames under /api that start with
// "_" are NOT turned into routes by Vercel, so this is never publicly served.

const crypto = require('crypto');

// ===== Upstash Redis (REST) =====
// We talk to Upstash over its REST API with plain fetch — no driver, no
// connection pooling, which suits stateless serverless functions. Set
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in the Vercel project.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const redisConfigured = () => !!(REDIS_URL && REDIS_TOKEN);

async function redis(...args) {
    if (!redisConfigured()) throw new Error('upstash-not-configured');
    const r = await fetch(REDIS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`upstash-http-${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(`upstash: ${j.error}`);
    return j.result;
}

// Redis keys.
const SUBS = 'wcpush:subs';   // hash: field = subId(endpoint), value = JSON({subscription, favs, updated})
const STATE = 'wcpush:state'; // string: JSON snapshot { [matchId]: {h,a,st} } for event diffing

// A short, stable id for a subscription endpoint (used as the hash field).
const subId = (endpoint) =>
    crypto.createHash('sha256').update(String(endpoint || '')).digest('hex').slice(0, 32);

// ===== Request-body parsing =====
// Vercel's Node runtime usually populates req.body, but fall back to reading the
// stream so the same code works locally and regardless of content-type quirks.
async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
    return new Promise((resolve) => {
        let d = '';
        req.on('data', (c) => { d += c; });
        req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
        req.on('error', () => resolve({}));
    });
}

// ===== Flag icon for a notification =====
// FIFA 3-letter code → ISO alpha-2 (mirrors the map in app.js). Used to point a
// push notification's icon at the right self-hosted flag.
const FIFA_TO_ISO = {
    MEX: 'mx', RSA: 'za', KOR: 'kr', CZE: 'cz', CAN: 'ca', BIH: 'ba', QAT: 'qa', SUI: 'ch',
    BRA: 'br', MAR: 'ma', HAI: 'ht', SCO: 'gb-sct', USA: 'us', PAR: 'py', AUS: 'au', TUR: 'tr',
    GER: 'de', CUW: 'cw', CIV: 'ci', ECU: 'ec', NED: 'nl', JPN: 'jp', SWE: 'se', TUN: 'tn',
    BEL: 'be', EGY: 'eg', IRN: 'ir', NZL: 'nz', ESP: 'es', CPV: 'cv', KSA: 'sa', URU: 'uy',
    FRA: 'fr', SEN: 'sn', IRQ: 'iq', NOR: 'no', ARG: 'ar', ALG: 'dz', AUT: 'at', JOR: 'jo',
    POR: 'pt', COD: 'cd', UZB: 'uz', COL: 'co', ENG: 'gb-eng', CRO: 'hr', GHA: 'gh', PAN: 'pa',
};
const iconFor = (code) => (FIFA_TO_ISO[code] ? `flags/${FIFA_TO_ISO[code]}.png` : 'icon.svg');

module.exports = { redis, redisConfigured, SUBS, STATE, subId, readBody, FIFA_TO_ISO, iconFor };
