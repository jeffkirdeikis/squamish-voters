/* Private reader stats page at /insights/ (api/insights.js). Uses the same saved admin key as /subscribers/. */
(function () {
  var out = document.getElementById('in-out'), sum = document.getElementById('in-sum');
  var token = (location.hash.match(/t=([^&]+)/) || [])[1] || '';
  try { if (token) { localStorage.setItem('sv-admin', token); history.replaceState(null, '', location.pathname); } else token = localStorage.getItem('sv-admin') || ''; } catch (e) {}
  var range = 'today', focus = '';
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function dur(s) { s = Math.round(s || 0); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60 ? (s % 60) + ' s' : ''); }
  function when(t) { return new Date(t).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function tile(n, label, goal) { var t = el('div', 'in-tile' + (goal ? ' goal' : '')); t.append(el('b', '', n), el('span', '', label)); return t; }
  function tiles(list) { var w = el('div', 'in-tiles'); list.forEach(function (x) { if (x) w.append(tile(x[0], x[1], x[2])); }); return w; }
  function bar(label, n, max, total, cls) {
    var row = el('div', 'sb-row'); row.append(el('span', 'sb-label', label));
    var tr = el('span', 'sb-track'), f = el('span', 'sb-fill'); f.style.width = (max ? 100 * n / max : 0) + '%'; tr.append(f); row.append(tr);
    row.append(el('span', 'sb-n', n + (total ? ' (' + Math.round(100 * n / total) + '%)' : ''))); return row;
  }
  function bars(items, total, cls) { var w = el('div', cls || ''), max = Math.max.apply(null, items.map(function (i) { return i.n; }).concat([1])); items.forEach(function (i) { w.append(bar(i.label || i.k || i.name, i.n, max, total)); }); return w; }
  function table(heads, rows) {
    var wrap = el('div', 'in-tablewrap'), t = el('table'), hr = el('tr');
    heads.forEach(function (h) { hr.append(el('th', '', h)); }); t.append(hr);
    rows.forEach(function (r) { var tr = el('tr'); r.forEach(function (c) { var td = el('td'); if (c && c.nodeType) td.append(c); else td.textContent = c; tr.append(td); }); t.append(tr); });
    wrap.append(t); return wrap;
  }
  function groupTable(first, g) {
    return table([first, 'Visits', 'Typical time on site', 'Opened a second page', 'Email sign-ups', 'Facebook group taps', 'Reddit taps', 'Shared'],
      g.map(function (r) { return [r.k, r.visits, dur(r.medSecs), r.wentOn + '%', r.signups + ' (' + r.signupRate + '%)', r.fb + ' (' + r.fbRate + '%)', r.reddit + ' (' + r.redditRate + '%)', r.shares + ' (' + r.shareRate + '%)']; }));
  }
  function h(tag, text, sub) { var f = document.createDocumentFragment(); f.append(el(tag, '', text)); if (sub) f.append(el('p', 'small muted', sub)); return f; }

  function render(d) {
    out.textContent = '';
    var s = d.site;
    sum.textContent = s.visits + ' visits and ' + s.views + ' pages read, ' + ({ today: 'today', yesterday: 'yesterday', '7d': 'in the last 7 days', '30d': 'in the last 30 days' })[d.range] + '. Updated ' + new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) + '.';
    if (d.since) out.append(el('p', 'in-note', 'Counting started ' + when(d.since) + '. Visits before that are not in these numbers.'));
    if (!s.visits) { out.append(el('p', 'muted', 'No visits counted in these dates yet.')); return; }

    out.append(h('h2', 'Whole site'));
    out.append(tiles([
      [s.visits, 'visits'], [s.pagesPerVisit, 'pages per visit'], [s.wentOn + '%', 'opened a second page'], [dur(s.medSecs), 'typical time on site (half stay longer)'],
      [s.signups + ' (' + s.signupRate + '%)', 'email sign-ups sent', 1], [s.fb + ' (' + s.fbRate + '%)', 'tapped the Facebook group', 1], [s.reddit + ' (' + s.redditRate + '%)', 'tapped the Reddit group', 1],
      [s.shares + ' (' + s.shareRate + '%)', 'shared something'], [s.returning + '%', 'had been here before'],
    ]));
    out.append(h('h3', d.range === 'today' || d.range === 'yesterday' ? 'Visits by hour' : 'Visits by day'));
    out.append(bars(d.timeline, 0));
    out.append(h('h3', 'Where visits came from'));
    out.append(groupTable('Came from', s.sources));

    // one page in depth
    var f = d.focus;
    if (f) {
      out.append(h('h2', 'One page in depth'));
      var sel = el('select'); sel.setAttribute('aria-label', 'Page');
      d.pages.forEach(function (p) { var o = el('option', '', (p.title || p.path) + ' (' + p.views + ')'); o.value = p.path; if (p.path === f.path) o.selected = true; sel.append(o); });
      sel.addEventListener('change', function () { focus = sel.value; load(); });
      out.append(sel);
      var a = el('a', 'small', f.path); a.href = f.path; a.target = '_blank'; var pp = el('p'); pp.append(a); out.append(pp);
      out.append(tiles([
        [f.views, 'times opened'], [f.landedHere, 'visits that started here'], [dur(f.pageMedSecs), 'typical time on this page'], [dur(f.pageAvgSecs), 'average time on this page'],
        [f.medScroll + '%', 'typical distance down the page'], [(100 - f.onlyPage).toFixed(0) + '%', 'went on to another page'], [f.onlyPage + '%', 'read only this page and left'],
        [f.signups + ' (' + f.signupRate + '%)', 'email sign-ups sent', 1], [f.tried - f.signups > 0 ? f.tried - f.signups : 0, 'pressed sign up but it did not go through'],
        [f.fb + ' (' + f.fbRate + '%)', 'tapped the Facebook group', 1], [f.reddit + ' (' + f.redditRate + '%)', 'tapped the Reddit group', 1], [f.shares + ' (' + f.shareRate + '%)', 'shared it'],
      ]));
      // plain reading of the numbers
      var read = el('div', 'in-read'), big = f.sections.filter(function (x, i) { return i > 0 && f.sections[i - 1].n - x.n >= Math.max(3, f.views * 0.08); })
        .sort(function (x, y) { return (f.sections[f.sections.indexOf(y) - 1].n - y.n) - (f.sections[f.sections.indexOf(x) - 1].n - x.n); })[0];
      var quick = f.time[0].n, total = f.views;
      read.append(el('p', '', Math.round(100 * quick / total) + '% left within 10 seconds. ' + Math.round(100 * (f.time[3].n + f.time[4].n + f.time[5].n) / total) + '% stayed over a minute.'));
      if (big) read.append(el('p', '', 'Biggest drop: ' + (f.sections[f.sections.indexOf(big) - 1].n - big.n) + ' readers stopped just before “' + big.name + '”.'));
      if (f.signupAfterSecs) read.append(el('p', '', 'People who signed up did it about ' + dur(f.signupAfterSecs) + ' into the page.'));
      if (f.fbAfterSecs || f.redditAfterSecs) read.append(el('p', '', 'Group taps came about ' + dur(f.fbAfterSecs || f.redditAfterSecs) + ' into the page.'));
      out.append(read);

      out.append(h('h3', 'How long they stayed on this page'));
      out.append(bars(f.time, total));
      out.append(h('h3', 'How far down they got'));
      out.append(bars(f.scroll, total));
      if (f.sections.length) {
        out.append(h('h3', 'Readers left at each heading', 'Each bar is how many readers got as far as that heading. A big step down between two bars is where people give up.'));
        out.append(bars(f.sections.map(function (x) { return { label: x.name, n: x.n }; }), total, 'in-drop'));
      }
      out.append(h('h3', 'What they did next'));
      out.append(bars(f.next.map(function (x) { return { label: x.k, n: x.n }; }), total));
      if (f.prev.length) { out.append(h('h3', 'Page they were on before this one')); out.append(bars(f.prev.map(function (x) { return { label: x.k, n: x.n }; }), 0)); }
      out.append(h('h3', 'By where they came from')); out.append(groupTable('Came from', f.sources));
      out.append(h('h3', 'Phone or computer')); out.append(groupTable('Screen', f.devices));
      out.append(h('h3', 'First time or back again')); out.append(groupTable('Visitor', f.visitors));
      out.append(h('h3', 'Town', 'A guess from the internet connection. Phones on mobile data often show Vancouver.')); out.append(groupTable('Town', f.towns));
      if (f.taps.length) {
        var NAMES = { nav: 'Went to a page', out: 'Left to another site', opened: 'Opened a fold out', share: 'Shared', jump: 'Jumped within the page', signup: 'Email sign-up sent', 'signup try': 'Pressed a sign-up button', 'facebook group': 'Tapped Facebook group', 'reddit group': 'Tapped Reddit group', 'email box tapped': 'Tapped an email box' };
        out.append(h('h3', 'Everything tapped on this page'));
        out.append(table(['What', 'Detail', 'Times'], f.taps.map(function (t) { return [NAMES[t.name] || t.name, t.detail, t.n]; })));
      }
    }

    out.append(h('h2', 'All pages'));
    out.append(table(['Page', 'Opened', 'Typical time', 'Typical distance down', 'Visits that started here', 'Left the site from here'],
      d.pages.map(function (p) { var b = el('a', '', p.title || p.path); b.href = '#'; b.addEventListener('click', function (e) { e.preventDefault(); focus = p.path; load(); window.scrollTo(0, 0); }); return [b, p.views, dur(p.medSecs), p.medScroll + '%', p.entries, p.exitRate + '%']; })));

    out.append(h('h2', 'Latest visits, page by page'));
    var list = el('div');
    d.recent.forEach(function (v) {
      var box = el('div', 'in-visit'), top = el('p');
      v.did.forEach(function (x) { top.append(el('span', 'in-pill', x)); });
      top.append(el('b', '', when(v.at) + ' · ' + v.src + ' · ' + (v.dev || '') + (v.city ? ' · ' + v.city : '') + (v.ret ? ' · back again' : '')));
      box.append(top);
      v.pages.forEach(function (p, i) { box.append(el('p', 'small', (i + 1) + '. ' + p.path + ' · ' + dur(p.secs) + ' · ' + p.scroll + '% down' + (p.sec ? ' · got to “' + p.sec + '”' : ''))); });
      list.append(box);
    });
    out.append(list);
  }

  function load() {
    if (!token) { sum.textContent = 'Open this page once with your admin link to unlock it.'; return; }
    sum.textContent = 'Loading…';
    fetch('/api/insights/?range=' + range + (focus ? '&focus=' + encodeURIComponent(focus) : ''), { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { if (r.status === 401) throw new Error('That admin key was not accepted. Open the page again with your admin link.'); return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || 'Could not load'); render(d); })
      .catch(function (e) { sum.textContent = e.message; });
  }
  document.querySelectorAll('[data-range]').forEach(function (b) {
    b.addEventListener('click', function () { range = b.getAttribute('data-range'); document.querySelectorAll('[data-range]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); load(); });
  });
  document.getElementById('in-refresh').addEventListener('click', load);
  load();
})();
