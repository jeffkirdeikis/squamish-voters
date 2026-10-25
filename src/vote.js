/* Have your say (/have-your-say/): vote on questions council is about to decide.
   Each question reads top down: the short version, then "Get the full picture" to open (background, both sides, what a
   yes or no means), then the vote. Big decisions ("detailed") get five answers instead of three, plus an optional
   "what matters most" pick and a comment. The voter id is a random id kept in this browser so a vote can be changed
   until the meeting starts. Results show after you vote, and for everyone once voting has closed. */
(function () {
  var data = JSON.parse((document.getElementById('hy-data') || {}).textContent || '{"questions":[]}');
  var openEl = document.querySelector('[data-hy-open]'), closedEl = document.querySelector('[data-hy-closed]');
  if (!openEl) return;
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var voter = get('sv_voter', '');
  if (!voter) { voter = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)); put('sv_voter', voter); }
  var prefs = get('sv_prefs', { area: '', topics: [] });
  var areaSel = document.querySelector('[data-hy-area]');
  if (areaSel) { areaSel.value = prefs.area || ''; areaSel.addEventListener('change', function () { prefs.area = areaSel.value; put('sv_prefs', prefs); }); }

  var now = Date.now(), tallies = {}, mine = {}, opened = {};
  var byId = {}; data.questions.forEach(function (q) { byId[q.id] = q; });
  var open = data.questions.filter(function (q) { return Date.parse(q.close) > now; });
  var closed = data.questions.filter(function (q) { return Date.parse(q.close) <= now; });
  var WORD = { yes: 'Yes', yes_changes: 'Yes, but with changes', no_changes: 'No, not as it stands', no: 'No', unsure: 'Not sure' };
  var choicesOf = function (q) { return q.depth === 'detailed' ? ['yes', 'yes_changes', 'no_changes', 'no', 'unsure'] : ['yes', 'no', 'unsure']; };
  function pct(n, t) { return t ? Math.round((100 * n) / t) : 0; }
  function closesText(q) {
    var d = new Date(q.close);
    return 'Voting closes ' + d.toLocaleString('en-CA', { timeZone: 'America/Vancouver', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(':00', '') + ', when the meeting starts.';
  }
  function list(items) { return '<ul>' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }
  function bar(label, p, me, right) { return '<div class="hy-r' + (me ? ' me' : '') + '"><span>' + esc(label) + (me ? ' <b class="hy-you">your vote</b>' : '') + '</span><i><u style="width:' + p + '%"></u></i><b>' + (right || p + '%') + '</b></div>'; }

  function results(q) {
    var t = tallies[q.id] || { total: 0, areas: {}, factors: {} }, my = (mine[q.id] || {}).choice;
    var yesish = function (x) { return (x.yes || 0) + (x.yes_changes || 0); };
    var out = '<div class="hy-res"><h3>' + (Date.parse(q.close) > now ? 'Results so far' : 'How residents voted') + '</h3>';
    out += choicesOf(q).map(function (k) { return bar(WORD[k], pct(t[k] || 0, t.total), my === k); }).join('');
    if (q.depth === 'detailed' && t.total) out += '<p class="hy-lean"><b>' + pct(yesish(t), t.total) + '%</b> lean yes (yes, or yes with changes) · <b>' + pct((t.no || 0) + (t.no_changes || 0), t.total) + '%</b> lean no</p>';
    out += '<p class="small muted">' + t.total + ' vote' + (t.total === 1 ? '' : 's') + '. Not a scientific poll.</p>';
    var fk = Object.keys(t.factors || {}).sort(function (a, b) { return t.factors[b] - t.factors[a]; });
    if (fk.length) out += '<div class="hy-sub"><h4>What matters most to people who voted</h4>' + fk.map(function (f) { return bar(f, pct(t.factors[f], t.total), false, pct(t.factors[f], t.total) + '%'); }).join('') + '</div>';
    if (q.themes && q.themes.summary) out += '<div class="hy-sub hy-themes"><h4>What people wrote</h4><p>' + esc(q.themes.summary) + '</p><p class="small muted">A neutral summary of ' + q.themes.n + ' comments. Individual comments are not published.</p></div>';
    var areas = Object.keys(t.areas || {}).filter(function (a) { return data.hoods[a]; }).map(function (a) {
      var x = t.areas[a]; return '<li><span>' + esc(data.hoods[a]) + '</span><i><u style="width:' + pct(yesish(x), x.total) + '%"></u></i><b>' + pct(yesish(x), x.total) + '% yes</b></li>';
    }).join('');
    if (areas) out += '<details class="hy-hoods"><summary>How each neighbourhood voted</summary><ul>' + areas + '</ul></details>';
    return out + '</div>';
  }

  function extras(q) {
    if (q.depth !== 'detailed') return '';
    var m = mine[q.id] || {}, picked = m.factors || [];
    return '<div class="hy-extra"><h3>Tell council more <span class="small muted">(optional)</span></h3>' +
      ((q.factors || []).length ? '<p class="small">What matters most to you on this? Pick any.</p><div class="hy-factors">' + q.factors.map(function (f) { return '<button type="button" class="chip-btn" data-f="' + esc(f) + '" aria-pressed="' + (picked.indexOf(f) > -1) + '">' + esc(f) + '</button>'; }).join('') + '</div>' : '') +
      '<label class="fld">Anything else you’d want council to know?<textarea data-c rows="3" maxlength="600" placeholder="For example, what would change your mind">' + esc(m.comment || '') + '</textarea></label>' +
      '<p class="small muted">Comments aren’t published word for word. We publish a neutral summary of what people wrote.</p>' +
      '<button type="button" class="btn secondary" data-save>Save</button> <span class="small" data-saved role="status"></span></div>';
  }

  function card(q, isOpen) {
    var my = (mine[q.id] || {}).choice, detailed = q.depth === 'detailed';
    var o = opened[q.id] || {};
    var picture = (q.context ? '<p>' + esc(q.context) + '</p>' : '') +
      ((q.supporters || []).length || (q.concerns || []).length ? '<div class="hy-sides"><div><h4>What supporters say</h4>' + list(q.supporters || []) + '</div><div><h4>Concerns raised</h4>' + list(q.concerns || []) + '</div></div>' : '') +
      ((q.yes_means || q.no_means) ? '<dl class="hy-means">' + (q.yes_means ? '<div><dt>If council says yes</dt><dd>' + esc(q.yes_means) + '</dd></div>' : '') + (q.no_means ? '<div><dt>If council says no</dt><dd>' + esc(q.no_means) + '</dd></div>' : '') + '</dl>' : '') +
      '<p class="small"><a href="' + esc(q.url) + '">The agenda and staff report for this meeting →</a></p>';
    var buttons = '<div class="hy-opts' + (detailed ? ' five' : '') + '" role="group" aria-label="Your vote">' + choicesOf(q).map(function (k) { return '<button type="button" class="hy-b" data-c="' + k + '" aria-pressed="' + (my === k) + '">' + WORD[k] + '</button>'; }).join('') + '</div>';
    var voteBody = buttons + '<p class="small" data-msg role="status"></p>' + (my ? extras(q) + results(q) : '<p class="small muted">Vote to see the results so far.</p>') + '<p class="small muted">' + esc(closesText(q)) + (my ? ' You can change your vote until then.' : '') + '</p>';
    return '<article class="card hy-q' + (detailed ? ' detailed' : '') + '" data-q="' + esc(q.id) + '">' +
      '<p class="hy-meet small"><a href="' + esc(q.url) + '">' + esc(q.mlabel) + '</a>' + (detailed ? ' <span class="hy-big">Big decision</span>' : '') + '</p>' +
      '<h2>' + esc(q.ask) + '</h2>' +
      (q.for_you || q.plain ? '<p class="hy-short">' + esc(q.for_you || q.plain) + '</p>' : '') +
      ((q.facts || []).length ? '<ul class="hy-facts">' + q.facts.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '') +
      '<details class="hy-step" data-step="more"' + (o.more ? ' open' : '') + '><summary><span class="hy-n">1</span>' + (detailed ? 'Get the full picture' : 'What a yes or no would mean') + '<span class="small muted">' + (detailed ? 'Background, both sides, what happens next' : '') + '</span></summary><div class="hy-stepbody">' + picture + '</div></details>' +
      (isOpen
        ? '<details class="hy-step hy-votestep" data-step="vote"' + (o.vote || my ? ' open' : '') + '><summary><span class="hy-n">2</span>' + (my ? 'Your vote' : 'Vote on this') + '<span class="small muted">' + (my ? esc(WORD[my]) : 'Takes a few seconds') + '</span></summary><div class="hy-stepbody">' + voteBody + '</div></details>'
        : results(q) + '<p><a href="' + esc(q.url) + '">How council voted on this →</a></p>') +
      '</article>';
  }
  function draw() {
    openEl.innerHTML = open.map(function (q) { return card(q, true); }).join('');
    document.querySelector('[data-hy-empty]').hidden = open.length > 0;
    if (closedEl) { closedEl.innerHTML = closed.map(function (q) { return card(q, false); }).join(''); document.querySelector('[data-hy-closed-wrap]').hidden = !closed.length; }
  }
  draw();
  document.addEventListener('toggle', function (e) {
    var d = e.target; if (!d.matches || !d.matches('.hy-step')) return;
    var id = d.closest('[data-q]').getAttribute('data-q'); (opened[id] ||= {})[d.getAttribute('data-step')] = d.open;
  }, true);
  fetch('/api/have-your-say/?voter=' + encodeURIComponent(voter)).then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.ok) { tallies = j.tallies || {}; mine = j.mine || {}; draw(); }
  }).catch(function () {});

  function send(art, body, done, fail) {
    fetch('/api/have-your-say/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ qid: art.getAttribute('data-q'), voter: voter, area: prefs.area || '' }, body)) })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) return fail(j.error); var id = art.getAttribute('data-q'); tallies[id] = j.tally; mine[id] = j.mine; done(); })
      .catch(function () { fail('That didn’t go through. Check your connection and try again.'); });
  }
  openEl.addEventListener('click', function (e) {
    var art = e.target.closest('[data-q]'); if (!art) return;
    var id = art.getAttribute('data-q');
    var b = e.target.closest('.hy-b');
    if (b) {
      var msg = art.querySelector('[data-msg]');
      art.querySelectorAll('.hy-b').forEach(function (x) { x.disabled = true; });
      (opened[id] ||= {}).vote = true;
      send(art, { choice: b.getAttribute('data-c') }, function () { draw(); if (window.SV && SV.track) try { SV.track('have-your-say-vote'); } catch (er) {} },
        function (err) { msg.textContent = err || 'That didn’t work. Please try again.'; art.querySelectorAll('.hy-b').forEach(function (x) { x.disabled = false; }); });
      return;
    }
    var f = e.target.closest('[data-f]');
    if (f) { f.setAttribute('aria-pressed', String(f.getAttribute('aria-pressed') !== 'true')); return; }
    if (e.target.closest('[data-save]')) {
      var saved = art.querySelector('[data-saved]');
      var factors = [].map.call(art.querySelectorAll('[data-f][aria-pressed="true"]'), function (x) { return x.getAttribute('data-f'); });
      send(art, { choice: (mine[id] || {}).choice, factors: factors, comment: art.querySelector('textarea[data-c]').value }, function () { draw(); var s = document.querySelector('[data-q="' + id + '"] [data-saved]'); if (s) s.textContent = 'Saved. Thank you.'; },
        function (err) { saved.textContent = err || 'That didn’t save. Please try again.'; });
    }
  });
})();
