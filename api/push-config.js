// Returns the VAPID public key so the browser can subscribe to push. The public
// key is, by design, public; the matching private key stays server-side only.
// If push isn't configured (no key), the client falls back to in-tab alerts.

module.exports = (req, res) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY || '';
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ ok: !!publicKey, publicKey });
};
