/* Private admin page at /subscribers/#t=<ADMIN_TOKEN>: To review, What Squamish Wants, Comments and Sign-ups tabs.
   The token stays in the hash so it never reaches a server log. */
(function () {
  var L = window.SV_SUBS || { issues: {}, hoods: {} };
  var out = document.getElementById('s-out'), status = document.getElementById('s-status');
  var token = (location.hash.match(/t=([^&]+)/) || [])[1] || '';
  try { if (token) localStorage.setItem('sv-admin', token); else token = localStorage.getItem('sv-admin') || ''; } catch (e) {}
  var STATUS = { subscribed: 'Confirmed', pending: 'Waiting to confirm', unsubscribed: 'Unsubscribed' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function when(t) { return t ? new Date(t).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function issueName(k) { var i = L.issues[k]; return i ? i.i + ' ' + i.t : k; }
  function lean(k, v, note) {
    var i = L.issues[k];
    if (v === 'mid') return 'Somewhere in between';
    if (v === 'other') return 'Other' + (note ? ': “' + note + '”' : '');
    var o = i && i.o.filter(function (x) { return x[0] === v; })[0];
    return o ? o[1] : v || 'No lean picked';
  }
  function bar(label, n, max, total) {
    var row = el('div', 'sb-row');
    row.append(el('span', 'sb-label', label));
    var track = el('span', 'sb-track'), fill = el('span', 'sb-fill');
    fill.style.width = (max ? (100 * n / max) : 0) + '%';
    track.append(fill); row.append(track);
    row.append(el('span', 'sb-n', n + (total ? ' (' + Math.round(100 * n / total) + '%)' : '')));
    return row;
  }
  function count(list) { var c = {}; list.forEach(function (k) { c[k] = (c[k] || 0) + 1; }); return Object.keys(c).map(function (k) { return [k, c[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); }

  function render(rows) {
    out.textContent = '';
    var live = rows.filter(function (r) { return r.status !== 'unsubscribed'; });
    var by = function (s) { return rows.filter(function (r) { return r.status === s; }).length; };
    // Same rule as the public totals (api/priorities.js): confirmed, and picked issues on the welcome page
    var answered = rows.filter(function (r) { return r.status === 'subscribed' && r.prefs_at && (r.topics || []).length; });
    status.textContent = rows.length + ' sign-ups · ' + by('subscribed') + ' confirmed · ' + by('pending') + ' waiting to confirm · ' + by('unsubscribed') + ' unsubscribed · ' + answered.length + ' answered the questions';

    // Top issues, each with how people lean on it
    var sec = el('section', 'card sb-sec');
    sec.append(el('h2', null, 'Top issues'));
    sec.append(el('p', 'small', 'Each person could pick up to 3. Out of ' + answered.length + ' people who answered. Tap an issue to see which way they lean.'));
    var issues = count([].concat.apply([], answered.map(function (r) { return r.topics || []; })));
    var max = issues.length ? issues[0][1] : 0;
    issues.forEach(function (p) {
      var k = p[0], d = el('details', 'sb-issue');
      var s = el('summary'); s.append(bar(issueName(k), p[1], max, answered.length)); d.append(s);
      var who = answered.filter(function (r) { return (r.topics || []).indexOf(k) > -1; });
      var leans = count(who.map(function (r) { return (r.stances || {})[k] || ''; }));
      var ul = el('ul', 'sb-leans');
      leans.forEach(function (x) { ul.append(el('li', null, x[1] + ' × ' + lean(k, x[0]))); });
      who.forEach(function (r) { var n = (r.stance_notes || {})[k]; if (n) ul.append(el('li', 'sb-note', '“' + n + '”')); });
      d.append(ul); sec.append(d);
    });
    if (!issues.length) sec.append(el('p', null, 'Nobody has picked issues yet.'));
    out.append(sec);

    // Neighbourhoods
    var hs = el('section', 'card sb-sec');
    hs.append(el('h2', null, 'Neighbourhoods'));
    var hoods = count(live.map(function (r) { return r.area || ''; }).filter(Boolean));
    var hmax = hoods.length ? hoods[0][1] : 0;
    hoods.forEach(function (p) { hs.append(bar(L.hoods[p[0]] || p[0], p[1], hmax, 0)); });
    hs.append(el('p', 'small', live.filter(function (r) { return !r.area; }).length + ' didn’t say.'));
    out.append(hs);

    // Everyone, newest first
    var ps = el('section', 'card sb-sec');
    var head = el('div', 'sb-head');
    head.append(el('h2', null, 'Everyone'));
    var dl = el('button', 'btn secondary', 'Download spreadsheet');
    dl.type = 'button';
    dl.addEventListener('click', download);
    head.append(dl); ps.append(head);
    rows.forEach(function (r) {
      var c = el('div', 'sb-person' + (r.status === 'subscribed' ? '' : ' sb-dim'));
      var top = el('p', 'sb-top');
      top.append(el('b', null, r.email));
      top.append(el('span', 'sb-pill sb-' + r.status, STATUS[r.status] || r.status));
      c.append(top);
      c.append(el('p', 'small', 'Signed up ' + when(r.consent_at) + (r.source ? ' from ' + (r.source === 'home-hero' ? 'the home page' : r.source === 'meeting' ? 'a meeting page' : r.source) : '') + (r.area ? ' · ' + (L.hoods[r.area] || r.area) : '')));
      var t = r.topics || [];
      if (t.length) {
        var ul = el('ul', 'sb-leans');
        t.forEach(function (k) {
          var li = el('li'); li.append(el('b', null, issueName(k) + ': '));
          li.append(document.createTextNode(r.stances && r.stances[k] ? lean(k, r.stances[k], (r.stance_notes || {})[k]) : 'No lean picked'));
          ul.append(li);
        });
        c.append(ul);
      }
      ps.append(c);
    });
    out.append(ps);
  }

  function download() {
    fetch('/api/subscribers/?format=csv', { headers: { Authorization: 'Bearer ' + token } }).then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'squamish-voters-signups-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.append(a); a.click(); a.remove();
    });
  }

  if (!token) { document.getElementById('a-sum').textContent = 'Open this page with the private link (it ends in #t=…).'; status.textContent = ''; return; }
  history.replaceState(null, '', location.pathname); // drop the token from the address bar once it's saved
  fetch('/api/subscribers/', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
    .then(function (r) { if (r.status === 401) throw new Error('That link’s key is wrong.'); return r.json(); })
    .then(function (d) { if (!d.ok) throw new Error(d.error || 'Could not load'); render(d.rows); badge('signups', d.rows.filter(function (r) { return r.status === 'subscribed'; }).length, false); })
    .catch(function (e) { status.textContent = e.message; });


  // ---------- Tabs ----------
  var TABS = ['review', 'wants', 'comments', 'signups'];
  function show(t) {
    if (TABS.indexOf(t) < 0) t = 'review';
    TABS.forEach(function (k) {
      document.getElementById('tab-' + k).hidden = k !== t;
      var b = document.querySelector('[data-tab="' + k + '"]'); b.setAttribute('aria-selected', k === t ? 'true' : 'false');
    });
    try { localStorage.setItem('sv-admin-tab', t); } catch (e) {}
  }
  document.querySelector('.ad-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) show(b.getAttribute('data-tab')); });
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-go]'); if (b) { show(b.getAttribute('data-go')); window.scrollTo(0, 0); } });
  try { show(localStorage.getItem('sv-admin-tab') || 'review'); } catch (e) { show('review'); }
  function badge(tab, n, alert) {
    var b = document.querySelector('[data-tab="' + tab + '"] .ad-n');
    b.textContent = n; b.hidden = !n && tab === 'review'; b.classList.toggle('ad-alert', !!alert && n > 0);
  }

  // ---------- Shared item card ----------
  var ST = { ok: ['Live', 'ad-live'], pending: ['Live, not checked', 'ad-warn'], hidden: ['Held by the check', 'ad-warn'], reported: ['Hidden by reports', 'ad-bad'], removed: ['Hidden by you', 'ad-off'], merged: ['Merged', 'ad-off'] };
  var KIND = { ask: 'Resident’s ask', answer: 'Added answer', words: 'Added words', comment: 'Have your say comment' };
  function ago(t) {
    if (!t) return '';
    var m = (Date.now() - new Date(t)) / 60000;
    if (m < 60) return Math.max(1, Math.round(m)) + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' h ago';
    if (m < 10080) return Math.round(m / 1440) + ' d ago';
    return new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }
  function live(x) { return x.status === 'ok' || x.status === 'pending'; }
  function needs(x) { return x.status === 'pending' || x.status === 'hidden' || x.status === 'reported' || (live(x) && x.reports > 0); }
  function why(x) {
    if (x.status === 'reported') return x.reports + ' readers reported it, so it hid itself. Post it again if it’s fine.';
    if (x.status === 'hidden') return 'The check held it back' + (x.note ? ': ' + x.note.replace(/[.\s]*$/, '.') : '.') + ' Post it if you think it’s fine.';
    if (x.status === 'pending') return 'It went up without the automatic check (the check was down). Have a look.';
    if (x.reports) return x.reports + ' report' + (x.reports === 1 ? '' : 's') + ' from readers (3 hides it).';
    return '';
  }
  function card(x, opts) {
    opts = opts || {};
    var st = ST[x.status] || [x.status, 'ad-off'], on = live(x) || x.status === 'merged';
    var h = '<article class="ad-item' + (on ? '' : ' ad-dim') + '"><div class="ad-body">' +
      '<p class="ad-meta"><span class="ad-pill ' + st[1] + '">' + esc(st[0]) + '</span><span>' + esc(KIND[x.kind]) + (x.at ? ' · ' + esc(ago(x.at)) : '') + (x.n != null ? ' · ' + x.n + ' answered' : '') + '</span></p>';
    if (opts.context && x.question && x.kind !== 'ask') h += '<p class="ad-ctx">On: ' + esc(x.question) + '</p>';
    h += '<p class="ad-title">' + esc(x.title) + '</p>';
    if (x.text && x.text.trim() !== String(x.title).trim()) h += '<details class="ad-orig"><summary>What they wrote</summary><p>' + esc(x.text) + '</p></details>';
    var w = why(x); if (w && opts.context) h += '<p class="ad-why">' + esc(w) + '</p>';
    h += '</div><div class="ad-acts">';
    if (x.status !== 'merged') h += '<button type="button" class="ad-btn' + (on ? '' : ' ad-primary') + '" data-mod="' + (on ? 'hide' : 'show') + '" data-src="' + x.src + '" data-wid="' + esc(x.wid || '') + '" data-nid="' + esc(x.nid || '') + '" data-okey="' + esc(x.okey || '') + '" data-qid="' + esc(x.qid || '') + '" data-cid="' + esc(x.cid || '') + '">' + (on ? 'Hide' : 'Post it') + '</button>';
    if (x.kind === 'ask' && live(x)) h += '<a class="ad-btn" href="/wants/' + esc(x.wid) + '/" target="_blank" rel="noopener">View</a><button type="button" class="ad-btn" data-open="edit">Edit wording</button>';
    if (x.kind === 'answer' && live(x) && x.others && x.others.length) h += '<button type="button" class="ad-btn" data-open="merge">Merge</button>';
    h += '</div>';
    if (x.kind === 'ask') h += '<div class="ad-panel" data-panel="edit" hidden><p class="small muted">Answers stay with the ask, so keep the meaning the same. If the meaning was unclear, hide it instead.</p>' +
      '<label>Ask<input type="text" data-rtitle maxlength="120" value="' + esc(x.title) + '"></label>' +
      '<label>Background (optional)<input type="text" data-rwhy maxlength="300" value="' + esc(x.why || '') + '"></label>' +
      '<div class="ad-acts"><button type="button" class="ad-btn ad-primary" data-rename data-wid="' + esc(x.wid) + '">Save wording</button><button type="button" class="ad-btn" data-open="edit">Cancel</button></div></div>';
    if (x.kind === 'answer' && x.others && x.others.length) h += '<div class="ad-panel" data-panel="merge" hidden><label>Same as which answer? Votes move over.<select data-minto>' + x.others.map(function (o) { return '<option value="' + esc(o.key) + '">' + esc(o.label) + '</option>'; }).join('') + '</select></label>' +
      '<label>Name to show after merging (optional)<input type="text" data-mlabel maxlength="60" placeholder="Keep the current name"></label>' +
      '<div class="ad-acts"><button type="button" class="ad-btn ad-primary" data-merge data-wid="' + esc(x.wid) + '" data-from="' + esc(x.okey) + '">Merge</button><button type="button" class="ad-btn" data-open="merge">Cancel</button></div></div>';
    return h + '</article>';
  }
  function api(src, body) {
    return fetch(src === 'c' ? '/api/have-your-say/' : '/api/wants/', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }

  // ---------- Data ----------
  var W = [], C = [], wantsMeta = { titles: {}, answers: {} };
  var wFilter = 'live', cFilter = 'live', wQuery = '';
  function loadAll() {
    return Promise.all([
      fetch('/api/wants/?admin=1', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch('/api/have-your-say/?admin=1', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }).then(function (r) { return r.json(); }),
    ]).then(function (res) {
      var d = res[0], cd = res[1];
      if (d.ok) {
        wantsMeta = { titles: d.titles || {}, answers: d.answers || {} };
        d.asks.forEach(function (a) { wantsMeta.titles[a.id] = a.title; });
        W = d.asks.map(function (a) { return { src: 'w', kind: 'ask', wid: a.id, title: a.title, why: a.why, text: a.body, status: a.status, reports: a.reports, at: a.created_at, n: wantsMeta.answers[a.id] || 0, question: a.title }; })
          .concat(d.notes.map(function (n) { return { src: 'w', kind: 'words', wid: n.wid, nid: n.nid, title: n.text, text: '', status: n.status, at: n.at, question: wantsMeta.titles[n.wid] || n.wid }; }))
          .concat((d.options || []).map(function (o) { return { src: 'w', kind: 'answer', wid: o.wid, okey: o.okey, title: o.label, text: o.text, status: o.status, reports: o.reports, at: o.at, others: o.others, question: o.question }; }));
      }
      if (cd.ok) C = cd.comments.map(function (c) { return { src: 'c', kind: 'comment', qid: c.qid, cid: c.cid, title: c.text, text: '', note: c.note, status: c.status, reports: c.reports, at: c.at, question: c.ask, choice: c.choice }; });
      draw();
    }).catch(function () { document.getElementById('a-sum').textContent = 'Could not load. Reload the page.'; });
  }
  function newest(a, b) { return String(b.at || '').localeCompare(String(a.at || '')); }
  function pass(x, f) { return f === 'all' || (f === 'live' ? live(x) : !live(x)); }
  function chips(name, cur) {
    return '<div class="ad-chips" data-chips="' + name + '">' + [['live', 'Live'], ['off', 'Hidden'], ['all', 'All']].map(function (c) { return '<button type="button" data-f="' + c[0] + '" aria-pressed="' + (cur === c[0]) + '">' + c[1] + '</button>'; }).join('') + '</div>';
  }

  function draw() {
    var todo = W.concat(C).filter(needs).sort(newest);
    var day = W.concat(C).filter(function (x) { return x.at && Date.now() - new Date(x.at) < 864e5; }).length;
    document.getElementById('a-sum').textContent = (todo.length ? todo.length + ' thing' + (todo.length === 1 ? '' : 's') + ' need' + (todo.length === 1 ? 's' : '') + ' a look' : 'Nothing needs you right now') + ' · ' + day + ' new in the last day';
    badge('review', todo.length, true);
    badge('wants', W.filter(live).length, false);
    badge('comments', C.filter(live).length, false);

    // To review
    document.getElementById('r-out').innerHTML = todo.length ? todo.map(function (x) { return card(x, { context: true }); }).join('')
      : '<div class="ad-empty"><p><b>All clear.</b> Nothing is held back or reported.</p><p class="small">New things residents add show up in the other tabs.</p></div>';

    // What Squamish Wants, grouped under each question
    var q = wQuery.toLowerCase();
    var items = W.filter(function (x) { return pass(x, wFilter) && (!q || (x.title + ' ' + (x.text || '') + ' ' + (x.question || '')).toLowerCase().indexOf(q) > -1); });
    var groups = {}, order = [];
    items.forEach(function (x) {
      var g = groups[x.wid] || (groups[x.wid] = { wid: x.wid, ask: null, kids: [], last: '' });
      if (x.kind === 'ask') g.ask = x; else g.kids.push(x);
      if (String(x.at) > g.last) g.last = String(x.at);
    });
    Object.keys(groups).forEach(function (k) { order.push(groups[k]); });
    order.sort(function (a, b) { return b.last.localeCompare(a.last); });
    document.getElementById('w-out').innerHTML = '<div class="ad-bar">' + chips('w', wFilter) + '<input type="search" class="ad-search" data-wq placeholder="Search asks and answers" value="' + esc(wQuery) + '"></div>' +
      '<p class="small muted ad-count">' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' under ' + order.length + ' question' + (order.length === 1 ? '' : 's') + '</p>' +
      (order.length ? order.map(function (g) {
        var title = wantsMeta.titles[g.wid] || g.wid, resident = /^r-/.test(g.wid);
        var head = g.ask ? '' : '<header><p class="ad-gk">' + (resident ? 'Resident’s ask' : 'Starter question') + (wantsMeta.answers[g.wid] ? ' · ' + wantsMeta.answers[g.wid] + ' answered' : '') + '</p><h3><a href="/wants/' + esc(g.wid) + '/" target="_blank" rel="noopener">' + esc(title) + '</a></h3></header>';
        return '<section class="ad-group' + (g.ask && !g.kids.length ? ' ad-solo' : '') + '">' + head +
          (g.ask ? card(g.ask) : '') +
          (g.kids.length ? '<div class="ad-kids">' + g.kids.sort(newest).map(function (x) { return card(x); }).join('') + '</div>' : '') + '</section>';
      }).join('') : '<div class="ad-empty"><p>Nothing here.</p></div>');

    // Have your say comments
    var cs = C.filter(function (x) { return pass(x, cFilter); }).sort(newest);
    document.getElementById('c-out').innerHTML = '<div class="ad-bar">' + chips('c', cFilter) + '</div><p class="small muted ad-count">' + cs.length + ' comment' + (cs.length === 1 ? '' : 's') + '. Live ones are public on Have your say.</p>' +
      (cs.length ? cs.map(function (x) { return card(x, { context: true }); }).join('') : '<div class="ad-empty"><p>Nothing here.</p></div>');
  }

  var main = document.getElementById('ad-main');
  main.addEventListener('click', function (e) {
    var c = e.target.closest('[data-chips] [data-f]');
    if (c) { if (c.parentNode.getAttribute('data-chips') === 'w') wFilter = c.getAttribute('data-f'); else cFilter = c.getAttribute('data-f'); draw(); return; }
    var o = e.target.closest('[data-open]');
    if (o) { var p = o.closest('.ad-item').querySelector('[data-panel="' + o.getAttribute('data-open') + '"]'); p.hidden = !p.hidden; return; }
    var rb = e.target.closest('[data-rename]');
    if (rb) {
      var box = rb.closest('.ad-panel'); rb.disabled = true;
      api('w', { admin: 'rename', wid: rb.getAttribute('data-wid'), title: box.querySelector('[data-rtitle]').value.trim(), why: box.querySelector('[data-rwhy]').value.trim() })
        .then(function (j) { if (!j.ok) { rb.disabled = false; rb.textContent = j.error || 'Could not save'; return; } loadAll(); });
      return;
    }
    var mb = e.target.closest('[data-merge]');
    if (mb) {
      var mbox = mb.closest('.ad-panel'), lab = mbox.querySelector('[data-mlabel]').value.trim(); mb.disabled = true;
      api('w', { admin: 'merge', wid: mb.getAttribute('data-wid'), from: mb.getAttribute('data-from'), into: mbox.querySelector('[data-minto]').value, label: lab || undefined })
        .then(function (j) { if (!j.ok) { mb.disabled = false; mb.textContent = j.error || 'Could not merge'; return; } loadAll(); });
      return;
    }
    var b = e.target.closest('[data-mod]');
    if (b) {
      b.disabled = true; b.textContent = '…';
      var a = function (k) { return b.getAttribute(k) || undefined; };
      api(a('data-src'), a('data-src') === 'c' ? { admin: a('data-mod'), qid: a('data-qid'), cid: a('data-cid') } : { admin: a('data-mod'), wid: a('data-wid'), nid: a('data-nid'), okey: a('data-okey') }).then(loadAll);
    }
  });
  var qt;
  main.addEventListener('input', function (e) {
    if (!e.target.matches('[data-wq]')) return;
    clearTimeout(qt); qt = setTimeout(function () { wQuery = e.target.value; draw(); var s = document.querySelector('[data-wq]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 200);
  });
  loadAll();
})();
