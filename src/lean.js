/* "Where they lean": chapter bar that tracks your scroll, follow-one-candidate, the ★ You marker
   (from quiz answers saved in this browser — nothing is sent anywhere) and map dot details. */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // ----- chapter bar: sits under the sticky header and lights up the section on screen -----
  var hdr = $('.site-header'), bar = $('.chapters');
  function setTop() { document.documentElement.style.setProperty('--hdr', (hdr ? hdr.offsetHeight : 0) + 'px'); }
  setTop(); window.addEventListener('resize', setTop);
  var links = $$('.chapters a'), secs = links.map(function (a) { return document.getElementById(a.getAttribute('data-ch')); });
  function onScroll() {
    var y = (hdr ? hdr.offsetHeight : 0) + (bar ? bar.offsetHeight : 0) + 40, cur = -1;
    secs.forEach(function (s, i) { if (s && s.getBoundingClientRect().top <= y) cur = i; });
    links.forEach(function (a, i) {
      var on = i === cur; a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    var on = links[cur]; if (on && bar && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = on.offsetLeft - 16;
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // ----- follow one candidate across every list and the map -----
  var sel = $('#follow');
  function follow(slug, jump) {
    document.body.classList.toggle('following', !!slug);
    $$('[data-slug]').forEach(function (el) { el.classList.toggle('hl', !!slug && el.getAttribute('data-slug') === slug); });
    if (slug && CD[slug]) showDot($('.cdot[data-slug="' + slug + '"]'));
    try { history.replaceState(null, '', slug ? '#follow=' + slug : location.pathname); } catch (e) {}
    if (jump) { var first = $('.srow.hl') || $('.cdot.hl'); if (first) first.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  }
  if (sel) {
    sel.addEventListener('change', function () { follow(sel.value, true); });
    var m = location.hash.match(/follow=([\w-]+)/);
    if (m && sel.querySelector('option[value="' + m[1] + '"]')) { sel.value = m[1]; follow(m[1], true); }
  }

  // ----- ★ You: same formula as each candidate, from your saved quiz answers -----
  var quiz = window.SV && SV.store.get('sv26_quiz', null), ans = (quiz && quiz.answers) || {};
  function score(q) {
    var vals = Object.keys(q).map(function (id) { return typeof ans[id] === 'number' ? ans[id] * q[id] : null; }).filter(function (v) { return v !== null; });
    return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
  }
  var placedYou = 0, you = {};
  Object.keys(AX).forEach(function (k) {
    var v = score(AX[k]); you[k] = v; if (v === null) return;
    var sec = document.getElementById('axis-' + k), rows = $$('.srow', sec);
    var li = document.createElement('li'); li.className = 'srow you';
    li.innerHTML = '<div><span class="avatar sm" aria-hidden="true">★</span><span class="sname"><b>You</b><span>from your quiz answers</span></span><span class="strack" aria-hidden="true"><i style="left:' + (4 + (v + 2) / 4 * 92).toFixed(1) + '%"></i></span></div>';
    // Slot in among the candidates at your position, so you're between the people nearest you.
    var after = rows.filter(function (r) { return parseFloat(r.getAttribute('data-v')) <= v; }).pop();
    if (after) after.parentNode.insertBefore(li, after.nextSibling); else if (rows[0]) rows[0].parentNode.insertBefore(li, rows[0]);
    placedYou++;
  });
  var cta = $('#you-cta');
  if (cta && placedYou) cta.innerHTML = '<b>★ You’re on the lists.</b> The ★ You row shows where your <a href="/quiz/">quiz answers</a> put you. It’s worked out in your browser and never sent anywhere.';
  // the compass page has a phone chart and a desktop chart; add ★ You to whichever becomes visible
  if (window.matchMedia) { var mq = matchMedia('(max-width: 620px)'); var re = function () { SV.compassYou(); }; if (mq.addEventListener) mq.addEventListener('change', re); else if (mq.addListener) mq.addListener(re); }

  // ----- map dot details -----
  function showDot(g) {
    if (!g) return;
    $$('.cdot').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-slug') === g.getAttribute('data-slug')); }); // both charts
    var d = CD[g.getAttribute('data-slug')], e = $('#cdetail'); e.textContent = '';
    var h = document.createElement('h3'); h.style.marginTop = '0'; h.textContent = d.n;
    var u = document.createElement('ul'); d.d.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; u.append(li); });
    var a = document.createElement('a'); a.className = 'btn secondary'; a.href = '/candidates/' + g.getAttribute('data-slug') + '/'; a.textContent = 'Read full profile';
    e.append(h, u, a);
  }
  $$('.cdot').forEach(function (g) {
    g.addEventListener('click', function () { showDot(g); });
    g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); showDot(g); } });
  });
})();
