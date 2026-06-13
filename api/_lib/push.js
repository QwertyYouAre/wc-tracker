// Web Push helper — wraps the `web-push` library with the VAPID identity.
//
// Env vars (set in Vercel → Project → Settings → Environment Variables):
//   VAPID_PUBLIC_KEY   — also embedded in the client (public, safe to expose)
//   VAPID_PRIVATE_KEY  — secret
//   VAPID_SUBJECT      — a mailto: or https: contact URL (e.g. mailto:you@example.com)

const webpush = require('web-push');

const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:hibarbievr@gmail.com';

const configured = () => Boolean(PUBLIC && PRIVATE);
if (configured()) webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);

// Send a JSON payload to one subscription. Resolves to:
//   { ok: true }            delivered
//   { ok: false, gone }     410/404 — subscription is dead, caller should drop it
//   { ok: false }           transient error
async function send(subscription, payload) {
    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return { ok: true };
    } catch (e) {
        const code = e && e.statusCode;
        return { ok: false, gone: code === 404 || code === 410 };
    }
}

module.exports = { configured, send, publicKey: () => PUBLIC };
