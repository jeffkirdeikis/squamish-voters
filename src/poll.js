// The vote at the bottom of a news story (build.mjs pollHtml). Answers go to api/wants.js under the ask news-<slug>,
// with the same saved id as What Squamish Wants, so one person is one answer. After answering, the reader sees how
// Squamish answered and the next stories that have a vote. "Something else" lets them write their own answer: Claude
// checks it, and it joins the list for the next reader (or counts them under an answer that already means the same).
(function () {
  var box = document.querySelector('[data-poll]');
  if (!box || !window.fetch) return;
  var wid = box.getAttribute('data-poll');
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(n, d) { if (window.SV && SV.track) try { SV.track(n, d); } catch (e) {} }
  var voter = get('sv_voter', '');
  if (!voter) { voter = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)); put('sv_voter', voter); }
  var dev = (function () { // same device summary as src/wants.js
    var n = navigator, sc = window.screen || {}, tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    var str = [n.userAgent, n.platform, (n.languages || [n.language]).join(','), n.hardwareConcurrency, n.maxTouchPoints, sc.width + 'x' + sc.height, sc.colorDepth, window.devicePixelRatio, tz].join('|'), h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36) + str.length.toString(36);
  })();
  var area = (get('sv_prefs', {}) || {}).area || '';
  var more = []; try { more = JSON.parse(box.getAttribute('data-more') || '[]'); } catch (e) {}

  var optsEl = box.querySelector('.nw-poll-opts'), ownBtn = box.querySelector('[data-own]'), form = box.querySelector('[data-own-form]');
  var resEl = box.querySelector('[data-res]'), msg = box.querySelector('[data-msg]'), ta = form.querySelector('textarea');
  var opts = [].map.call(optsEl.querySelectorAll('button[data-k]'), function (b) { return { key: b.getAttribute('data-k'), label: b.querySelector('b').textContent }; });
  var tally = {}, mine = '', busy = false;

  function labelOf(k) { for (var i = 0; i < opts.length; i++) if (opts[i].key === k) return opts[i].label; return k; }
  function addExtra(o) {
    if (opts.some(function (x) { return x.key === o.key; })) return;
    opts.splice(opts.length - 1, 0, { key: o.key, label: o.label, extra: true }); // before Not sure
    var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-k', o.key);
    b.innerHTML = '<b>' + esc(o.label) + '</b><span>Added by a reader</span>';
    optsEl.insertBefore(b, optsEl.querySelector('.nw-poll-m'));
  }
  function showVote() { optsEl.hidden = false; resEl.hidden = true; form.hidden = true; }
  function showResults() {
    var total = 0; opts.forEach(function (o) { total += tally[o.key] || 0; });
    var rows = opts.slice().sort(function (a, b) { return (tally[b.key] || 0) - (tally[a.key] || 0); });
    var pct = function (n) { return total ? Math.round((100 * n) / total) : 0; };
    resEl.innerHTML = '<ul class="nw-poll-bars">' + rows.map(function (o) {
      var n = tally[o.key] || 0, me = o.key === mine;
      return '<li' + (me ? ' class="me"' : '') + '><span class="nw-poll-l">' + esc(o.label) + (me ? ' <small>Your answer</small>' : '') + '</span><b>' + pct(n) + '%</b><i style="width:' + pct(n) + '%"></i></li>';
    }).join('') + '</ul>' +
      '<p class="small muted">' + total + (total === 1 ? ' person has' : ' people have') + ' answered so far. <button type="button" class="linkish" data-change>Change my answer</button></p>' +
      (more.length ? '<div class="nw-poll-next"><b>Have your say on more stories</b><ul>' + more.map(function (m) { return '<li><a href="' + esc(m.url) + '#vote" data-next>' + esc(m.q) + '</a></li>'; }).join('') + '</ul></div>' : '') +
      '<p class="nw-poll-wants"><a href="/wants/" data-wants>What else does Squamish want? Answer the questions on What Squamish Wants →</a></p>';
    optsEl.hidden = true; form.hidden = true; resEl.hidden = false;
  }
  function post(body) {
    body.wid = wid; body.voter = voter; body.dev = dev; if (area) body.area = area;
    return fetch('/api/wants/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || 'Something went wrong. Please try again.'); return j; }); });
  }
  function vote(k) {
    if (busy) return; busy = true;
    var was = mine; mine = k; tally[k] = (tally[k] || 0) + 1; if (was) tally[was] = Math.max(0, (tally[was] || 0) - 1);
    showResults(); // right away; the real counts land a moment later
    post({ action: 'vote', choice: k }).then(function (j) { tally = j.tally || tally; showResults(); track('News poll vote', { wid: wid, choice: k }); })
      .catch(function (e) { mine = was; if (window.SV && SV.toast) SV.toast(e.message); showVote(); })
      .then(function () { busy = false; });
  }

  optsEl.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-own')) { optsEl.hidden = true; form.hidden = false; msg.textContent = ''; ta.focus(); track('News poll own open', { wid: wid }); return; }
    vote(b.getAttribute('data-k'));
  });
  form.querySelector('[data-own-cancel]').addEventListener('click', showVote);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = ta.value.trim(); if (text.length < 3 || busy) return;
    busy = true; msg.textContent = 'Checking your answer…';
    var sub = form.querySelector('button[type=submit]'); sub.disabled = true;
    post({ action: 'add-option', text: text }).then(function (j) {
      busy = false; sub.disabled = false;
      if (j.rejected) { msg.textContent = j.rejected; return; }
      if (j.same) { msg.textContent = ''; ta.value = ''; if (window.SV && SV.toast) SV.toast('That’s close to “' + labelOf(j.same) + '”, so we counted you there.'); vote(j.same); return; }
      ta.value = '';
      if (j.status === 'pending') { msg.textContent = 'Thanks. Your answer shows here once we’ve had a look at it.'; return; }
      addExtra(j.option); mine = j.option.key; tally = j.tally || tally; showResults(); track('News poll own added', { wid: wid });
    }).catch(function (err) { busy = false; sub.disabled = false; msg.textContent = err.message; });
  });
  resEl.addEventListener('click', function (e) {
    if (e.target.closest('[data-change]')) { showVote(); return; }
    if (e.target.closest('[data-next]')) track('News poll next story', { from: wid });
    if (e.target.closest('[data-wants]')) track('News poll to wants', { from: wid });
  });

  // Arriving from another story's "Have your say on more stories" link: bring the vote into view.
  if (location.hash === '#vote') setTimeout(function () { box.scrollIntoView({ block: 'center' }); }, 300);

  fetch('/api/wants/?voter=' + encodeURIComponent(voter)).then(function (r) { return r.json(); }).then(function (j) {
    if (!j || !j.ok) return;
    ((j.extras || {})[wid] || []).forEach(addExtra);
    tally = (j.tallies || {})[wid] || {};
    mine = (j.mine || {})[wid] || '';
    if (mine) showResults();
  }).catch(function () {});
})();
