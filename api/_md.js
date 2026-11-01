// Tiny, safe markdown for news story bodies (shared by build.mjs, api/news-live.js and api/news-review.js).
// Supports: "## Heading", "- bullet" lists, paragraphs, **bold** and [links](/site/path/ or https://...). Everything else is escaped.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = (s) => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/)[^)\s]*)\)/g, (m, t, u) => `<a href="${u}"${u.startsWith('/') ? '' : ' target="_blank" rel="noopener"'}>${t}</a>`);
export function mdToHtml(md) {
  const out = []; let list = null, para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); list = null; } };
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (!line) { flushP(); flushL(); continue; }
    const h = line.match(/^#{2,3}\s+(.*)$/);
    if (h) { flushP(); flushL(); out.push(`<h2>${inline(h[1])}</h2>`); continue; }
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) { flushP(); (list ||= []).push(b[1]); continue; }
    flushL(); para.push(line);
  }
  flushP(); flushL();
  return out.join('\n');
}
