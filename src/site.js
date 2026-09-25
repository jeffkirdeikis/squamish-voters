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
  if (menuBtn && panel) menuBtn.addEventListener('click', function () {
    var open = panel.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.querySelector('span').textContent = open ? 'Close' : 'Menu';
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
    if (document.referrer && new URL(document.referrer).host === location.host && !document.referrer.endsWith('/candidates/')) {
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

  window.SV = { getBallot: getBallot, setBallot: setBallot, toggle: toggle, toast: toast, store: store, renderPicks: render, track: track, compassYou: compassYou };
  render();
})();
