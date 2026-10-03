/* The AI helper chat: streams answers from /api/chat/.
   The conversation lives only in this tab (sessionStorage), never on our server. */
(function () {
  var log = document.getElementById('chat-log'), welcome = document.getElementById('chat-welcome'),
    form = document.getElementById('ask-form'), input = document.getElementById('ask-input'),
    send = document.getElementById('ask-send'), fresh = document.getElementById('chat-new');
  if (!log || !form) return;
  var KEY = 'sv26_ask', MAX_USER = 12, history = [], busy = false;
  var touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  try { history = JSON.parse(sessionStorage.getItem(KEY) || '[]') || []; } catch (e) { history = []; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(history)); } catch (e) {} }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // Tiny, safe markdown: escape everything first, then allow **bold**, "- " bullets and http(s) links.
  // Short link labels ("source", "profile") become small source tags. Links the server flags as
  // not in the guide's records are shown as plain text.
  function md(text, bad) {
    var lines = esc(text).split('\n'), out = [], list = false;
    lines.forEach(function (l) {
      l = l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\(?\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\)?/g, function (m, label, url) {
        var raw = url.replace(/&amp;/g, '&');
        if (bad && bad.indexOf(raw) !== -1) return label;
        var own = /^https:\/\/squamishvoters\.com\//.test(raw), cite = label.length <= 24;
        return '<a href="' + url + '"' + (cite ? ' class="cite"' : '') + (own ? '' : ' target="_blank" rel="noopener"') + '>' + label + '</a>';
      });
      var li = /^\s*[-*•]\s+(.*)$/.exec(l);
      if (li) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + li[1] + '</li>'); return; }
      if (list) { out.push('</ul>'); list = false; }
      if (l.trim()) out.push('<p>' + l + '</p>');
    });
    if (list) out.push('</ul>');
    return out.join('');
  }
  function msg(role, html) {
    var row = document.createElement('div');
    row.className = 'msg ' + role;
    var b = document.createElement('div');
    b.className = 'bubble';
    b.innerHTML = html;
    row.appendChild(b);
    log.appendChild(row);
    return b;
  }
  function userCount() { return history.filter(function (m) { return m.role === 'user'; }).length; }
  function render() {
    Array.prototype.slice.call(log.children).forEach(function (n) { if (n !== welcome) n.remove(); });
    welcome.hidden = history.length > 0;
    fresh.hidden = history.length === 0;
    history.forEach(function (m) { msg(m.role === 'user' ? 'me' : 'bot', m.role === 'user' ? '<p>' + esc(m.content) + '</p>' : md(m.content, m.bad)); });
  }
  // Put the newest question at the top of the chat window, so the answer reads downward under it.
  function showFromTop(el) { log.scrollTop = el.offsetTop - 12; }
  function fit() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }
  function setBusy(on) { busy = on; send.disabled = on; input.readOnly = on; }

  async function ask(q) {
    q = (q || '').trim();
    if (!q || busy) return;
    if (userCount() >= MAX_USER) { msg('bot err', '<p>This conversation is getting long. Tap <b>New chat</b> to start fresh.</p>'); return; }
    history.push({ role: 'user', content: q });
    render();
    input.value = ''; fit();
    if (touch) input.blur(); // drop the phone keyboard so the answer has room
    var mine = log.lastElementChild;
    var el = msg('bot', '<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>');
    showFromTop(mine);
    setBusy(true);
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
      save();
      if (bad.length) el.innerHTML = md(text, bad); // unlink anything not in the records, in place
    } catch (e) {
      history.pop(); // let them retry the same question
      save();
      input.value = q; fit();
      el.parentNode.className = 'msg bot err';
      el.innerHTML = '<p>' + esc(e.message) + '</p>';
    }
    fresh.hidden = false;
    setBusy(false);
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
  input.addEventListener('input', fit);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); } });
  log.addEventListener('click', function (e) { var b = e.target.closest('[data-ask]'); if (b) ask(b.getAttribute('data-ask')); });
  fresh.addEventListener('click', function () { history = []; save(); render(); log.scrollTop = 0; if (!touch) input.focus(); });
  render();
  if (history.length) log.scrollTop = log.scrollHeight;
})();
