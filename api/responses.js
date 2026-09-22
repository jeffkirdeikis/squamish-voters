// Private read-back of the questionnaire responses. Requires ADMIN_TOKEN.
import { list, get } from '@vercel/blob';

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const { blobs } = await list({ prefix: 'responses/', limit: 1000 });
    const out = [];
    for (const b of blobs) {
      try {
        // A private blob must be read through the SDK, which signs the request with the store token.
        const got = await get(b.pathname, { access: 'private', useCache: false });
        if (!got) throw new Error('not found');
        out.push(JSON.parse(await new Response(got.stream || got.blob).text()));
      } catch (e) {
        out.push({ error: 'unreadable', pathname: b.pathname, detail: String(e && e.message) });
      }
    }
    out.sort((a, b) => String(b.received).localeCompare(String(a.received)));
    // Flag anyone who submitted more than once so they can be reconciled by hand.
    const seen = {};
    out.forEach((r) => { const k = (r.who || '').toLowerCase(); seen[k] = (seen[k] || 0) + 1; });
    out.forEach((r) => { r.duplicate = seen[(r.who || '').toLowerCase()] > 1; });
    const summary = {
      total: out.length,
      verified: out.filter((r) => r.verified).length,
      needsReview: out.filter((r) => !r.verified || r.duplicate).length,
    };
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(200).json({ ok: true, count: out.length, summary, responses: out });
  } catch (err) {
    console.error('list failed', err);
    return res.status(500).json({ ok: false, error: 'could not read' });
  }
}
