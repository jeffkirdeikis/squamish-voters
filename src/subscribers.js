/* Private sign-ups view at /subscribers/#t=<ADMIN_TOKEN>. The token stays in the hash so it never reaches a server log. */
(function () {
  var L = window.SV_SUBS || { issues: {}, hoods: {} };
  var out = document.getElementById('s-out'), status = document.getElementById('s-status');
  var token = (location.hash.match(/t=([^&]+)/) || [])[1] || '';
  try { if (token) localStorage.setItem('sv-admin', token); else token = localStorage.getItem('sv-admin') || ''; } catch (e) {}
  var STATUS = { subscribed: 'Confirmed', pending: 'Waiting to confirm', unsubscribed: 'Unsubscribed' };

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
})();
