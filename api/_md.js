// Tiny, safe markdown for news story bodies (shared by build.mjs, api/news-live.js and api/news-review.js).
// Supports: "## Heading", "- bullet" lists, paragraphs, **bold** and [links](/site/path/ or https://...). Everything else is escaped.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const inline = (s) => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/)[^)\s]*)\)/g, (m, t, u) => `<a href="${u}"${u.startsWith('/') ? '' : ' target="_blank" rel="noopener"'}>${t}</a>`);
// Story blocks, one per line: [[fold Label | one line gist]] ... [[/fold]] folds that part shut behind a tap;
// [[note]] ... [[/note]] is a quiet box for where the numbers come from; [[name]] drops in widgets[name] (html the caller
// builds from story data, e.g. glance tiles or a timeline). A widget the caller does not have is left out.
export function mdToHtml(md, widgets = {}) {
  const out = []; let list = null, para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); list = null; } };
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (!line) { flushP(); flushL(); continue; }
    const k = line.match(/^\[\[(\/?)([a-z]+)(?:\s+(.*))?\]\]$/);
    if (k) {
      flushP(); flushL();
      const [, close, name, arg] = k;
      if (name === 'fold') {
        if (close) out.push('</div></details>');
        else { const [lab, gist] = String(arg || 'More detail').split('|').map((x) => x.trim()); out.push(`<details class="nw-fold"><summary><b>${inline(lab)}</b>${gist ? `<span>${inline(gist)}</span>` : ''}</summary><div class="nw-fold-in">`); }
      } else if (name === 'note') out.push(close ? '</aside>' : '<aside class="nw-aside"><p class="nw-aside-k">About these numbers</p>');
      else if (!close && widgets[name]) out.push(typeof widgets[name] === 'function' ? widgets[name]((arg || '').trim()) : widgets[name]); // [[poll a]], [[table cost]]: a function gets the word after the name
      continue;
    }
    const h = line.match(/^#{2,3}\s+(.*)$/);
    if (h) { flushP(); flushL(); out.push(`<h2>${inline(h[1])}</h2>`); continue; }
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) { flushP(); (list ||= []).push(b[1]); continue; }
    flushL(); para.push(line);
  }
  flushP(); flushL();
  return out.join('\n');
}

// Extra story photos sit inside the full story: one before each section heading after the first, any left over at the end.
export function placePhotos(html, figs) {
  const f = [...(figs || [])]; if (!f.length) return html;
  let n = 0;
  const out = String(html || '').replace(/<h2[ >]/g, (m) => (n++ >= 1 && f.length ? f.shift() + m : m));
  return out + f.join('');
}
