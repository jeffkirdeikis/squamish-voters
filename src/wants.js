/* What Squamish Wants (/wants/, and a short version on Home and /your-say/).
   The full list is the front door: every ask has Yes / No / Don't mind right on its row. The totals stay hidden behind a
   blurred bar until you answer or tap the ask, so people answer before they see the crowd and have a reason to open each one.
   Ranking: share of yes among yes and no ("don't mind" stays out of the percentage so a local ask isn't buried by people
   it doesn't affect), ties broken by how many answered. Ranked from the first answer.
   The order is frozen while someone answers, so rows never jump under their finger.
   Phones: a floating counter with "Next unanswered", and a bottom sheet for the neighbourhood question (asked after the
   first answer) and the 5 and 10 answer milestones. Desktop (1000px and up): a side rail with progress and the add box.
   The Top 10 board opens after 5 answers. One by one takes Y, N, M and the right arrow on a keyboard.
   Adding an ask: Claude checks the rules, writes a short neutral ask, and lists asks already on the list that look the
   same, so the writer can answer that one or add their words to it instead of posting a copy.
   Multiple choice asks: residents can add a missing answer (Claude checks it isn't already there). Starter answers keep
   their order; added ones follow, ranked by popularity when the page loads. Past 6 answers the rest fold behind
   "Show more". */
(function () {
  var root = document.querySelector('[data-wants]');
  var dataEl = document.getElementById('wa-data');
  if (!root || !dataEl) return;
  var D = JSON.parse(dataEl.textContent);
  var mode = root.getAttribute('data-wants') || 'page'; // page | short
  var only = root.getAttribute('data-only'); // a More info page: just that ask
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(n, d) { if (window.SV && SV.track) try { SV.track(n, d); } catch (e) {} }
  function toast(m) { if (window.SV && SV.toast) SV.toast(m); }
  function $(sel) { return root.querySelector(sel); }
  var voter = get('sv_voter', '');
  if (!voter) { voter = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)); put('sv_voter', voter); }
  var prefs = get('sv_prefs', { area: '', topics: [] });
  var desk = window.matchMedia ? window.matchMedia('(min-width: 1000px)') : { matches: false };

  var asks = D.asks.slice(), tallies = {}, mine = {}, notes = {}, people = 0, loaded = false;
  var view = 'list', topic = 'all', sort = 'wanted', openId = null, focusId = D.focus || (location.hash || '').slice(1) || null, deckSkip = {}, deckShown = null;
  var reported = {}, pending = {}, hintId = null, hinted = false;
  var expanded = {}, sug = { id: null, text: '', busy: false, msg: '', same: '' };
  var SHOW = 6, MAX_OPTIONS = 12; // answers shown before "Show more"; most answers a question can have
  // The order is frozen while someone is answering, so rows never jump under their finger. It is worked out again only
  // when they change the sort, filter or neighbourhood, or come back to the page.
  var order = null, shortOrder = null, touched = false;
  var UNLOCK = 5; // answers before the Top 10 board opens
  var STATUS = D.statuses, HOODS = D.hoods, TOPIC = {};
  D.topics.forEach(function (t) { TOPIC[t.key] = t.label; });
  function byId(id) { for (var i = 0; i < asks.length; i++) if (asks[i].id === id) return asks[i]; return null; }
  function t(id) { return tallies[id] || { y: 0, n: 0, m: 0, areas: {} }; }
  function pct(n, d) { return d ? Math.round((100 * n) / d) : 0; }
  // Yes / no asks have two answers; multiple choice asks ("kind": "choice") have their own options. Everyone can pick
  // Don't mind (m), which is counted and shown but left out of the shares.
  var YESNO = [{ key: 'y', label: 'Yes' }, { key: 'n', label: 'No' }];
  function isChoice(a) { return a.kind === 'choice' && a.options; }
  function opts(a) { return isChoice(a) ? a.options.concat(a.extra || []) : YESNO; }
  // The answers on screen: all of them up to 6, then the first 6 unless the list is open (or your pick is further down).
  function shown(a) {
    var o = opts(a);
    if (o.length <= SHOW || expanded[a.id]) return o;
    var my = mine[a.id], v = o.slice(0, SHOW);
    return my && my !== 'm' && !v.some(function (x) { return x.key === my; }) ? o : v;
  }
  function col(a, k) { var o = opts(a); for (var i = 0; i < o.length; i++) if (o[i].key === k) return 'o' + ((i % 8) + 1); return 'm'; }
  function isExtra(a, o) { return a.options.indexOf(o) < 0; }
  function c(x, k) { return (x && x[k]) || 0; }
  function total(x) { var n = 0; for (var k in x) if (k !== 'areas') n += x[k] || 0; return n; }
  function opinions(a, x) { return opts(a).reduce(function (s, o) { return s + c(x, o.key); }, 0); }
  function ranked(a, x) { return opts(a).slice().sort(function (p, q) { return c(x, q.key) - c(x, p.key); }); }
  function labelOf(a, k) { if (k === 'm') return 'Don’t mind'; var o = opts(a).filter(function (o) { return o.key === k; })[0]; return o ? o.label : k; }
  // Most wanted: the share of yes among yes and no; for a multiple choice ask, the share of its most picked option.
  function score(a) { var x = t(a.id), o = opinions(a, x); return o ? (isChoice(a) ? c(x, ranked(a, x)[0].key) : c(x, 'y')) / o : -1; }
  // How evenly split: 1 means the top two answers are tied.
  function splitness(a) { var x = t(a.id), o = opinions(a, x), r = ranked(a, x); return o && c(x, r[1].key) ? 1 - (c(x, r[0].key) - c(x, r[1].key)) / o : -1; }
  function done() { return asks.filter(function (a) { return mine[a.id]; }).length; }
  function infoLink(a, cls) { return a.info ? '<a class="' + (cls || 'wa-info') + '" href="/wants/' + esc(a.id) + '/info/">More info <span aria-hidden="true">›</span></a>' : ''; }
  function linkOf(a) { return location.origin + '/wants/' + a.id + '/'; }

  // ---------- pieces ----------
  function chips(a) {
    var s = STATUS[a.res ? 'resident' : a.status] || STATUS.none;
    return '<span class="wa-chips"><span class="wa-chip ' + s.cls + '">' + esc(s.label) + '</span>' + (a.area && HOODS[a.area] ? '<span class="wa-chip area">' + esc(HOODS[a.area]) + '</span>' : '') + '</span>';
  }
  function bar(a, x) {
    var n = total(x);
    if (!n) return '<p class="wa-first">No answers yet. Yours is the first.</p>';
    var segs = isChoice(a) ? opts(a).map(function (o) { return [col(a, o.key), o.label, c(x, o.key)]; }).concat([['m', 'don’t mind', c(x, 'm')]])
      : [['y', 'yes', c(x, 'y')], ['m', 'don’t mind', c(x, 'm')], ['n', 'no', c(x, 'n')]];
    return '<div class="wa-bar" role="img" aria-label="' + esc(segs.map(function (g) { return pct(g[2], n) + '% ' + g[1]; }).join(', ')) + '">' +
      segs.map(function (g) { return '<i class="' + g[0] + '" style="width:' + pct(g[2], n) + '%"></i>'; }).join('') + '</div>';
  }
  function areaLine(a, x) {
    var ar = a.area || prefs.area, ax = ar && x.areas && x.areas[ar];
    if (!ax || !HOODS[ar]) return '';
    var ao = opinions(a, ax), top = ranked(a, ax)[0];
    return '<p class="wa-local"><b>' + esc(HOODS[ar]) + ':</b> ' + (!ao ? 'no one there has picked an answer yet' : isChoice(a) ? 'most picked “' + esc(top.label) + '” (' + pct(c(ax, top.key), ao) + '%)' : pct(c(ax, 'y'), ao) + '% yes among people there with an opinion') + ' (' + total(ax) + ' answers)</p>';
  }
  function totals(a) {
    var x = t(a.id), n = total(x), o = opinions(a, x);
    var out = '<div class="wa-totals">' + bar(a, x);
    if (n && isChoice(a)) {
      var sh = shown(a), more = opts(a).length - sh.length;
      out += '<ul class="wa-optlegend">' + sh.map(function (op) { return '<li><i class="dot ' + col(a, op.key) + '"></i><span>' + esc(op.label) + (isExtra(a, op) ? ' <small class="wa-added">added by a resident</small>' : '') + '</span><b>' + pct(c(x, op.key), o) + '%</b></li>'; }).join('') + '</ul>' +
        (more ? '<button type="button" class="wa-link" data-more="' + esc(a.id) + '">Show ' + more + ' more answer' + (more === 1 ? '' : 's') + '</button>' : '') +
        '<p class="wa-legend"><span>' + n + ' answer' + (n === 1 ? '' : 's') + '</span><span>' + c(x, 'm') + ' don’t mind</span><span>Shares leave out don’t mind</span></p>';
    } else if (n) out += '<p class="wa-legend"><em>' + (o ? '<b>' + pct(c(x, 'y'), o) + '% yes</b> of people with an opinion' : '<b>No one has said yes or no yet</b>') + '</em>' +
      '<span>' + n + ' answer' + (n === 1 ? '' : 's') + '</span><span>' + c(x, 'y') + ' yes · ' + c(x, 'n') + ' no · ' + c(x, 'm') + ' don’t mind</span></p>';
    // Share sits under the results once someone has answered; an opened ask has it in its detail instead.
    return out + areaLine(a, x) + sugBox(a) + (openId !== a.id ? '<button type="button" class="wa-link wa-sharelink" data-share="' + esc(a.id) + '">Share this question</button>' : '') + '</div>';
  }
  // "Missing an answer?" on multiple choice asks: a one line box under the results.
  function sugBox(a) {
    if (!isChoice(a) || opts(a).length >= MAX_OPTIONS) return '';
    if (sug.id !== a.id) return '<button type="button" class="wa-link wa-sugopen" data-sug="' + esc(a.id) + '">Missing an answer? Add it</button>';
    var same = sug.same && labelOf(a, sug.same);
    return '<div class="wa-sug"><label class="fld" for="wa-sug">What answer is missing?<span class="small">A short answer to this question. We check it isn’t already one of the answers, and your answer moves to it.</span></label>' +
      '<div class="wa-sugrow"><input id="wa-sug" type="text" maxlength="300" autocomplete="off" value="' + esc(sug.text) + '" placeholder="For example: Up by half of inflation"><button type="button" class="btn" data-sugsend' + (sug.busy ? ' disabled' : '') + '>' + (sug.busy ? 'Checking…' : 'Add') + '</button></div>' +
      (same ? '<p class="wa-msg">That’s already an answer: <b>' + esc(same) + '</b>. <button type="button" class="wa-link" data-ans="' + esc(sug.same) + '" data-id="' + esc(a.id) + '">Pick that one</button></p>' : '') +
      (sug.msg ? '<p class="wa-msg bad">' + esc(sug.msg) + '</p>' : '') +
      '<button type="button" class="wa-link" data-sugx>Cancel</button></div>';
  }
  // The closed door: a blurred bar that hints there is a result behind it, without giving anything away.
  function tease(a) {
    return '<button type="button" class="wa-tease' + (isChoice(a) ? ' choice' : '') + '" data-open="' + esc(a.id) + '"><span class="wa-tease-bar" aria-hidden="true"><i></i><i></i><i></i></span><span class="wa-tease-t">Answer to see what Squamish said</span></button>';
  }
  var WORD = { y: 'Yes', n: 'No', m: 'Don’t mind' };
  function buttons(a, big) {
    var my = mine[a.id];
    if (isChoice(a)) {
      var sh = shown(a), more = opts(a).length - sh.length;
      return '<div class="wa-ans choice n' + sh.length + (big ? ' big' : '') + '" role="group" aria-label="Your answer">' + sh.map(function (o, i) {
        return '<button type="button" class="wa-b opt" data-ans="' + esc(o.key) + '" data-id="' + esc(a.id) + '" aria-pressed="' + (my === o.key) + '">' + (big && desk.matches && i < 9 ? '<kbd>' + (i + 1) + '</kbd> ' : '') + esc(o.label) + '</button>';
      }).join('') + (more ? '<button type="button" class="wa-more" data-more="' + esc(a.id) + '">Show ' + more + ' more answer' + (more === 1 ? '' : 's') + ', most picked first</button>' : '') +
        '<button type="button" class="wa-b m" data-ans="m" data-id="' + esc(a.id) + '" aria-pressed="' + (my === 'm') + '">Don’t mind</button></div>';
    }
    return '<div class="wa-ans' + (big ? ' big' : '') + '" role="group" aria-label="Your answer">' + ['y', 'n', 'm'].map(function (k) {
      return '<button type="button" class="wa-b ' + k + '" data-ans="' + k + '" data-id="' + esc(a.id) + '" aria-pressed="' + (my === k) + '">' + WORD[k] + '</button>';
    }).join('') + '</div>';
  }
  function detail(a) {
    var s = STATUS[a.res ? 'resident' : a.status] || STATUS.none;
    var who = a.res ? '' : '<dt>Who decides</dt><dd>' + (a.who === 'province' ? 'The Province. Council can press for it.' : 'Squamish council') + '</dd>';
    var ns = notes[a.id] || [];
    return '<div class="wa-detail">' +
      (a.why ? '<p>' + esc(a.why) + '</p>' : '') +
      '<dl><dt>Where it stands</dt><dd><span class="wa-chip ' + s.cls + '">' + esc(s.label) + '</span> ' + esc(s.explain || '') + '</dd>' + who +
      '<dt>Topic</dt><dd>' + esc(TOPIC[a.topic] || 'Everything else') + '</dd>' +
      (a.other_side ? '<dt>The other side</dt><dd>' + esc(a.other_side) + '</dd>' : '') +
      (isChoice(a) ? '<dt>What each answer means</dt><dd><ul class="wa-means">' + opts(a).map(function (o) {
        var rk = a.id + '#' + o.key;
        return '<li><b>' + esc(o.label) + ':</b> ' + esc(o.means || '') + (isExtra(a, o) ? ' <span class="small muted">Added by a resident.</span> ' + (reported[rk] ? '<span class="small muted">Thanks, reported.</span>' : '<button type="button" class="wa-link muted" data-optreport="' + esc(rk) + '">Report</button>') : '') + '</li>';
      }).join('') + '</ul></dd>' : '') +
      (a.source_url ? '<dt>Source</dt><dd><a href="' + esc(a.source_url) + '"' + (/^https?:/.test(a.source_url) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(a.source_label || 'Source') + '</a></dd>' : '') + '</dl>' +
      (a.res && a.body ? '<div class="wa-words"><b>In the words of the resident who added it</b><p>' + esc(a.body) + '</p></div>' : '') +
      (ns.length ? '<div class="wa-words"><b>More from residents</b>' + ns.slice(0, 20).map(function (n) { return '<p>' + esc(n.text) + '</p>'; }).join('') + '</div>' : '') +
      (a.info && !only ? '<p class="wa-infobig">' + infoLink(a, 'btn secondary') + '<span class="small muted">The facts, the timeline and the case for each answer.</span></p>' : '') +
      '<p class="wa-acts"><button type="button" class="wa-link" data-share="' + esc(a.id) + '">Share this ask</button>' +
      (a.res ? (reported[a.id] ? '<span class="small muted">Thanks, reported.</span>' : '<button type="button" class="wa-link muted" data-report="' + esc(a.id) + '">Report</button>') : '') +
      '<button type="button" class="wa-link" data-open="' + esc(a.id) + '">Close</button></p>' +
      '</div>';
  }
  function row(a) {
    var my = mine[a.id], open = openId === a.id, show = my || open;
    return '<li class="wa-row' + (isChoice(a) ? ' choice' : '') + (my ? ' answered' : '') + (open ? ' open' : '') + '" id="ask-' + esc(a.id) + '">' +
      '<button type="button" class="wa-title" data-open="' + esc(a.id) + '" aria-expanded="' + open + '">' + chips(a) + '<span class="wa-t">' + esc(a.title) + '</span></button>' +
      buttons(a) + (hintId === a.id ? '<p class="wa-hint">Tap your answer again to undo it.</p>' : '') +
      (show ? totals(a) + (a.info && !open && !only ? '<p class="wa-under">' + infoLink(a) + '</p>' : '') : '<div class="wa-under">' + tease(a) + (only ? '' : infoLink(a)) + '</div>') + (open ? detail(a) : '') + '</li>';
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
      wanted: function (a) { return score(a) * 1e6 + opinions(a, t(a.id)); },
      split: function (a) { var sp = splitness(a); return sp < 0 ? -1 : sp * 1e6 + opinions(a, t(a.id)); },
      voted: function (a) { return total(t(a.id)); },
      newest: function (a) { return a.res ? Date.parse(a.created_at) || 0 : -1; },
    }[sort];
    L.sort(function (p, q) { return key(q) - key(p); });
    if (focusId) { var f = byId(focusId); if (f && L.indexOf(f) > -1) { L.splice(L.indexOf(f), 1); L.unshift(f); } }
    order = L.map(function (a) { return a.id; });
    return L;
  }
  function drawList() {
    var el = $('[data-wa-rows]'); if (!el) return;
    var L = listed();
    $('[data-wa-count]').textContent = L.length + ' ask' + (L.length === 1 ? '' : 's');
    el.innerHTML = L.length ? L.map(row).join('') : '<li class="wa-empty">' + (topic === 'near' && !prefs.area ? 'Pick your area in the box above to see asks near you.' : topic === 'todo' ? 'You’ve answered every ask on this list. Thank you.' : 'Nothing here yet. Add one below.') + '</li>';
  }

  // ---------- one by one ----------
  function deck() {
    var area = prefs.area;
    return asks.filter(function (a) { return !mine[a.id] && !deckSkip[a.id]; }).sort(function (p, q) {
      var lp = p.area && p.area === area ? 0 : 1, lq = q.area && q.area === area ? 0 : 1;
      return lp - lq || total(t(p.id)) - total(t(q.id));
    });
  }
  var KEYS_CHOICE = '<p class="wa-keys">On a keyboard: <kbd>1</kbd> to <kbd>4</kbd> pick an answer, <kbd>M</kbd> don’t mind, <kbd>→</kbd> skip</p>';
  var KEYS = '<p class="wa-keys">On a keyboard: <kbd>Y</kbd> yes, <kbd>N</kbd> no, <kbd>M</kbd> don’t mind, <kbd>→</kbd> skip</p>';
  function drawOne() {
    var el = $('[data-wa-one]'); if (!el) return;
    var d = done();
    var prog = '<div class="wa-prog" aria-hidden="true"><i style="width:' + pct(d, asks.length) + '%"></i></div><p class="small muted">' + d + ' of ' + asks.length + ' answered</p>';
    var a = deckShown && byId(deckShown);
    if (a && mine[a.id]) {
      var x = t(a.id), n = total(x), my = mine[a.id];
      var same = c(x, my);
      el.innerHTML = prog + '<div class="wa-card">' + chips(a) + '<h2>' + esc(a.title) + '</h2><p class="wa-you">' +
        (n > 1 ? 'You and ' + pct(same, n) + '% of people ' + (my === 'm' ? 'don’t mind either way.' : isChoice(a) ? 'picked “' + esc(labelOf(a, my)) + '”.' : my === 'y' ? 'said yes.' : 'said no.') : 'You’re the first to answer this one.') + '</p>' +
        totals(a) + '<button type="button" class="btn block" data-next>Next ask</button>' + (desk.matches ? '<p class="wa-keys">Press <kbd>Enter</kbd> for the next ask</p>' : '') + '</div>';
      return;
    }
    var L = deck(); a = L[0];
    if (!a) { el.innerHTML = prog + '<div class="wa-card wa-done"><h2>That’s every ask for now.</h2><p>New ones go up as residents add them.</p><button type="button" class="btn block" data-view="top">See the Top 10</button><button type="button" class="btn secondary block" data-view="add">Missing something? Add it</button></div>'; return; }
    deckShown = a.id;
    el.innerHTML = prog + '<div class="wa-card">' + chips(a) + '<h2>' + esc(a.title) + '</h2>' + (a.why ? '<p>' + esc(a.why) + '</p>' : '') + (a.info ? '<p class="wa-onelink">' + infoLink(a) + '</p>' : '') + buttons(a, true) +
      '<button type="button" class="wa-link center" data-skip="' + esc(a.id) + '">Skip this one</button>' + (desk.matches ? (isChoice(a) ? KEYS_CHOICE : KEYS) : '') + '</div>';
  }

  // ---------- top 10 (opens after 5 answers) ----------
  function drawTop() {
    var el = $('[data-wa-top]'); if (!el) return;
    var d = done();
    if (d < UNLOCK) {
      el.innerHTML = '<div class="wa-card wa-locked"><p class="wa-lockicon" aria-hidden="true">🔒</p><h2>Answer ' + (UNLOCK - d) + ' more to open the Top 10</h2><p>The results board shows the most wanted and most split asks in Squamish. It opens once you’ve answered ' + UNLOCK + ', so everyone answers before they look.</p><div class="wa-prog" aria-hidden="true"><i style="width:' + pct(d, UNLOCK) + '%"></i></div><button type="button" class="btn block" data-view="list">Keep answering</button></div>';
      return;
    }
    var withAns = asks.filter(function (a) { return opinions(a, t(a.id)) > 0; });
    var top = withAns.slice().sort(function (p, q) { return (score(q) - score(p)) || (opinions(q, t(q.id)) - opinions(p, t(p.id))); }).slice(0, 10);
    var split = withAns.filter(function (a) { return splitness(a) >= 0; }).sort(function (p, q) { return (splitness(q) - splitness(p)) || (opinions(q, t(q.id)) - opinions(p, t(p.id))); }).slice(0, 3);
    function line(a, i) {
      var x = t(a.id), o = opinions(a, x), lead = ranked(a, x)[0], my = mine[a.id];
      return '<li><button type="button" class="wa-topline" data-goto="' + esc(a.id) + '"><span class="wa-rank">' + (i + 1) + '</span><span class="wa-topbody"><span class="wa-topt">' + esc(a.title) + '</span>' + bar(a, x) +
        '<span class="wa-legend"><em>' + (isChoice(a) ? 'Most picked: <b>' + esc(lead.label) + '</b> (' + pct(c(x, lead.key), o) + '%)' : '<b>' + pct(c(x, 'y'), o) + '% yes</b>') + '</em><span>' + total(x) + ' answer' + (total(x) === 1 ? '' : 's') + '</span>' +
        (my ? '<span>' + (my === 'm' ? 'You don’t mind' : isChoice(a) ? 'You picked “' + esc(labelOf(a, my)) + '”' : 'You said ' + WORD[my].toLowerCase()) + '</span>' : '') + '</span></span></button></li>';
    }
    el.innerHTML = '<div class="wa-board"><h2>Most wanted</h2><p class="small muted">Ranked by the share of yes among people who said yes or no (for questions with several answers, the share of the most picked one). Tap one to answer or see more.</p><ol class="wa-toplist">' + (top.length ? top.map(line).join('') : '<li class="wa-empty">No answers yet.</li>') + '</ol>' +
      (split.length ? '<h2>Most split</h2><p class="small muted">Closest to an even yes and no.</p><ol class="wa-toplist">' + split.map(line).join('') + '</ol>' : '') +
      '<p class="small muted">Not a scientific poll. ' + people + ' people have answered so far.</p></div>';
  }

  // ---------- add ----------
  var add = { text: '', res: null, stage: 'write', msg: '' };
  function areaSelect(sel) {
    return '<select data-wa-newarea><option value="all">The whole town</option>' + Object.keys(HOODS).filter(function (k) { return k !== 'outside'; }).map(function (k) { return '<option value="' + esc(k) + '"' + (sel === k ? ' selected' : '') + '>' + esc(HOODS[k]) + '</option>'; }).join('') + '</select>';
  }
  function drawAdd() {
    var el = $('[data-wa-add]'); if (!el) return;
    var r = add.res, h = '';
    if (add.stage === 'write' || add.stage === 'checking') {
      h = '<label class="fld" for="wa-text">' + (desk.matches ? 'Missing something? Add it.' : 'What should Squamish do?') + '<span class="small">Write as much as you like. We’ll turn it into a short ask for the list and keep your words underneath it. Please don’t name private people.</span></label>' +
        '<textarea id="wa-text" rows="' + (desk.matches ? 4 : 6) + '" maxlength="2000" placeholder="For example: the off leash area at John Hunter Park still has no fence, so I can’t let my dog run there with kids nearby.">' + esc(add.text) + '</textarea>' +
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
  // Phones show the add box in its own tab; desktop keeps it in the side rail, always open.
  function placeAdd() {
    var box = $('[data-wa-add]'), target = desk.matches ? $('[data-wa-railadd]') : $('[data-pane="add"]');
    if (box && target && box.parentNode !== target) target.appendChild(box);
    var sh = $('[data-wa-sheet]'), st = desk.matches ? $('.wa-rail') : $('.wa-fixed');
    if (sh && st && sh.parentNode !== st) st.insertBefore(sh, st.firstChild);
    if (desk.matches && view === 'add') view = 'list';
  }

  // ---------- progress, people, floating counter, bottom sheet ----------
  function drawProgress() {
    var d = done(), n = asks.length;
    var pe = $('[data-wa-people]');
    if (pe && loaded) pe.innerHTML = people ? '<b>' + people.toLocaleString('en-CA') + '</b> ' + (people === 1 ? 'person has' : 'people have') + ' answered so far' : 'Be one of the first to answer';
    var rp = $('[data-wa-railprog]');
    if (rp) rp.innerHTML = '<p class="wa-railbig"><b>' + d + '</b> of ' + n + ' answered</p><div class="wa-prog" aria-hidden="true"><i style="width:' + pct(d, n) + '%"></i></div>' +
      (d < UNLOCK ? '<p class="small muted">The Top 10 opens after ' + UNLOCK + ' answers (' + (UNLOCK - d) + ' to go).</p>' : '<button type="button" class="btn secondary block" data-view="top">See the Top 10</button>') +
      (d < n ? '<button type="button" class="btn block" data-nextq>Next unanswered</button>' : '');
    var lk = $('[data-wa-lock]'); if (lk) lk.textContent = d < UNLOCK ? ' 🔒' : '';
    var fl = $('[data-wa-float]');
    if (fl) {
      fl.hidden = !loaded || view !== 'list' || !!sheet;
      fl.innerHTML = '<span><b>' + d + '</b> of ' + n + ' answered</span>' + (d < n ? '<button type="button" data-nextq>Next unanswered <span aria-hidden="true">↓</span></button>' : '<button type="button" data-view="top">See the Top 10</button>');
    }
  }
  var sheet = null;
  function showSheet(kind) {
    var el = $('[data-wa-sheet]'); if (!el) return;
    var ms = get('sv_wa_ms', {}); ms[kind] = 1; put('sv_wa_ms', ms);
    sheet = kind;
    var h = '';
    if (kind === 'area') h = '<p><b>Which part of Squamish do you live in?</b> We’ll show how your area answered. Optional, and saved on this phone only.</p><select data-wa-sheetarea><option value="">Choose your area</option>' + Object.keys(HOODS).map(function (k) { return '<option value="' + esc(k) + '">' + esc(HOODS[k]) + '</option>'; }).join('') + '</select>';
    if (kind === 'five') h = '<p><b>Nice, that’s ' + UNLOCK + '.</b> The Top 10 is open. Share this so your neighbours can weigh in too.</p><div class="wa-sheetbtns"><button type="button" class="btn" data-view="top">See the Top 10</button><button type="button" class="btn secondary" data-sharepage>Share</button></div>';
    if (kind === 'ten') h = '<p><b>10 answered. Thank you.</b> Want to know when council acts on any of these? Get a short email every Friday.</p><div class="wa-sheetbtns"><button type="button" class="btn" data-gosignup>Get the Friday email</button></div>';
    el.innerHTML = '<button type="button" class="wa-sheetx" data-sheetx aria-label="Close">×</button>' + h;
    el.hidden = false;
    drawProgress();
  }
  function closeSheet() { var el = $('[data-wa-sheet]'); if (el) el.hidden = true; sheet = null; drawProgress(); }
  function milestones() {
    if (mode !== 'page') return;
    var d = done(), ms = get('sv_wa_ms', {});
    if (d >= 1 && !prefs.area && !ms.area) showSheet('area');
    else if (d >= UNLOCK && !ms.five && sheet !== 'area') showSheet('five');
    else if (d >= 10 && !ms.ten && !sheet) showSheet('ten');
  }
  function nextUnanswered() {
    if (view !== 'list') { view = 'list'; draw(); }
    var rows = [].slice.call(root.querySelectorAll('[data-wa-rows] > .wa-row'));
    var below = rows.filter(function (r) { return !r.classList.contains('answered') && r.getBoundingClientRect().top > 140; });
    var r = below[0] || rows.filter(function (x) { return !x.classList.contains('answered'); })[0];
    if (!r) { topic = 'all'; order = null; draw(); return; }
    window.scrollTo({ top: window.scrollY + r.getBoundingClientRect().top - (desk.matches ? 100 : 90), behavior: 'smooth' });
  }

  // ---------- drawing ----------
  function draw() {
    if (mode === 'short') { drawShort(); return; }
    root.querySelectorAll('[data-wa-tabs] [data-view]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-view') === view)); });
    root.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== view; });
    root.querySelectorAll('[data-topic]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-topic') === topic)); });
    if (view === 'list') drawList(); else if (view === 'one') drawOne(); else if (view === 'top') drawTop(); else drawAdd();
    drawProgress();
  }
  function drawShort() {
    var el = $('[data-wa-rows]'); if (!el) return;
    var pe = $('[data-wa-people]'); if (pe && loaded && people) pe.textContent = people.toLocaleString('en-CA') + (people === 1 ? ' person has' : ' people have') + ' answered so far.';
    var area = prefs.area, n = parseInt(root.getAttribute('data-count') || '3', 10);
    if (only) { var oa = byId(only); el.innerHTML = oa ? row(oa) : ''; return; }
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
      tallies = j.tallies || {}; mine = j.mine || {}; notes = j.notes || {}; people = j.people || 0; loaded = true;
      // Added answers, most picked first. Worked out once per load so buttons don't move while someone answers.
      asks.forEach(function (a) {
        if (!isChoice(a)) return;
        var x = t(a.id);
        a.extra = ((j.extras || {})[a.id] || []).slice().sort(function (p, q) { return c(x, q.key) - c(x, p.key); });
      });
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
    if (!done() && choice) people += 1; // their first answer anywhere on the list
    if (before) x[before] = Math.max(0, c(x, before) - 1);
    if (choice) x[choice] = c(x, choice) + 1;
    tallies[id] = x;
    if (choice) mine[id] = choice; else delete mine[id];
    // Show "tap again to undo" once, on the first ask they answer.
    if (choice && !hinted) { hinted = true; hintId = id; } // it stays put after that: removing it would shift the rows below
    draw();
    if (choice) milestones();
    if (pending[id]) return;
    pending[id] = true;
    post({ action: 'vote', wid: id, choice: choice, area: prefs.area || '' }).then(function (j) {
      pending[id] = false;
      if (j.ok) { tallies[id] = j.tally; if (j.choice !== (mine[id] || '')) { post({ action: 'vote', wid: id, choice: mine[id] || '', area: prefs.area || '' }).then(function (k) { if (k.ok) { tallies[id] = k.tally; draw(); } }); } draw(); }
      else { if (before) mine[id] = before; else delete mine[id]; toast(j.error || 'That didn’t count. Please try again.'); load(); }
    });
    if (choice) track('Wants answer', { on: mode === 'short' ? location.pathname : view });
  }
  function sendSug() {
    var id = sug.id, a = id && byId(id), inp = $('#wa-sug');
    if (!a || sug.busy) return;
    sug.text = inp ? inp.value.trim() : sug.text.trim();
    if (sug.text.length < 3) { sug.msg = 'Write the answer you’d like to see.'; draw(); return; }
    sug.busy = true; sug.msg = ''; sug.same = ''; draw(); track('Wants add answer');
    post({ action: 'add-option', wid: id, text: sug.text, area: prefs.area || '' }).then(function (j) {
      sug.busy = false;
      if (!j.ok) sug.msg = j.error || 'That didn’t work. Please try again.';
      else if (j.rejected) sug.msg = j.rejected;
      else if (j.same) sug.same = j.same;
      else {
        sug = { id: null, text: '', busy: false, msg: '', same: '' };
        if (j.status !== 'ok') toast('Thanks. Your answer will show after a quick check.');
        else {
          if (!done()) people += 1;
          (a.extra = a.extra || []).push(j.option); tallies[id] = j.tally; mine[id] = j.option.key;
          toast('Added. Your answer is now “' + j.option.label + '”.');
          milestones();
        }
      }
      draw();
    });
  }
  function shareUrl(url, title, text) {
    track('Wants share');
    if (navigator.share) { navigator.share({ title: title, text: text, url: url }).catch(function () {}); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Link copied. Paste it into Facebook or a text.'); }, function () { window.prompt('Copy this link:', url); });
  }
  function share(id) { var a = byId(id); if (a) shareUrl(linkOf(a), a.title, a.title.replace(/[?.!]?$/, '?') + (isChoice(a) ? ' Pick your answer' : ' Say yes, no or don’t mind') + ' on What Squamish Wants.'); }
  function gotoAsk(id) {
    focusId = id; openId = id; topic = 'all'; view = 'list'; order = null; draw();
    var el = document.getElementById('ask-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function setView(v, fromTabs) {
    if (v === 'add' && desk.matches) { view = 'list'; draw(); var ta = $('#wa-text'); if (ta) { ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); ta.focus({ preventScroll: true }); } return; }
    view = v; if (v === 'one') deckShown = null; draw();
    var tb = $('[data-wa-tabs]');
    if (tb && (!fromTabs || tb.getBoundingClientRect().top < 70)) window.scrollTo({ top: window.scrollY + tb.getBoundingClientRect().top - 80, behavior: 'smooth' });
  }

  // ---------- events ----------
  root.addEventListener('click', function (e) {
    var b;
    if ((b = e.target.closest('[data-ans]'))) { if (b.closest('.wa-sug')) sug = { id: null, text: '', busy: false, msg: '', same: '' }; answer(b.getAttribute('data-id'), b.getAttribute('data-ans')); return; }
    if ((b = e.target.closest('[data-open]'))) { var oid = b.getAttribute('data-open'); openId = openId === oid ? null : oid; if (openId) track('Wants open'); draw(); return; }
    if ((b = e.target.closest('[data-view]'))) { if (b.closest('[data-wa-sheet]')) closeSheet(); setView(b.getAttribute('data-view'), !!b.closest('[data-wa-tabs]')); return; }
    if ((b = e.target.closest('[data-topic]'))) { topic = b.getAttribute('data-topic'); focusId = null; order = null; draw(); return; }
    if (e.target.closest('[data-nextq]')) { nextUnanswered(); return; }
    if (e.target.closest('[data-sheetx]')) { closeSheet(); return; }
    if (e.target.closest('[data-sharepage]')) { shareUrl(location.origin + '/wants/', 'What Squamish Wants', 'What should Squamish do? Say yes, no or don’t mind and see what everyone said.'); closeSheet(); return; }
    if (e.target.closest('[data-gosignup]')) { closeSheet(); var s = document.getElementById('signup'); if (s) { s.scrollIntoView({ behavior: 'smooth', block: 'center' }); var inp = s.querySelector('input[type=email]'); if (inp) setTimeout(function () { inp.focus({ preventScroll: true }); }, 400); } return; }
    if (e.target.closest('[data-next]')) { deckShown = null; drawOne(); drawProgress(); return; }
    if ((b = e.target.closest('[data-skip]'))) { deckSkip[b.getAttribute('data-skip')] = true; deckShown = null; drawOne(); return; }
    if ((b = e.target.closest('[data-share]'))) { share(b.getAttribute('data-share')); return; }
    if ((b = e.target.closest('[data-more]'))) { var mid = b.getAttribute('data-more'); expanded[mid] = true; draw(); return; }
    if ((b = e.target.closest('[data-sug]'))) { sug = { id: b.getAttribute('data-sug'), text: '', busy: false, msg: '', same: '' }; draw(); var si = $('#wa-sug'); if (si) si.focus({ preventScroll: true }); return; }
    if (e.target.closest('[data-sugx]')) { sug = { id: null, text: '', busy: false, msg: '', same: '' }; draw(); return; }
    if (e.target.closest('[data-sugsend]')) { sendSug(); return; }
    if ((b = e.target.closest('[data-optreport]'))) { var rk = b.getAttribute('data-optreport'), cut = rk.indexOf('#'); reported[rk] = true; draw(); post({ action: 'report', wid: rk.slice(0, cut), okey: rk.slice(cut + 1) }); return; }
    if ((b = e.target.closest('[data-report]'))) { var rid = b.getAttribute('data-report'); reported[rid] = true; draw(); post({ action: 'report', wid: rid }); return; }
    if ((b = e.target.closest('[data-goto]'))) { gotoAsk(b.getAttribute('data-goto')); return; }
    if (e.target.closest('[data-check]')) {
      var ta = $('#wa-text'); add.text = ta ? ta.value.trim() : add.text;
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
      var sel = $('[data-wa-newarea]');
      post({ action: 'post', text: add.text, draft: Object.assign({}, add.res.draft, { publish: add.res.publish, held: add.res.held }), sig: add.res.sig, area: sel ? sel.value : 'all', myArea: prefs.area || '' }).then(function (j) {
        if (!j.ok) { add.msg = j.error || 'That didn’t work. Please try again.'; drawAdd(); return; }
        add.held = j.status !== 'ok';
        if (!add.held) {
          var a = j.ask; asks.push({ id: a.id, title: a.title, why: a.why, topic: a.topic, area: a.area, body: a.body, created_at: a.created_at, res: true });
          mine[a.id] = 'y'; tallies[a.id] = { y: 1, n: 0, m: 0, areas: {} }; add.newId = a.id; order = null;
          if (view === 'list') drawList();
          drawProgress();
        }
        add.stage = 'posted'; drawAdd(); track('Wants post');
      });
      return;
    }
  });
  root.addEventListener('input', function (e) { if (e.target.id === 'wa-text') add.text = e.target.value; if (e.target.id === 'wa-sug') sug.text = e.target.value; });
  root.addEventListener('keydown', function (e) { if (e.target.id === 'wa-sug' && e.key === 'Enter') { e.preventDefault(); sendSug(); } });
  root.addEventListener('change', function (e) {
    var areaPick = e.target.matches('[data-wa-area]') || e.target.matches('[data-wa-sheetarea]');
    if (areaPick) {
      prefs.area = e.target.value; put('sv_prefs', prefs);
      var main = $('[data-wa-area]'); if (main) main.value = prefs.area;
      if (e.target.matches('[data-wa-sheetarea]')) { closeSheet(); if (topic === 'near') order = null; draw(); }
      else { order = null; draw(); }
    }
    if (e.target.matches('[data-wa-sort]')) { sort = e.target.value; focusId = null; order = null; draw(); }
  });
  // One by one on a keyboard: Y, N, M to answer, the right arrow to skip, Enter for the next ask.
  document.addEventListener('keydown', function (e) {
    if (mode !== 'page' || view !== 'one' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
    var k = e.key.toLowerCase(), a = deckShown && byId(deckShown);
    if (!a) return;
    if (mine[a.id]) { if (k === 'enter' || k === 'arrowright') { e.preventDefault(); deckShown = null; drawOne(); drawProgress(); } return; }
    if (isChoice(a) && /^[1-9]$/.test(k) && shown(a)[+k - 1]) { e.preventDefault(); answer(a.id, shown(a)[+k - 1].key); }
    else if (k === 'm' || (!isChoice(a) && (k === 'y' || k === 'n'))) { e.preventDefault(); answer(a.id, k); }
    else if (k === 'arrowright') { e.preventDefault(); deckSkip[a.id] = true; deckShown = null; drawOne(); }
  });
  var areaSel = $('[data-wa-area]'); if (areaSel) areaSel.value = prefs.area || '';
  window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (byId(h)) gotoAsk(h); });
  if (mode === 'page') {
    placeAdd(); drawAdd();
    if (desk.addEventListener) desk.addEventListener('change', function () { placeAdd(); drawAdd(); draw(); });
  }
  draw();
  load();
})();
