/* Private sign-ups view at /subscribers/#t=<ADMIN_TOKEN>. The token stays in the hash so it never reaches a server log. */
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

  if (!token) { status.textContent = 'Open this page with the private link (it ends in #t=…).'; return; }
  history.replaceState(null, '', location.pathname); // drop the token from the address bar once it's saved
  fetch('/api/subscribers/', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
    .then(function (r) { if (r.status === 401) throw new Error('That link’s key is wrong.'); return r.json(); })
    .then(function (d) { if (!d.ok) throw new Error(d.error || 'Could not load'); render(d.rows); })
    .catch(function (e) { status.textContent = e.message; });

  // Have your say comments: everything people wrote, with its status, and a button to hide or bring back each one.
  var cbox = document.getElementById('c-out');
  var CST = { ok: 'Posted', pending: 'Waiting for check', hidden: 'Held by the check', reported: 'Hidden by reports', removed: 'Removed by you' };
  function loadComments() {
    fetch('/api/have-your-say/?admin=1', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { cbox.textContent = 'Could not load comments.'; return; }
      if (!d.comments.length) { cbox.innerHTML = '<p class="muted">No comments yet.</p>'; return; }
      cbox.innerHTML = d.comments.map(function (c) {
        var showing = c.status === 'ok';
        return '<div class="sb-person' + (showing ? '' : ' sb-dim') + '"><p class="sb-top"><span class="sb-pill">' + esc(CST[c.status] || c.status) + '</span><span class="small">' + esc(c.choice) + (c.reports ? ' · ' + c.reports + ' report' + (c.reports === 1 ? '' : 's') : '') + (c.at ? ' · ' + esc(new Date(c.at).toLocaleString('en-CA')) : '') + '</span></p>' +
          '<p class="small muted">' + esc(c.ask) + '</p><p>' + esc(c.text) + '</p>' + (c.note ? '<p class="small sb-note">' + esc(c.note) + '</p>' : '') +
          '<button type="button" class="btn secondary" data-cmod="' + (showing ? 'hide' : 'show') + '" data-qid="' + esc(c.qid) + '" data-cid="' + esc(c.cid) + '">' + (showing ? 'Hide it' : 'Post it') + '</button></div>';
      }).join('');
    }).catch(function () { cbox.textContent = 'Could not load comments.'; });
  }
  if (cbox) {
    loadComments();
    cbox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cmod]'); if (!b) return;
      b.disabled = true;
      fetch('/api/have-your-say/', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: b.getAttribute('data-cmod'), qid: b.getAttribute('data-qid'), cid: b.getAttribute('data-cid') }) }).then(loadComments);
    });
  }

  // What Squamish Wants: residents' asks and the words people added to existing asks, with hide and bring back.
  var wbox = document.getElementById('w-out');
  var WST = { merged: 'Merged into another answer', ok: 'Posted', pending: 'Waiting for check', reported: 'Hidden by reports', removed: 'Removed by you' };
  function loadWants() {
    fetch('/api/wants/?admin=1', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { wbox.textContent = 'Could not load.'; return; }
      var items = d.asks.map(function (a) { return { kind: 'ask', wid: a.id, title: a.title, text: a.body, status: a.status, reports: a.reports, at: a.created_at }; })
        .concat(d.notes.map(function (n) { return { kind: 'words', wid: n.wid, nid: n.nid, title: 'Words added to: ' + n.wid, text: n.text, status: n.status, at: n.at }; }))
        .concat((d.options || []).map(function (o) { return { kind: 'answer', wid: o.wid, okey: o.okey, title: o.label + ' (answer added to: ' + o.question + ')', text: o.text, status: o.status, reports: o.reports, at: o.at, others: o.others, label: o.label }; }))
        .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      if (!items.length) { wbox.innerHTML = '<p class="muted">Nothing added by residents yet.</p>'; return; }
      wbox.innerHTML = items.map(function (x) {
        var showing = x.status === 'ok';
        return '<div class="sb-person' + (showing ? '' : ' sb-dim') + '"><p class="sb-top"><span class="sb-pill">' + esc(WST[x.status] || x.status) + '</span><span class="small">' + ({ ask: 'New ask', words: 'Added words', answer: 'Added answer' }[x.kind]) + (x.reports ? ' · ' + x.reports + ' report' + (x.reports === 1 ? '' : 's') : '') + (x.at ? ' · ' + esc(new Date(x.at).toLocaleString('en-CA')) : '') + '</span></p>' +
          '<p><b>' + esc(x.title) + '</b></p><p class="small sb-note">' + esc(x.text || '') + '</p>' +
          (x.kind === 'ask' && showing ? '<p class="small"><a href="/wants/#' + esc(x.wid) + '">See it on the list</a></p>' : '') +
          (x.kind === 'answer' && showing && x.others && x.others.length ? '<div class="sb-merge"><label class="small">Same as another answer? Merge it, votes and all:<select data-minto>' + x.others.map(function (o) { return '<option value="' + esc(o.key) + '">' + esc(o.label) + '</option>'; }).join('') + '</select></label>' +
            '<label class="small">Name to show after merging (optional)<input type="text" data-mlabel maxlength="60" placeholder="Keep the current name"></label>' +
            '<button type="button" class="btn secondary" data-merge data-wid="' + esc(x.wid) + '" data-from="' + esc(x.okey) + '">Merge into that answer</button></div>' : '') +
          '<button type="button" class="btn secondary" data-wmod="' + (showing ? 'hide' : 'show') + '" data-wid="' + esc(x.wid) + '"' + (x.nid ? ' data-nid="' + esc(x.nid) + '"' : '') + (x.okey ? ' data-okey="' + esc(x.okey) + '"' : '') + '>' + (showing ? 'Hide it' : 'Post it') + '</button></div>';
      }).join('');
    }).catch(function () { wbox.textContent = 'Could not load.'; });
  }
  if (wbox) {
    loadWants();
    wbox.addEventListener('click', function (e) {
      var mb = e.target.closest('[data-merge]');
      if (mb) {
        var box = mb.closest('.sb-merge'), into = box.querySelector('[data-minto]').value, lab = box.querySelector('[data-mlabel]').value.trim();
        mb.disabled = true;
        fetch('/api/wants/', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: 'merge', wid: mb.getAttribute('data-wid'), from: mb.getAttribute('data-from'), into: into, label: lab || undefined }) })
          .then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) { mb.disabled = false; mb.textContent = j.error || 'Could not merge'; return; } loadWants(); });
        return;
      }
      var b = e.target.closest('[data-wmod]'); if (!b) return;
      b.disabled = true;
      fetch('/api/wants/', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: b.getAttribute('data-wmod'), wid: b.getAttribute('data-wid'), nid: b.getAttribute('data-nid') || undefined, okey: b.getAttribute('data-okey') || undefined }) }).then(loadWants);
    });
  }
})();
