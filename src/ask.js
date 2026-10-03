/* The "Ask" page: a simple chat that streams answers from /api/chat.
   The conversation lives only in this tab (sessionStorage), never on our server. */
(function () {
  var chat = document.getElementById('chat'), form = document.getElementById('ask-form'),
    input = document.getElementById('ask-input'), send = document.getElementById('ask-send'),
    starters = document.getElementById('starters');
  if (!chat || !form) return;
  var KEY = 'sv26_ask', MAX_USER = 12, history = [];
  try { history = JSON.parse(sessionStorage.getItem(KEY) || '[]') || []; } catch (e) { history = []; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(history)); } catch (e) {} }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // Tiny, safe markdown: escape everything first, then allow **bold**, "- " bullets and http(s) links.
  // Links the server flags as not in the guide's records are shown as plain text.
  function md(text, bad) {
    var lines = esc(text).split('\n'), out = [], list = false;
    lines.forEach(function (l) {
      l = l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m, label, url) {
        var raw = url.replace(/&amp;/g, '&');
        if (bad && bad.indexOf(raw) !== -1) return label;
        var own = /^https:\/\/squamishvoters\.com\//.test(raw);
        return '<a href="' + url + '"' + (own ? '' : ' target="_blank" rel="noopener"') + '>' + label + '</a>';
      });
      var li = /^\s*[-*•]\s+(.*)$/.exec(l);
      if (li) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + li[1] + '</li>'); return; }
      if (list) { out.push('</ul>'); list = false; }
      if (l.trim()) out.push('<p>' + l + '</p>');
    });
    if (list) out.push('</ul>');
    return out.join('');
  }
  function bubble(role, html) {
    var d = document.createElement('div');
    d.className = 'chat-msg ' + (role === 'user' ? 'me' : 'bot');
    d.innerHTML = html;
    chat.appendChild(d);
    return d;
  }
  function render() {
    chat.textContent = '';
    history.forEach(function (m) { bubble(m.role, m.role === 'user' ? '<p>' + esc(m.content) + '</p>' : md(m.content, m.bad)); });
    if (history.length) {
      starters.hidden = true;
      var r = document.createElement('div');
      r.className = 'chat-reset no-print';
      r.innerHTML = '<button type="button" class="btn secondary">Start a new conversation</button>';
      r.firstChild.onclick = function () { history = []; save(); starters.hidden = false; render(); input.focus(); };
      chat.appendChild(r);
    }
  }
  function busy(on) { send.disabled = on; input.disabled = on; send.textContent = on ? 'Thinking…' : 'Ask'; }

  async function ask(q) {
    q = q.trim();
    if (!q) return;
    if (history.filter(function (m) { return m.role === 'user'; }).length >= MAX_USER) {
      bubble('bot', '<p>This conversation is getting long. Please start a new one below.</p>'); return;
    }
    history.push({ role: 'user', content: q });
    render();
    var el = bubble('bot', '<p class="muted">Looking through the records…</p>');
    el.scrollIntoView({ block: 'nearest' });
    busy(true);
    var text = '', bad = [], failed = '';
    try {
      var res = await fetch('/api/chat/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(function (m) { return { role: m.role, content: m.content }; }) }),
      });
      if (!res.ok || !res.body) {
        var j = {}; try { j = await res.json(); } catch (e) {}
        throw new Error(j.error || 'Something went wrong. Please try again.');
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split('\n'); buf = parts.pop();
        parts.forEach(function (line) {
          if (!line) return;
          var ev; try { ev = JSON.parse(line); } catch (e) { return; }
          if (ev.t === 'text') text += ev.d;
          else if (ev.t === 'done') bad = ev.bad || [];
          else if (ev.t === 'error') failed = ev.d;
        });
        if (text) el.innerHTML = md(text, null);
      }
      if (failed && !text) throw new Error(failed);
      if (!text) throw new Error('No answer came back. Please try again.');
      history.push({ role: 'assistant', content: text, bad: bad });
    } catch (e) {
      history.pop(); // let them retry the same question
      input.value = q;
      el.innerHTML = '<p><b>' + esc(e.message) + '</b></p>';
      busy(false);
      return;
    }
    save();
    busy(false);
    render();
    input.value = '';
    input.focus();
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
  starters.addEventListener('click', function (e) { var b = e.target.closest('[data-ask]'); if (b) ask(b.getAttribute('data-ask')); });
  render();
})();
