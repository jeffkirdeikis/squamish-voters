// Receives a candidate questionnaire and stores it. One JSON blob per submission,
// so nothing can overwrite anything else and duplicates stay visible for review.
import { put, list } from '@vercel/blob';
import { OFFICIAL } from './_official.js';

const MAX_BYTES = 120_000;
const clean = (s, max) => String(s == null ? '' : s).slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'bad body' });

    const who = clean(body.who, 120).trim();
    const email = clean(body.email, 160).trim();
    if (!who) return res.status(400).json({ ok: false, error: 'name required' });
    if (!email.includes('@')) return res.status(400).json({ ok: false, error: 'email required' });

    const answers = {}, notes = {}, writing = {};
    for (const [k, v] of Object.entries(body.answers || {})) {
      if (/^q\d+$/.test(k) && ['-2', '-1', '0', '1', '2'].includes(String(v))) answers[k] = Number(v);
    }
    for (const [k, v] of Object.entries(body.notes || {})) {
      if (/^q\d+$/.test(k) && String(v).trim()) notes[k] = clean(v, 2000);
    }
    for (const [k, v] of Object.entries(body.writing || {})) {
      if (/^[a-z_]{1,40}$/.test(k) && String(v).trim()) writing[k] = clean(v, 6000);
    }
    if (!Object.keys(answers).length && !Object.keys(writing).length) {
      return res.status(400).json({ ok: false, error: 'nothing answered' });
    }

    // Verification: does this address match the one the District published for that candidate?
    const official = OFFICIAL[who] || '';
    const verified = !!official && email.toLowerCase() === official;
    const flags = [];
    if (!official) flags.push('name not on the official candidate list');
    else if (!verified) flags.push(`email does not match the official address (${official})`);

    // Light abuse guard: refuse an obvious flood from one claimed identity.
    try {
      const slugGuard = who.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = await list({ prefix: `responses/${slugGuard}-`, limit: 12 });
      if (existing.blobs.length >= 8) return res.status(429).json({ ok: false, error: 'too many submissions' });
    } catch (e) { /* if the check fails, still accept the response */ }

    const record = {
      who, email, verified, flags, answers, notes, writing,
      received: new Date().toISOString(),
      ua: clean(req.headers['user-agent'], 300),
      ip: clean(req.headers['x-forwarded-for'], 60),
    };
    const json = JSON.stringify(record);
    if (json.length > MAX_BYTES) return res.status(413).json({ ok: false, error: 'too long' });

    const slug = who.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
    await put(`responses/${slug}-${Date.now()}.json`, json, {
      access: 'private', // the store is private: responses are readable only with the store token
      addRandomSuffix: true,
      contentType: 'application/json',
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('submit failed', err);
    return res.status(500).json({ ok: false, error: 'could not save' });
  }
}
