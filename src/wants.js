/* What Squamish Wants (/wants/, and a short version on Home and /your-say/).
   The full list is the front door: every ask has Yes / No / Don't mind right on its row. The totals stay hidden until
   you answer or tap the ask, so people answer before they see the crowd and have a reason to open each one.
   Ranking: share of yes among yes and no ("don't mind" stays out of the percentage so a local ask isn't buried by people
   it doesn't affect), ties broken by how many answered. Ranked from the first answer.
   Adding an ask: Claude checks the rules, writes a short neutral ask, and lists asks already on the list that look the
   same, so the writer can answer that one or add their words to it instead of posting a copy. */
(function () {
  var root = document.querySelector('[data-wants]');
  var dataEl = document.getElementById('wa-data');
  if (!root || !dataEl) return;
  var D = JSON.parse(dataEl.textContent);
  var mode = root.getAttribute('data-wants') || 'page'; // page | short
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(n, d) { if (window.SV && SV.track) try { SV.track(n, d); } catch (e) {} }
  function toast(m) { if (window.SV && SV.toast) SV.toast(m); }
  var voter = get('sv_voter', '');
  if (!voter) { voter = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)); put('sv_voter', voter); }
  var prefs = get('sv_prefs', { area: '', topics: [] });

  var asks = D.asks.slice(), tallies = {}, mine = {}, notes = {}, loaded = false;
  var view = 'list', topic = 'all', sort = 'wanted', openId = null, focusId = D.focus || (location.hash || '').slice(1) || null, deckSkip = {}, deckShown = null;
  var reported = {}, pending = {};
  // The order is frozen while someone is answering, so rows never jump under their finger. It is worked out again only
  // when they change the sort, filter or neighbourhood, or come back to the page.
  var order = null, shortOrder = null, touched = false;
  var STATUS = D.statuses, HOODS = D.hoods, TOPIC = {};
  D.topics.forEach(function (t) { TOPIC[t.key] = t.label; });
  function byId(id) { for (var i = 0; i < asks.length; i++) if (asks[i].id === id) return asks[i]; return null; }
  function t(id) { return tallies[id] || { y: 0, n: 0, m: 0, areas: {} }; }
  function total(x) { return x.y + x.n + x.m; }
  function pct(n, d) { return d ? Math.round((100 * n) / d) : 0; }
  function score(a) { var x = t(a.id), o = x.y + x.n; return o ? x.y / o : -1; }
  function linkOf(a) { return location.origin + (a.res ? '/wants/#' + a.id : '/wants/' + a.id + '/'); }

  // ---------- pieces ----------
  function chips(a) {
    var s = STATUS[a.res ? 'resident' : a.status] || STATUS.none;
    return '<span class="wa-chips">' + (a.area && HOODS[a.area] ? '<span class="wa-chip area">' + esc(HOODS[a.area]) + '</span>' : '') +
      '<span class="wa-chip ' + s.cls + '">' + esc(s.label) + '</span></span>';
  }
  function bar(x) {
    var n = total(x);
    if (!n) return '<p class="wa-first">No answers yet. Yours is the first.</p>';
    return '<div class="wa-bar" role="img" aria-label="' + pct(x.y, n) + '% yes, ' + pct(x.m, n) + '% don’t mind, ' + pct(x.n, n) + '% no"><i class="y" style="width:' + pct(x.y, n) + '%"></i><i class="m" style="width:' + pct(x.m, n) + '%"></i><i class="n" style="width:' + pct(x.n, n) + '%"></i></div>';
  }
  function totals(a) {
    var x = t(a.id), n = total(x), o = x.y + x.n;
    var out = '<div class="wa-totals">' + bar(x);
    if (n) out += '<p class="wa-legend">' + '<em>' + (o ? '<b>' + pct(x.y, o) + '% yes</b> of people with an opinion' : '<b>No one has said yes or no yet</b>') + '</em>' +
      '<span>' + n + ' answer' + (n === 1 ? '' : 's') + '</span><span>' + x.y + ' yes · ' + x.n + ' no · ' + x.m + ' don’t mind</span></p>';
    var ar = a.area || prefs.area, ax = ar && x.areas && x.areas[ar];
    if (ax && HOODS[ar]) { var ao = ax.y + ax.n; out += '<p class="wa-local"><b>' + esc(HOODS[ar]) + ':</b> ' + (ao ? pct(ax.y, ao) + '% yes among people there with an opinion' : 'no one there has said yes or no yet') + ' (' + total(ax) + ' answers)</p>'; }
    return out + '</div>';
  }
  var WORD = { y: 'Yes', n: 'No', m: 'Don’t mind' };
  function buttons(a, big) {
    var my = mine[a.id];
    return '<div class="wa-ans' + (big ? ' big' : '') + '" role="group" aria-label="Your answer">' + ['y', 'n', 'm'].map(function (k) {
      return '<button type="button" class="wa-b ' + k + '" data-ans="' + k + '" data-id="' + esc(a.id) + '" aria-pressed="' + (my === k) + '">' + WORD[k] + '</button>';
    }).join('') + '</div>';
  }
  function detail(a) {
    var who = a.res ? '' : '<dt>Who decides</dt><dd>' + (a.who === 'province' ? 'The Province. Council can press for it.' : 'Squamish council') + '</dd>';
    var ns = notes[a.id] || [];
    return '<div class="wa-detail">' +
      (a.why ? '<p>' + esc(a.why) + '</p>' : '') +
      '<dl>' + who + '<dt>Topic</dt><dd>' + esc(TOPIC[a.topic] || 'Everything else') + '</dd>' +
      (a.other_side ? '<dt>The other side</dt><dd>' + esc(a.other_side) + '</dd>' : '') +
      (a.source_url ? '<dt>Source</dt><dd><a href="' + esc(a.source_url) + '"' + (/^https?:/.test(a.source_url) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(a.source_label || 'Source') + '</a></dd>' : '') + '</dl>' +
      (a.res && a.body ? '<div class="wa-words"><b>In the words of the resident who added it</b><p>' + esc(a.body) + '</p></div>' : '') +
      (ns.length ? '<div class="wa-words"><b>More from residents</b>' + ns.slice(0, 20).map(function (n) { return '<p>' + esc(n.text) + '</p>'; }).join('') + '</div>' : '') +
      '<p class="wa-acts"><button type="button" class="wa-link" data-share="' + esc(a.id) + '">Share this ask</button>' +
      (a.res ? (reported[a.id] ? '<span class="small muted">Thanks, reported.</span>' : '<button type="button" class="wa-link muted" data-report="' + esc(a.id) + '">Report</button>') : '') + '</p>' +
      '</div>';
  }
  function row(a) {
    var my = mine[a.id], open = openId === a.id, show = my || open;
    return '<li class="wa-row' + (my ? ' answered' : '') + (open ? ' open' : '') + '" id="ask-' + esc(a.id) + '">' +
      '<button type="button" class="wa-title" data-open="' + esc(a.id) + '" aria-expanded="' + open + '">' + chips(a) + '<span class="wa-t">' + esc(a.title) + '</span></button>' +
      buttons(a) + (show ? totals(a) : '<button type="button" class="wa-door" data-open="' + esc(a.id) + '">See what Squamish said <span aria-hidden="true">→</span></button>') +
      (open ? detail(a) + '<button type="button" class="wa-door" data-open="' + esc(a.id) + '">Close</button>' : '') + '</li>';
  }

  // ---------- list ----------
  function listed() {
    if (order) return order.map(byId).filter(Boolean);
    var area = prefs.area;
    var L = asks.filter(function (a) {
      if (topic === 'all') return true;
      if (topic === 'near') return area && a.area === area;
      if (topic === 'todo') return !mine[a.id];
      return a.topic === topic;
    });
    var key = {
      wanted: function (a) { return score(a) * 1e6 + (t(a.id).y + t(a.id).n); },
      split: function (a) { var x = t(a.id), o = x.y + x.n; return o ? (1 - Math.abs(x.y - x.n) / o) * 1e6 + o : -1; },
      voted: function (a) { return total(t(a.id)); },
      newest: function (a) { return a.res ? Date.parse(a.created_at) || 0 : -1; },
    }[sort];
    L.sort(function (p, q) { return key(q) - key(p); });
    if (focusId) { var f = byId(focusId); if (f && L.indexOf(f) > -1) { L.splice(L.indexOf(f), 1); L.unshift(f); } }
    order = L.map(function (a) { return a.id; });
    return L;
  }
  function drawList() {
    var el = root.querySelector('[data-wa-rows]'); if (!el) return;
    var L = listed(), done = asks.filter(function (a) { return mine[a.id]; }).length;
    root.querySelector('[data-wa-count]').textContent = L.length + ' ask' + (L.length === 1 ? '' : 's') + ' · you’ve answered ' + done;
    el.innerHTML = L.length ? L.map(row).join('') : '<li class="wa-empty">' + (topic === 'near' && !prefs.area ? 'Pick your neighbourhood above to see asks near you.' : topic === 'todo' ? 'You’ve answered every ask on this list. Thank you.' : 'Nothing here yet. Add one below.') + '</li>';
  }

  // ---------- one at a time ----------
  function deck() {
    var area = prefs.area;
    return asks.filter(function (a) { return !mine[a.id] && !deckSkip[a.id]; }).sort(function (p, q) {
      var lp = p.area && p.area === area ? 0 : 1, lq = q.area && q.area === area ? 0 : 1;
      return lp - lq || total(t(p.id)) - total(t(q.id));
    });
  }
  function drawOne() {
    var el = root.querySelector('[data-wa-one]'); if (!el) return;
    var done = asks.filter(function (a) { return mine[a.id]; }).length;
    var prog = '<div class="wa-prog" aria-hidden="true"><i style="width:' + pct(done, asks.length) + '%"></i></div><p class="small muted">' + done + ' of ' + asks.length + ' answered</p>';
    var a = deckShown && byId(deckShown);
    if (a && mine[a.id]) {
      var x = t(a.id), n = total(x), my = mine[a.id];
      var same = my === 'y' ? x.y : my === 'n' ? x.n : x.m;
      el.innerHTML = prog + '<div class="wa-card">' + chips(a) + '<h2>' + esc(a.title) + '</h2><p class="wa-you">' +
        (n > 1 ? 'You and ' + pct(same, n) + '% of people ' + (my === 'y' ? 'said yes.' : my === 'n' ? 'said no.' : 'don’t mind either way.') : 'You’re the first to answer this one.') + '</p>' +
        totals(a) + '<button type="button" class="btn block" data-next>Next ask</button></div>';
      return;
    }
    var L = deck(); a = L[0];
    if (!a) { el.innerHTML = prog + '<div class="wa-card wa-done"><h2>That’s every ask for now.</h2><p>New ones go up as residents add them.</p><button type="button" class="btn block" data-view="list">See the full list and the totals</button><button type="button" class="btn secondary block" data-view="add">Add something that’s missing</button></div>'; return; }
    deckShown = a.id;
    el.innerHTML = prog + '<div class="wa-card">' + chips(a) + '<h2>' + esc(a.title) + '</h2>' + (a.why ? '<p>' + esc(a.why) + '</p>' : '') + buttons(a, true) +
      '<button type="button" class="wa-link center" data-skip="' + esc(a.id) + '">Skip this one</button></div>';
  }

  // ---------- add ----------
  var add = { text: '', res: null, stage: 'write', msg: '' };
  function areaSelect(sel) {
    return '<select data-wa-newarea><option value="all">The whole town</option>' + Object.keys(HOODS).filter(function (k) { return k !== 'outside'; }).map(function (k) { return '<option value="' + esc(k) + '"' + (sel === k ? ' selected' : '') + '>' + esc(HOODS[k]) + '</option>'; }).join('') + '</select>';
  }
  function drawAdd() {
    var el = root.querySelector('[data-wa-add]'); if (!el) return;
    var r = add.res, h = '';
    if (add.stage === 'write' || add.stage === 'checking') {
      h = '<label class="fld" for="wa-text">What should Squamish do?<span class="small">Write as much as you like. We’ll turn it into a short ask for the list and keep your words underneath it. Please don’t name private people.</span></label>' +
        '<textarea id="wa-text" rows="6" maxlength="2000" placeholder="For example: the off leash area at John Hunter Park still has no fence, so I can’t let my dog run there with kids nearby.">' + esc(add.text) + '</textarea>' +
        (add.msg ? '<p class="wa-msg bad">' + esc(add.msg) + '</p>' : '') +
        '<button type="button" class="btn block" data-check' + (add.stage === 'checking' ? ' disabled' : '') + '>' + (add.stage === 'checking' ? 'Checking the list…' : 'Check my idea') + '</button>' +
        '<p class="small muted">We check it against the asks already on the list first, so the same idea isn’t added twice.</p>';
    } else if (add.stage === 'similar') {
      h = '<div class="wa-similar"><h3>Is this the same as one already on the list?</h3><p class="small">It looks close to ' + (r.similar.length === 1 ? 'this ask' : 'these asks') + '. If it’s the same idea, answer that one instead so the votes stay together. You can add your words to it too.</p>' +
        r.similar.map(function (s) {
          var a = byId(s.id); if (!a) return '';
          return '<div class="wa-sim"><b>' + esc(a.title) + '</b>' + (s.how ? '<span class="small muted">' + esc(s.how) + '</span>' : '') +
            '<div class="wa-simbtns"><button type="button" class="btn secondary" data-goto="' + esc(a.id) + '">Yes, answer that one</button><button type="button" class="btn secondary" data-addwords="' + esc(a.id) + '">Add my words to it</button></div></div>';
        }).join('') +
        '<button type="button" class="btn block" data-different>No, mine is different</button><button type="button" class="wa-link center" data-rewrite>Change my words</button></div>';
    } else if (add.stage === 'rules') {
      h = '<div class="wa-msg bad"><b>Not quite yet.</b> ' + esc(r.reason || 'It doesn’t fit the list rules.') + '</div><button type="button" class="btn block" data-rewrite>Edit my idea</button>';
    } else if (add.stage === 'preview') {
      var d = r.draft;
      h = '<div class="wa-preview"><p class="small muted">This is how it will look on the list</p><span class="wa-chips"><span class="wa-chip res">Added by a resident</span></span><h3>' + esc(d.title) + '</h3>' + (d.why ? '<p>' + esc(d.why) + '</p>' : '') +
        '<div class="wa-words"><b>In your words</b><p>' + esc(add.text) + '</p></div>' +
        '<label class="fld">Is it about one neighbourhood?' + areaSelect(d.area || 'all') + '</label></div>' +
        (add.msg ? '<p class="wa-msg bad">' + esc(add.msg) + '</p>' : '') +
        '<button type="button" class="btn block" data-post>Add it to the list</button><button type="button" class="wa-link center" data-rewrite>Change my words</button>';
    } else if (add.stage === 'posted') {
      h = '<div class="wa-msg good"><b>' + (add.held ? 'Thanks. It will show on the list after a quick check.' : 'It’s on the list.') + '</b> ' + (add.held ? '' : 'We counted your yes. Share it so your neighbours can answer too.') + '</div>' +
        (add.held ? '' : '<button type="button" class="btn block" data-goto="' + esc(add.newId) + '">See it on the list</button><button type="button" class="btn secondary block" data-share="' + esc(add.newId) + '">Share it</button>') +
        '<button type="button" class="wa-link center" data-again>Add another</button>';
    } else if (add.stage === 'added-words') {
      h = '<div class="wa-msg good"><b>' + (add.held ? 'Thanks. Your words will show after a quick check.' : 'Your words are added to that ask.') + '</b> Don’t forget to answer it.</div><button type="button" class="btn block" data-goto="' + esc(add.wordsId) + '">Go to that ask</button><button type="button" class="wa-link center" data-again>Add something else</button>';
    }
    el.innerHTML = h;
  }

  // ---------- drawing ----------
  function draw() {
    if (mode === 'short') { drawShort(); return; }
    root.querySelectorAll('[data-view]').forEach(function (b) { if (b.closest('[data-wa-tabs]')) b.setAttribute('aria-selected', String(b.getAttribute('data-view') === view)); });
    root.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== view; });
    root.querySelectorAll('[data-topic]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-topic') === topic)); });
    if (view === 'list') drawList(); else if (view === 'one') drawOne(); else drawAdd();
  }
  function drawShort() {
    var el = root.querySelector('[data-wa-rows]'); if (!el) return;
    var area = prefs.area, n = parseInt(root.getAttribute('data-count') || '3', 10);
    if (shortOrder) { el.innerHTML = shortOrder.map(byId).filter(Boolean).map(row).join(''); return; }
    var L = asks.slice().sort(function (p, q) {
      var mp = mine[p.id] ? 1 : 0, mq = mine[q.id] ? 1 : 0, lp = p.area && p.area === area ? 0 : 1, lq = q.area && q.area === area ? 0 : 1;
      return mp - mq || lp - lq || total(t(q.id)) - total(t(p.id));
    }).slice(0, n);
    if (touched) shortOrder = L.map(function (a) { return a.id; });
    el.innerHTML = L.map(row).join('');
  }

  // ---------- server ----------
  function load() {
    fetch('/api/wants/?voter=' + encodeURIComponent(voter)).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) return;
      (j.asks || []).forEach(function (a) { if (!byId(a.id)) asks.push({ id: a.id, title: a.title, why: a.why, topic: a.topic || 'other', area: a.area, body: a.body, created_at: a.created_at, res: true }); });
      tallies = j.tallies || {}; mine = j.mine || {}; notes = j.notes || {}; loaded = true;
      if (!touched) { order = null; shortOrder = null; }
      if (focusId && byId(focusId)) { openId = focusId; draw(); var el = document.getElementById('ask-' + focusId); if (el) el.scrollIntoView({ block: 'center' }); }
      else draw();
    }).catch(function () {});
  }
  function post(body) {
    return fetch('/api/wants/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ voter: voter }, body)) })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'That didn’t go through. Check your connection and try again.' }; });
  }
  function answer(id, k) {
    if (!touched) { touched = true; if (mode === 'short' && !shortOrder) { var cur = [].map.call(root.querySelectorAll('[data-wa-rows] > .wa-row'), function (li) { return li.id.slice(4); }); if (cur.length) shortOrder = cur; } }
    var before = mine[id], x = Object.assign({ y: 0, n: 0, m: 0, areas: {} }, t(id));
    var choice = before === k ? '' : k;
    if (before) x[before] = Math.max(0, x[before] - 1);
    if (choice) x[choice] += 1;
    tallies[id] = x;
    if (choice) mine[id] = choice; else delete mine[id];
    if (pending[id]) return draw();
    draw();
    pending[id] = true;
    post({ action: 'vote', wid: id, choice: choice, area: prefs.area || '' }).then(function (j) {
      pending[id] = false;
      if (j.ok) { tallies[id] = j.tally; if (j.choice !== (mine[id] || '')) { post({ action: 'vote', wid: id, choice: mine[id] || '', area: prefs.area || '' }).then(function (k) { if (k.ok) { tallies[id] = k.tally; draw(); } }); } draw(); }
      else { if (before) mine[id] = before; else delete mine[id]; toast(j.error || 'That didn’t count. Please try again.'); load(); }
    });
    if (choice) track('Wants answer', { on: mode === 'short' ? location.pathname : view });
  }
  function share(id) {
    var a = byId(id); if (!a) return;
    var url = linkOf(a), text = a.title + '? Say yes, no or don’t mind on What Squamish Wants.';
    track('Wants share');
    if (navigator.share) { navigator.share({ title: a.title, text: text, url: url }).catch(function () {}); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Link copied. Paste it into Facebook or a text.'); }, function () { window.prompt('Copy this link:', url); });
  }
  function gotoAsk(id) {
    focusId = id; openId = id; topic = 'all'; view = 'list'; order = null; draw();
    var el = document.getElementById('ask-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- events ----------
  root.addEventListener('click', function (e) {
    var b;
    if ((b = e.target.closest('[data-ans]'))) {
      var id = b.getAttribute('data-id');
      answer(id, b.getAttribute('data-ans'));
      return;
    }
    if ((b = e.target.closest('[data-open]'))) { var oid = b.getAttribute('data-open'); openId = openId === oid ? null : oid; if (openId) track('Wants open'); draw(); return; }
    if ((b = e.target.closest('[data-view]'))) { view = b.getAttribute('data-view'); if (view === 'one') deckShown = null; draw(); var tb = root.querySelector('[data-wa-tabs]'); if (tb && tb.getBoundingClientRect().top < 70 || !b.closest('[data-wa-tabs]')) window.scrollTo({ top: tb.offsetTop - 70, behavior: 'smooth' }); return; }
    if ((b = e.target.closest('[data-topic]'))) { topic = b.getAttribute('data-topic'); focusId = null; order = null; draw(); return; }
    if (e.target.closest('[data-next]')) { deckShown = null; drawOne(); return; }
    if ((b = e.target.closest('[data-skip]'))) { deckSkip[b.getAttribute('data-skip')] = true; deckShown = null; drawOne(); return; }
    if ((b = e.target.closest('[data-share]'))) { share(b.getAttribute('data-share')); return; }
    if ((b = e.target.closest('[data-report]'))) { var rid = b.getAttribute('data-report'); reported[rid] = true; draw(); post({ action: 'report', wid: rid }); return; }
    if ((b = e.target.closest('[data-goto]'))) { gotoAsk(b.getAttribute('data-goto')); return; }
    if (e.target.closest('[data-check]')) {
      var ta = root.querySelector('#wa-text'); add.text = ta ? ta.value.trim() : add.text;
      if (add.text.length < 12) { add.msg = 'Add a little more so we can turn it into a clear ask.'; drawAdd(); return; }
      add.stage = 'checking'; add.msg = ''; drawAdd(); track('Wants suggest');
      post({ action: 'check', text: add.text }).then(function (j) {
        if (!j.ok) { add.stage = 'write'; add.msg = j.error || 'That didn’t work. Please try again.'; drawAdd(); return; }
        add.res = j;
        add.stage = !j.publish ? 'rules' : (j.similar || []).length ? 'similar' : 'preview';
        drawAdd();
      });
      return;
    }
    if (e.target.closest('[data-different]')) { add.stage = 'preview'; drawAdd(); return; }
    if (e.target.closest('[data-rewrite]')) { add.stage = 'write'; add.msg = ''; drawAdd(); return; }
    if (e.target.closest('[data-again]')) { add = { text: '', res: null, stage: 'write', msg: '' }; drawAdd(); return; }
    if ((b = e.target.closest('[data-addwords]'))) {
      var wid = b.getAttribute('data-addwords'); b.disabled = true;
      post({ action: 'add-words', wid: wid, text: add.text, draft: add.res.draft && Object.assign({}, add.res.draft, { publish: add.res.publish, held: add.res.held }), sig: add.res.sig }).then(function (j) {
        if (!j.ok) { add.stage = 'write'; add.msg = j.error || 'That didn’t work. Please try again.'; drawAdd(); return; }
        add.held = j.status !== 'ok'; add.wordsId = wid; add.stage = 'added-words';
        if (!add.held) (notes[wid] = notes[wid] || []).unshift({ text: add.text, at: new Date().toISOString() });
        drawAdd();
      });
      return;
    }
    if ((b = e.target.closest('[data-post]'))) {
      b.disabled = true; b.textContent = 'Adding…';
      var sel = root.querySelector('[data-wa-newarea]');
      post({ action: 'post', text: add.text, draft: Object.assign({}, add.res.draft, { publish: add.res.publish, held: add.res.held }), sig: add.res.sig, area: sel ? sel.value : 'all', myArea: prefs.area || '' }).then(function (j) {
        if (!j.ok) { add.msg = j.error || 'That didn’t work. Please try again.'; drawAdd(); return; }
        add.held = j.status !== 'ok';
        if (!add.held) {
          var a = j.ask; asks.push({ id: a.id, title: a.title, why: a.why, topic: a.topic, area: a.area, body: a.body, created_at: a.created_at, res: true });
          mine[a.id] = 'y'; tallies[a.id] = { y: 1, n: 0, m: 0, areas: {} }; add.newId = a.id; order = null;
        }
        add.stage = 'posted'; drawAdd(); track('Wants post');
      });
      return;
    }
  });
  root.addEventListener('input', function (e) { if (e.target.id === 'wa-text') add.text = e.target.value; });
  root.addEventListener('change', function (e) {
    if (e.target.matches('[data-wa-area]')) { prefs.area = e.target.value; put('sv_prefs', prefs); order = null; draw(); }
    if (e.target.matches('[data-wa-sort]')) { sort = e.target.value; focusId = null; order = null; draw(); }
  });
  var areaSel = root.querySelector('[data-wa-area]'); if (areaSel) areaSel.value = prefs.area || '';
  window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (byId(h)) gotoAsk(h); });
  draw();
  load();
})();
