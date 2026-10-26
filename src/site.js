/* Squamish Voters 2026 — shared behaviour: menu, text size, "My ballot" picks.
   Everything degrades gracefully if localStorage is unavailable. */
(function () {
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var MAX_COUNCIL = 6;

  // The A-A-A control was removed; clear any saved size so nobody is stuck at one.
  try { localStorage.removeItem('sv26_text'); document.documentElement.removeAttribute('data-text'); } catch (e) {}

  // ----- menu -----
  var menuBtn = document.querySelector('.menu-btn'), panel = document.getElementById('menu-panel');
  function setMenu(open) {
    panel.classList.toggle('open', open);
    if (menuBtn) { menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.querySelector('span').textContent = open ? 'Close' : 'Menu'; }
    document.querySelectorAll('[data-menu-open]').forEach(function (b) { b.setAttribute('aria-expanded', String(open)); });
  }
  if (menuBtn && panel) menuBtn.addEventListener('click', function () { setMenu(!panel.classList.contains('open')); });
  // The More tab at the bottom opens the same menu and scrolls up to it.
  document.querySelectorAll('[data-menu-open]').forEach(function (b) {
    b.addEventListener('click', function () { var open = !panel.classList.contains('open'); setMenu(open); if (open) window.scrollTo({ top: 0, behavior: 'smooth' }); });
  });
  // Desktop dropdowns open on hover or focus (CSS); the arrow button opens them by tap or keyboard too.
  document.querySelectorAll('.nav-dd-btn').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var dd = b.closest('.nav-dd'), open = !dd.classList.contains('open');
      document.querySelectorAll('.nav-dd.open').forEach(function (x) { x.classList.remove('open'); x.querySelector('.nav-dd-btn').setAttribute('aria-expanded', 'false'); });
      dd.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('.nav-dd')) return;
    document.querySelectorAll('.nav-dd.open').forEach(function (x) { x.classList.remove('open'); x.querySelector('.nav-dd-btn').setAttribute('aria-expanded', 'false'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.nav-dd.open').forEach(function (x) { x.classList.remove('open'); x.querySelector('.nav-dd-btn').setAttribute('aria-expanded', 'false'); });
  });

  // ----- ballot -----
  function getBallot() { var b = store.get('sv26_ballot', null) || {}; return { mayor: b.mayor || null, council: Array.isArray(b.council) ? b.council : [] }; }
  function setBallot(b) { store.set('sv26_ballot', b); render(); document.dispatchEvent(new CustomEvent('sv:ballot')); }
  function toast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function isPicked(b, slug, office) { return office === 'mayor' ? b.mayor === slug : b.council.indexOf(slug) > -1; }
  function toggle(slug, office, name) {
    var b = getBallot();
    if (office === 'mayor') {
      if (b.mayor === slug) { b.mayor = null; toast('Removed ' + name + ' from your ballot'); }
      else { b.mayor = slug; toast(name + ' is now your pick for mayor'); track('Ballot add'); }
    } else {
      var i = b.council.indexOf(slug);
      if (i > -1) { b.council.splice(i, 1); toast('Removed ' + name + ' from your ballot'); }
      else if (b.council.length >= MAX_COUNCIL) { toast('You can pick up to 6 councillors. Remove one first.'); return; }
      else { b.council.push(slug); toast('Added ' + name + ' (' + b.council.length + ' of 6 council picks)'); track('Ballot add'); }
    }
    setBallot(b);
  }
  function render() {
    var b = getBallot(), n = (b.mayor ? 1 : 0) + b.council.length;
    document.querySelectorAll('.ballot-count').forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
    document.querySelectorAll('[data-pick]').forEach(function (btn) {
      var on = isPicked(b, btn.getAttribute('data-pick'), btn.getAttribute('data-office'));
      btn.classList.toggle('picked', on);
      btn.setAttribute('aria-pressed', String(on));
      var compact = btn.classList.contains('add');
      btn.textContent = on ? (compact ? '✓ Added' : '✓ On my ballot') : (compact ? '+ Add' : '+ Add to my ballot');
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pick]');
    if (!btn) return;
    toggle(btn.getAttribute('data-pick'), btn.getAttribute('data-office'), btn.getAttribute('data-name'));
  });
  // ----- one picker, one panel: long pages show a single section at a time -----
  document.querySelectorAll('[data-picker]').forEach(function (p) {
    var group = p.getAttribute('data-picker');
    var btns = [].slice.call(p.querySelectorAll('[data-show]'));
    var panels = [].slice.call(document.querySelectorAll('[data-panel][data-group="' + group + '"]'));
    var nav = document.querySelector('[data-panel-nav="' + group + '"]');
    var ids = btns.map(function (b) { return b.getAttribute('data-show'); });
    var sel, prev, next;
    function show(id, push) {
      if (ids.indexOf(id) < 0) id = ids[0];
      btns.forEach(function (b) { var on = b.getAttribute('data-show') === id; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); });
      panels.forEach(function (s) { s.hidden = (s.getAttribute('data-with') || s.id) !== id; });
      if (nav) {
        var i = ids.indexOf(id);
        nav.textContent = '';
        [[i - 1, '←&nbsp;'], [i + 1, '']].forEach(function (pair, k) {
          var j2 = pair[0]; if (j2 < 0 || j2 >= ids.length) return;
          var a = document.createElement('button');
          a.type = 'button'; a.className = 'btn secondary';
          a.innerHTML = (k === 0 ? '← ' : '') + btns[j2].textContent.trim() + (k === 1 ? ' →' : '');
          a.onclick = function () { show(ids[j2], true); window.scrollTo({ top: p.getBoundingClientRect().top + window.scrollY - 80 }); };
          nav.append(a);
        });
      }
      if (sel) { sel.value = id; prev.disabled = ids.indexOf(id) === 0; next.disabled = ids.indexOf(id) === ids.length - 1; }
      if (push) { history.replaceState(null, '', '#' + id); if (window.SV && SV.track) SV.track('Topic viewed', { topic: id, on: location.pathname === '/' ? 'home' : location.pathname.indexOf('/candidates') === 0 ? 'candidates' : 'compare' }); }
    }
    btns.forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-show'), true); }); });
    // phones: one pinned "Topic" menu with back/next arrows replaces the wall of chips (CSS swaps them)
    var bar = document.createElement('div'); bar.className = 'picker-bar no-print';
    var lab = document.createElement('label'); lab.textContent = 'Choose a topic, or use the arrows'; lab.htmlFor = group + '-sel';
    sel = document.createElement('select'); sel.id = group + '-sel';
    btns.forEach(function (b) { var o = document.createElement('option'); o.value = b.getAttribute('data-show'); o.textContent = b.textContent.trim(); sel.append(o); });
    function arrow(txt, name, step) {
      var a = document.createElement('button'); a.type = 'button'; a.className = 'picker-step'; a.textContent = txt; a.setAttribute('aria-label', name);
      a.onclick = function () { go(ids[ids.indexOf(sel.value) + step]); };
      return a;
    }
    function go(id) {
      if (!id) return;
      show(id, true);
      var top = bar.parentNode.getBoundingClientRect().top; // start the new topic from its top, not mid-way down the old one
      if (top < 0) window.scrollTo({ top: top + window.scrollY - 70 });
    }
    prev = arrow('‹', 'Previous topic', -1); next = arrow('›', 'Next topic', 1);
    sel.addEventListener('change', function () { go(sel.value); });
    // the chips move inside the bar so desktop shows ‹ [chips] › and phones show ‹ [menu] › (CSS picks)
    p.parentNode.insertBefore(bar, p);
    bar.append(lab, prev, sel, p, next);
    show(location.hash.slice(1) || ids[0], false);
    // a jump link elsewhere on the page (#council) shouldn't reset the open topic
    window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (ids.indexOf(h) >= 0) show(h, false); });
  });

  // ----- little carousel (home "Where they lean"): ‹ › step through slides, wrapping at the ends -----
  document.querySelectorAll('[data-carousel]').forEach(function (car) {
    var slides = [].slice.call(car.querySelectorAll('[data-slide]'));
    var count = car.querySelector('[data-car-count]');
    var i = 0;
    function show(n) {
      i = (n + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.hidden = k !== i; });
      if (count) count.textContent = (i + 1) + ' of ' + slides.length;
      if (typeof layoutTracks === 'function') layoutTracks();
      if (window.SV && SV.compassYou) SV.compassYou(car); // ★ You can only be placed on a chart once it is visible
      car.dispatchEvent(new CustomEvent('slide', { detail: slides[i] }));
    }
    var ev = car.getAttribute('data-track') || 'Lean teaser';
    car.querySelectorAll('[data-car-prev]').forEach(function (b) { b.addEventListener('click', function () { show(i - 1); if (window.SV && SV.track) SV.track(ev, { step: 'prev' }); }); });
    car.querySelectorAll('[data-car-next]').forEach(function (b) { b.addEventListener('click', function () { show(i + 1); if (window.SV && SV.track) SV.track(ev, { step: 'next' }); }); });
    // swipe on phones
    var x0 = null;
    car.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    car.addEventListener('touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) show(dx < 0 ? i + 1 : i - 1); }, { passive: true });
    // /compass/?map=cars opens on that map (links from the small compass cards)
    var want = (location.search.match(/[?&]map=(\w+)/) || [])[1], start = 0;
    slides.forEach(function (s, k) { if (want && s.getAttribute('data-cmap-slide') === want) start = k; });
    show(start);
  });

  // ----- home lean track: fan overlapping faces into rows using real pixel widths (build-time lanes are a % guess that is too tight on phones) -----
  function layoutTracks() {
    document.querySelectorAll('.teaser-track').forEach(function (t) {
      var w = t.clientWidth; if (!w) return;
      var spans = [].slice.call(t.children).map(function (el) { return { el: el, x: parseFloat(el.style.left) / 100 * w }; }).sort(function (a, b) { return a.x - b.x; });
      var face = (spans[0] && spans[0].el.firstElementChild ? spans[0].el.firstElementChild.offsetWidth : 30) + 4;
      var OFF = [0, -1, 1, -2, 2, -3, 3], lanes = [], maxAbs = 0;
      spans.forEach(function (s) {
        var l = 0; while (l < OFF.length - 1 && lanes[l] !== undefined && s.x - lanes[l] < face) l++;
        lanes[l] = s.x; s.el.style.marginTop = (OFF[l] * 1.8) + 'rem'; maxAbs = Math.max(maxAbs, Math.abs(OFF[l]));
      });
      t.style.height = (Math.max(2, maxAbs) * 2 + 1) * 1.85 + 'rem';
    });
  }
  layoutTracks();
  window.addEventListener('resize', layoutTracks);

  // ----- jargon pop-up: tap a dotted word, get a plain definition -----
  var pop;
  document.addEventListener('click', function (e) {
    var g = e.target.closest('button.gl');
    if (pop && !e.target.closest('#glpop')) { pop.remove(); pop = null; }
    if (!g) return;
    pop = document.createElement('div');
    pop.id = 'glpop'; pop.setAttribute('role', 'dialog');
    var b = document.createElement('b'); b.textContent = g.getAttribute('data-term');
    var d = document.createElement('div'); d.textContent = g.getAttribute('data-def');
    var x = document.createElement('button'); x.type = 'button'; x.textContent = 'Got it';
    x.onclick = function () { pop.remove(); pop = null; g.focus(); };
    pop.append(b, d, x); document.body.append(pop);
    var r = g.getBoundingClientRect(), h = pop.offsetHeight, w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    pop.style.top = (r.bottom + h + 12 < window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8)) + 'px';
    x.focus();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) { pop.remove(); pop = null; } });

  // ----- "back" links follow real history when we came from inside the site -----
  document.querySelectorAll('[data-back]').forEach(function (a) {
    if (document.referrer && new URL(document.referrer).host === location.host && !document.referrer.endsWith('/council/')) {
      a.addEventListener('click', function (e) { e.preventDefault(); history.back(); });
    }
  });

  // ----- back to top -----
  var tt = document.getElementById('totop');
  if (tt) window.addEventListener('scroll', function () { tt.hidden = window.scrollY < 1200; }, { passive: true });

  // Printing: collapsed sections would print as headings only, so open them all first.
  window.addEventListener('beforeprint', function () { document.querySelectorAll('details').forEach(function (d) { d.open = true; }); document.querySelectorAll('[data-panel][hidden]').forEach(function (p) { p.hidden = false; }); });

  // Anonymous counts only (Vercel Web Analytics, no cookies). Never pass answers, picks or names.
  // data: only what part of the site was used (a topic, a statement id, a step number) — never answers, picks or names
  function track(name, data) { try { if (window.va) window.va('event', data ? { name: name, data: data } : { name: name }); } catch (e) {} }
  // which page type an event happened on, without the candidate's name
  function where() { var p = location.pathname.split('/').filter(Boolean); return p[0] === 'candidates' && p[1] ? 'profile' : (p[0] || 'home'); }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.src'); if (a) track('Source opened', { on: where() });
  });
  document.addEventListener('toggle', function (e) {
    var d = e.target; if (!d.open || !d.classList) return;
    if (d.classList.contains('said')) track('Comments opened', { statement: d.getAttribute('data-q') || '', on: where() });
    else if (d.classList.contains('means')) track('Explainer opened', { statement: d.getAttribute('data-q') || '', on: where() });
  }, true);
  // ----- ★ You on any compass (full or small), from quiz answers saved on this device — nothing is sent -----
  function compassYou(root) {
    var ans = (store.get('sv26_quiz', null) || {}).answers || {};
    function score(q) {
      var vals = Object.keys(q).map(function (id) { return typeof ans[id] === 'number' ? ans[id] * q[id] : null; }).filter(function (v) { return v !== null; });
      return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
    }
    var any = false;
    [].forEach.call((root || document).querySelectorAll('svg[data-map]'), function (svg) {
      if (!svg.getClientRects().length) return; // hidden copy (phone vs desktop chart): placed when it shows
      var M; try { M = JSON.parse(svg.getAttribute('data-map')); } catch (e) { return; }
      var yx = score(M.x), yy = score(M.y);
      if (yx === null || yy === null || svg.querySelector('.cyou')) { if (svg.querySelector('.cyou')) any = true; return; }
      var S = (M.W - 2 * M.P) / (2 * M.R), x = M.P + (yx + M.R) * S, y = M.P + (M.R - yy) * S, f = M.fs / 18;
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('class', 'cyou');
      g.innerHTML = '<circle cx="' + x + '" cy="' + y + '" r="' + 13 * f + '" fill="#ffb703" stroke="#14211c" stroke-width="2"/><text x="' + x + '" y="' + (y + 6 * f) + '" text-anchor="middle" font-size="' + 17 * f + '" font-weight="700" fill="#14211c">★</text><text class="cyl" font-size="' + M.fs + '" font-weight="700" fill="#14211c" paint-order="stroke" stroke="#fcfcfb" stroke-width="4">You</text>';
      svg.appendChild(g);
      // put "You" wherever it doesn't cover a candidate's name or dot
      var lab = g.querySelector('.cyl'), r = 13 * f, others = [].map.call(svg.querySelectorAll('.cdot text, .cdot circle'), function (el) { try { return el.getBBox(); } catch (e) { return null; } }).filter(Boolean);
      var tries = [[x + r + 4, y + M.fs * .35, 'start'], [x - r - 4, y + M.fs * .35, 'end'], [x, y + r + M.fs, 'middle'], [x, y - r - 6, 'middle'], [x + r, y - r, 'start'], [x - r, y - r, 'end'], [x + r, y + r + M.fs * .7, 'start'], [x - r, y + r + M.fs * .7, 'end']];
      for (var t = 0; t < tries.length; t++) {
        lab.setAttribute('x', tries[t][0]); lab.setAttribute('y', tries[t][1]); lab.setAttribute('text-anchor', tries[t][2]);
        var bb = lab.getBBox();
        var clash = bb.x < 2 || bb.x + bb.width > M.W - 2 || others.some(function (o) { return bb.x < o.x + o.width && bb.x + bb.width > o.x && bb.y < o.y + o.height && bb.y + bb.height > o.y; });
        if (!clash) break;
        if (t === tries.length - 1) { lab.setAttribute('x', tries[0][0]); lab.setAttribute('y', tries[0][1]); lab.setAttribute('text-anchor', 'start'); }
      }
      any = true;
    });
    [].forEach.call((root || document).querySelectorAll('[data-you]'), function (el) { el.hidden = (el.getAttribute('data-you') === 'has') !== any; });
    return any;
  }
  compassYou();

  // a link straight to a collapsed section (/council/x/#questionnaire) opens it
  function openHash() { var d = location.hash && document.getElementById(location.hash.slice(1)); if (d && d.tagName === 'DETAILS') { d.open = true; d.scrollIntoView(); } }
  openHash(); window.addEventListener('hashchange', openHash);

  // ----- live page view counter (Vercel Web Analytics total, via /api/visits/) -----
  var visitEls = document.querySelectorAll('[data-visits]'), shown = 0;
  function showVisits(n) {
    var from = shown, t0 = 0;
    shown = n;
    visitEls.forEach(function (el) { el.hidden = false; });
    // First load shows the number straight away; later increases count up to it.
    if (!from) { visitEls.forEach(function (el) { el.querySelector('b').textContent = n.toLocaleString('en-CA'); }); return; }
    function step(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / 1500), v = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3)));
      visitEls.forEach(function (el) { el.querySelector('b').textContent = v.toLocaleString('en-CA'); });
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function loadVisits() {
    if (document.hidden) return;
    fetch('/api/visits/').then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok && d.pageviews > shown) showVisits(d.pageviews);
    }).catch(function () {});
  }
  if (visitEls.length) { loadVisits(); setInterval(loadVisits, 30000); }

  window.SV = { getBallot: getBallot, setBallot: setBallot, toggle: toggle, toast: toast, store: store, renderPicks: render, track: track, compassYou: compassYou };
  render();
})();

/* ---------- Council tracker (Oct 2026): "what matters to you", copy and print, weekly email sign-up ---------- */
(function () {
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // What matters to you: neighbourhood + topics, saved on this device only.
  var box = document.getElementById('foryou');
  if (box && window.SV_FEED) {
    var prefs = get('sv_prefs', { area: '', topics: [] });
    var sel = box.querySelector('[data-pref="area"]'), feed = box.querySelector('[data-feed]');
    function draw() {
      sel.value = prefs.area || '';
      box.querySelectorAll('[data-topic]').forEach(function (b) { b.setAttribute('aria-pressed', String(prefs.topics.indexOf(b.getAttribute('data-topic')) > -1)); });
      if (!prefs.area && !prefs.topics.length) { feed.innerHTML = ''; return; }
      var hits = SV_FEED.filter(function (x) {
        var a = prefs.area && (x.areas || []).indexOf(prefs.area) > -1, t = prefs.topics.indexOf(x.topic) > -1;
        return a || t;
      }).sort(function (a, b) { return (b.date || '0').localeCompare(a.date || '0'); }).slice(0, 8);
      feed.innerHTML = hits.length ? '<ul class="feed">' + hits.map(function (x) {
        return '<li><a href="' + x.url + '"><span class="fk">' + esc(x.k) + (x.date ? ' · ' + new Date(x.date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '') + '</span><b>' + esc(x.title) + '</b>' + (x.for_you ? '<span class="small">' + esc(x.for_you) + '</span>' : '') + '</a></li>';
      }).join('') + '</ul>' : '<p class="small">Nothing on these yet. As council meets, anything about them shows up here first.</p>';
    }
    sel.addEventListener('change', function () { prefs.area = sel.value; put('sv_prefs', prefs); draw(); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-topic]'); if (!b) return;
      var t = b.getAttribute('data-topic'), i = prefs.topics.indexOf(t);
      if (i > -1) prefs.topics.splice(i, 1); else prefs.topics.push(t);
      put('sv_prefs', prefs); draw();
    });
    draw();
  }

  // Copy a ready-made post (for Facebook groups), and print with every section opened.
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-copy]');
    if (c) {
      var t = c.getAttribute('data-copy');
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { if (window.SV && SV.toast) SV.toast('Copied. Paste it into Facebook or a text.'); }, function () { window.prompt('Copy this:', t); });
      return;
    }
    if (e.target.closest('[data-print]')) window.print();
  });
  window.addEventListener('beforeprint', function () { document.querySelectorAll('main details').forEach(function (d) { d.setAttribute('open', ''); }); });

  // Weekly email sign-up.
  document.querySelectorAll('form[data-subscribe]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('[data-msg]'), email = f.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Please check your email address.'; return; }
      var p = get('sv_prefs', { area: '', topics: [] });
      f.querySelector('button').disabled = true; msg.textContent = 'Signing you up…';
      fetch('/api/subscribe/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, consent: true, from: f.getAttribute('data-subscribe'), area: p.area, topics: p.topics }) })
        .then(function (r) { return r.json(); })
        .then(function (r) { msg.textContent = r.ok ? (!r.pending ? 'You’re already on the list. Thanks!' : r.sent ? 'Almost done: check your inbox and tap the link to confirm.' : 'Thanks! We’ll email you a link to confirm before the first one goes out.') : (r.error || 'Something went wrong. Please try again.'); if (r.ok) f.reset(); })
        .catch(function () { msg.textContent = 'Something went wrong. Please try again.'; })
        .then(function () { f.querySelector('button').disabled = false; });
      if (window.SV && SV.track) SV.track('Email signup', { from: f.getAttribute('data-subscribe') });
    });
  });

  // Welcome page (after the confirm link): up to 3 top issues, which way they lean on each, and their neighbourhood.
  // Saved to their sign-up as they go. The token comes in the link once, then lives in this tab only.
  var wq = document.querySelector('[data-wq]');
  if (wq && window.SV_SIDES) {
    var tok = new URLSearchParams(location.search).get('t');
    try { if (tok) sessionStorage.setItem('sv_wt', tok); else tok = sessionStorage.getItem('sv_wt'); } catch (e) {}
    if (tok && history.replaceState) history.replaceState(null, '', location.pathname);
    if (!tok) {
      wq.hidden = true; document.querySelector('[data-wok]').hidden = true; document.querySelector('[data-wnotok]').hidden = false;
      document.querySelector('[data-wh]').textContent = 'Welcome to Squamish Voters';
    } else {
      var ans = { topics: [], stances: {}, notes: {}, area: '' }, cur = null, timer, touched = false;
      var dlg = document.querySelector('[data-wdlg]'), note = wq.querySelector('[data-wnote]'), saved = wq.querySelector('[data-wsaved]');
      var MORE = [['mid', 'Somewhere in between'], ['other', 'Other']]; // Other opens a box to write their own
      var sideLabel = function (k) {
        var v = ans.stances[k], all = SV_SIDES[k].o.concat(MORE);
        if (v === 'other') return 'Other' + (ans.notes[k] ? ': “' + ans.notes[k] + '”' : '');
        for (var i = 0; i < all.length; i++) if (all[i][0] === v) return all[i][1];
        return '';
      };
      var drawW = function () {
        wq.querySelectorAll('[data-wi]').forEach(function (b) { b.setAttribute('aria-pressed', String(ans.topics.indexOf(b.getAttribute('data-wi')) > -1)); });
        wq.querySelectorAll('[data-wa]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-wa') === ans.area)); });
        wq.querySelector('[data-wpicks]').innerHTML = ans.topics.map(function (k) {
          var s = SV_SIDES[k], l = sideLabel(k);
          return '<li><span>' + s.i + ' <b>' + esc(s.t) + '</b><br><span class="small">' + (l ? esc(l) : 'Which way do you lean? Tap Answer.') + '</span></span><button type="button" data-wchange="' + k + '">' + (l ? 'Change' : 'Answer') + '</button></li>';
        }).join('');
      };
      var save = function () {
        touched = true;
        put('sv_prefs', { area: ans.area === 'outside' ? '' : ans.area, topics: ans.topics.slice() });
        saved.textContent = 'Saving…';
        clearTimeout(timer);
        timer = setTimeout(function () {
          fetch('/api/subscribe/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok, topics: ans.topics, stances: ans.stances, notes: ans.notes, area: ans.area }) })
            .then(function (r) { return r.json(); })
            .then(function (r) { saved.textContent = r.ok ? 'Saved ✓' : (r.error || 'That didn’t save. Please try again.'); })
            .catch(function () { saved.textContent = 'That didn’t save. Check your connection and try again.'; });
        }, 500);
      };
      var closeD = function () { cur = null; if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); };
      var ask = function (k) {
        var s = SV_SIDES[k], v = ans.stances[k];
        cur = k;
        dlg.querySelector('[data-wdt]').textContent = s.i + ' ' + s.t;
        dlg.querySelector('[data-wdq]').textContent = s.q;
        dlg.querySelector('[data-wdo]').innerHTML = s.o.map(function (o) {
          return '<button type="button" class="btn secondary' + (v === o[0] ? ' picked' : '') + '" data-wv="' + o[0] + '">' + esc(o[1]) + '</button>';
        }).join('') + '<div class="sides-more">' + MORE.map(function (o) {
          return '<button type="button" class="chip-btn" aria-pressed="' + (v === o[0]) + '" data-wv="' + o[0] + '">' + o[1] + '</button>';
        }).join('') + '</div><div class="sides-other" data-wother' + (v === 'other' ? '' : ' hidden') + '><label class="fld" for="wotext">In your own words <span class="small">(optional)</span></label>' +
          '<textarea id="wotext" data-wotext rows="3" maxlength="280">' + esc(ans.notes[k] || '') + '</textarea><button type="button" class="btn" data-wosave>Save</button></div>';
        if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      };
      dlg.addEventListener('click', function (e) {
        var b = e.target.closest('[data-wv]'), v = b && b.getAttribute('data-wv');
        if (v === 'other') { // show the write-in box; it saves when they tap Save
          dlg.querySelectorAll('[data-wv]').forEach(function (x) { x.classList.remove('picked'); if (x.hasAttribute('aria-pressed')) x.setAttribute('aria-pressed', String(x === b)); });
          dlg.querySelector('[data-wother]').hidden = false; dlg.querySelector('[data-wotext]').focus();
          return;
        }
        if (v && cur) { ans.stances[cur] = v; delete ans.notes[cur]; drawW(); save(); closeD(); return; }
        if (e.target.closest('[data-wosave]') && cur) {
          var t = dlg.querySelector('[data-wotext]').value.trim();
          ans.stances[cur] = 'other';
          if (t) ans.notes[cur] = t; else delete ans.notes[cur];
          drawW(); save(); closeD(); return;
        }
        var r = dlg.getBoundingClientRect(), out = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if ((e.target === dlg && out) || e.target.closest('[data-wclose]')) closeD(); // tap outside the box, or the ×
      });
      wq.addEventListener('click', function (e) {
        var c = e.target.closest('[data-wchange]');
        if (c) { ask(c.getAttribute('data-wchange')); return; }
        var b = e.target.closest('[data-wi]');
        if (b) {
          var k = b.getAttribute('data-wi'), i = ans.topics.indexOf(k);
          note.textContent = '';
          if (i > -1) { ans.topics.splice(i, 1); delete ans.stances[k]; delete ans.notes[k]; drawW(); save(); return; }
          if (ans.topics.length >= 3) { note.textContent = 'You’ve picked 3. Tap one of them to remove it first.'; return; }
          ans.topics.push(k); drawW(); save(); ask(k);
          return;
        }
        var a = e.target.closest('[data-wa]');
        if (a) { ans.area = a.getAttribute('data-wa') === ans.area ? '' : a.getAttribute('data-wa'); drawW(); save(); }
      });
      // Start from whatever they already told us (the home page picker sends its choices with the sign-up).
      fetch('/api/subscribe/?prefs=' + encodeURIComponent(tok)).then(function (r) { return r.json(); }).then(function (r) {
        if (!r.ok || touched) return;
        ans.area = r.area || '';
        ans.topics = (r.topics || []).filter(function (k) { return SV_SIDES[k]; }).slice(0, 3);
        ans.stances = r.stances || {};
        ans.notes = r.notes || {};
        drawW();
      }).catch(function () {});
      drawW();
    }
  }
  // ----- Readers' top issues (/priorities/, and the top 3 on the home page): totals from /api/priorities/, counts only -----
  var prio = document.querySelector('[data-prio]');
  if (prio && window.SV_SIDES) {
    var pcount = document.querySelector('[data-prio-count]'), pbox = document.querySelector('[data-prio-box]');
    var COUNTS_FROM = 100; // percentages only until this many readers have answered; small raw numbers look thin (Jeff, Oct 20)
    var pct = function (n, of) { return Math.round(100 * n / of) + '%'; };
    var mk = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    fetch('/api/priorities/').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) throw new Error();
      var all = prio.getAttribute('data-prio') === 'all', list = d.issues.filter(function (i) { return SV_SIDES[i.key]; });
      if (!list.length) { pcount.textContent = 'Totals appear here once ' + (d.min || 5) + ' readers have answered.'; return; }
      var counts = d.people >= COUNTS_FROM;
      pcount.textContent = (counts ? d.people + ' readers' + (d.areas > 1 ? ' from ' + d.areas + ' neighbourhoods' : '') + ' have answered so far. ' : '') +
        'The share of readers who picked each issue. Each picked up to 3, so the total is more than 100%.';
      var max = list[0].n;
      (all ? list : list.slice(0, +prio.getAttribute('data-prio'))).forEach(function (i) {
        var s = SV_SIDES[i.key], row = mk('div', 'sb-row'), track = mk('span', 'sb-track'), fill = mk('span', 'sb-fill');
        fill.style.width = (100 * i.n / max) + '%';
        track.append(fill);
        row.append(mk('span', 'sb-label', s.i + ' ' + s.t), track, mk('span', 'sb-n', counts ? i.n + ' (' + pct(i.n, d.people) + ')' : pct(i.n, d.people)));
        // Tap to see which way they lean: both sides always, in the order the question puts them, then anything else picked
        var det = mk('details', 'sb-issue sb-public'), sum = mk('summary'), ul = mk('ul', 'sb-leans'), more = mk('span', 'more-btn');
        more.setAttribute('aria-hidden', 'true');
        more.append(mk('span', 'c', 'Click to see which way they lean ▾'), mk('span', 'o', 'Show less ▴'));
        sum.append(row, more);
        [[s.o[0][0], s.o[0][1]], ['mid', 'Somewhere in between'], [s.o[1][0], s.o[1][1]], ['other', 'Other'], ['none', 'Didn’t pick a side']].forEach(function (p, n) {
          var c = i.leans[p[0]] || 0;
          if (c || n === 0 || n === 2) ul.append(mk('li', null, (counts ? c + ' × ' : pct(c, i.n) + ' ') + p[1]));
        });
        det.append(sum, mk('p', 'small muted sb-q', s.q), ul);
        prio.append(det);
      });
      if (all) {
        var none = Object.keys(SV_SIDES).filter(function (k) { return !list.some(function (i) { return i.key === k; }); });
        if (none.length) prio.append(mk('p', 'small muted', 'Nobody has picked these yet: ' + none.map(function (k) { return SV_SIDES[k].t; }).join(', ') + '.'));
      }
      if (pbox) pbox.hidden = false;
    }).catch(function () { pcount.textContent = 'The totals didn’t load. Try again in a minute.'; });
  }
})();
