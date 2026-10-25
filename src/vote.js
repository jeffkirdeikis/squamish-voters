/* Have your say (/have-your-say/): vote yes, no or not sure on questions council is about to decide.
   The voter id is a random id kept in this browser so a vote can be changed until the meeting starts.
   Results show after you vote, and for everyone once the meeting has started. */
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

  var now = Date.now(), tallies = {}, mine = {};
  var open = data.questions.filter(function (q) { return Date.parse(q.close) > now; });
  var closed = data.questions.filter(function (q) { return Date.parse(q.close) <= now; });
  var WORD = { yes: 'Yes', no: 'No', unsure: 'Not sure' };
  function pct(n, t) { return t ? Math.round((100 * n) / t) : 0; }
  function closesText(q) {
    var d = new Date(q.close);
    return 'Voting closes ' + d.toLocaleString('en-CA', { timeZone: 'America/Vancouver', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(':00', '') + ', when the meeting starts.';
  }
  function results(q, t) {
    t = t || { yes: 0, no: 0, unsure: 0, total: 0, areas: {} };
    var bars = ['yes', 'no', 'unsure'].map(function (k) {
      var p = pct(t[k], t.total);
      return '<div class="hy-r' + (mine[q.id] === k ? ' me' : '') + '"><span>' + WORD[k] + (mine[q.id] === k ? ' <b class="hy-you">your vote</b>' : '') + '</span><i><u style="width:' + p + '%"></u></i><b>' + p + '%</b></div>';
    }).join('');
    var areas = Object.keys(t.areas || {}).filter(function (a) { return data.hoods[a]; }).map(function (a) {
      var x = t.areas[a]; return '<li><span>' + esc(data.hoods[a]) + '</span><i><u style="width:' + pct(x.yes, x.total) + '%"></u></i><b>' + pct(x.yes, x.total) + '% yes</b></li>';
    }).join('');
    return '<div class="hy-res">' + bars + '<p class="small muted">' + t.total + ' vote' + (t.total === 1 ? '' : 's') + ' so far. Not a scientific poll.</p>' +
      (areas ? '<details class="hy-hoods"><summary>How each neighbourhood voted</summary><ul>' + areas + '</ul></details>' : '') + '</div>';
  }
  function card(q, isOpen) {
    var voted = !!mine[q.id];
    return '<article class="card hy-q" data-q="' + esc(q.id) + '">' +
      '<p class="hy-meet small"><a href="' + esc(q.url) + '">' + esc(q.mlabel) + '</a></p>' +
      '<h2>' + esc(q.ask) + '</h2>' +
      (q.for_you ? '<p>' + esc(q.for_you) + '</p>' : '') +
      ((q.yes_means || q.no_means) ? '<dl class="hy-means">' + (q.yes_means ? '<div><dt>If council says yes</dt><dd>' + esc(q.yes_means) + '</dd></div>' : '') + (q.no_means ? '<div><dt>If council says no</dt><dd>' + esc(q.no_means) + '</dd></div>' : '') + '</dl>' : '') +
      (isOpen ? '<div class="hy-opts" role="group" aria-label="Your vote">' + ['yes', 'no', 'unsure'].map(function (k) { return '<button type="button" class="hy-b" data-c="' + k + '" aria-pressed="' + (mine[q.id] === k) + '">' + WORD[k] + '</button>'; }).join('') + '</div>' : '') +
      '<p class="small" data-msg role="status"></p>' +
      (voted || !isOpen ? results(q, tallies[q.id]) : '<p class="small muted">Vote to see the results so far.</p>') +
      (isOpen ? '<p class="small muted">' + esc(closesText(q)) + (voted ? ' You can change your vote until then.' : '') + '</p>' : '<p><a href="' + esc(q.url) + '">How council voted on this →</a></p>') +
      '</article>';
  }
  function draw() {
    openEl.innerHTML = open.map(function (q) { return card(q, true); }).join('');
    document.querySelector('[data-hy-empty]').hidden = open.length > 0;
    if (closedEl) { closedEl.innerHTML = closed.map(function (q) { return card(q, false); }).join(''); document.querySelector('[data-hy-closed-wrap]').hidden = !closed.length; }
  }
  draw();
  fetch('/api/have-your-say/?voter=' + encodeURIComponent(voter)).then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.ok) { tallies = j.tallies || {}; mine = j.mine || {}; draw(); }
  }).catch(function () {});
  openEl.addEventListener('click', function (e) {
    var b = e.target.closest('.hy-b'); if (!b) return;
    var art = b.closest('[data-q]'), id = art.getAttribute('data-q'), msg = art.querySelector('[data-msg]');
    art.querySelectorAll('.hy-b').forEach(function (x) { x.disabled = true; });
    fetch('/api/have-your-say/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qid: id, choice: b.getAttribute('data-c'), voter: voter, area: prefs.area || '' }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) { msg.textContent = j.error || 'That didn’t work. Please try again.'; art.querySelectorAll('.hy-b').forEach(function (x) { x.disabled = false; }); return; }
        tallies[id] = j.tally; mine[id] = j.mine; draw();
        if (window.SV && SV.track) try { SV.track('have-your-say-vote'); } catch (er) {}
      }).catch(function () { msg.textContent = 'That didn’t go through. Check your connection and try again.'; art.querySelectorAll('.hy-b').forEach(function (x) { x.disabled = false; }); });
  });
})();
