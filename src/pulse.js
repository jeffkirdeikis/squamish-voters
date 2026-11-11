/* Reading stats, our own (api/pulse.js -> /insights/). No cookies, no name, no email, no IP address kept.
   One random visit id lives in this browser for 30 minutes of quiet, then a new one is made, so visits can't be joined up across days.
   What is sent: the page, where the visit came from, phone or computer, seconds spent reading, how far down the page,
   and taps on links, share buttons and sign-up forms (never the email address, never quiz answers or picks). */
(function () {
  var path = location.pathname.replace(/\/+$/, '') || '/';
  if (/^\/(subscribers|insights|ai-check|api)(\/|$)/.test(path)) return;
  var URL_ = '/api/pulse/', now = Date.now();
  function rid() { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // visit: id + page count, ends after 30 minutes with nothing happening
  var s = null; try { s = JSON.parse(ls('sv_visit') || 'null'); } catch (e) {}
  var fresh = !s || !s.id || now - s.last > 30 * 60e3;
  if (fresh) s = { id: rid(), n: 0 };
  s.n += 1; s.last = now;
  var ret = !!ls('sv_seen') && fresh ? 1 : (s.ret || 0); // been here before today's visit: yes or no, nothing more
  s.ret = ret; ls('sv_visit', JSON.stringify(s)); if (!ls('sv_seen')) ls('sv_seen', '1');
  var pv = rid();

  function send(o) {
    o.sid = s.id; o.pv = pv; o.path = path;
    var body = JSON.stringify(o);
    try { if (navigator.sendBeacon && navigator.sendBeacon(URL_, body)) return; } catch (e) {}
    try { fetch(URL_, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(function () {}); } catch (e) {}
  }

  // where the visit came from
  var ref = ''; try { var h = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; if (h && h !== location.hostname) ref = h; } catch (e) {}
  var qs = new URLSearchParams(location.search), utm = qs.get('utm_source') || (qs.get('fbclid') ? 'fbclid' : '') || '';
  var ua = navigator.userAgent || '';
  var app = /FBAN|FBAV|FB_IAB/.test(ua) ? 'facebook app' : /Instagram/.test(ua) ? 'instagram app' : /Reddit/i.test(ua) ? 'reddit app' : '';
  var w = window.innerWidth || 0, dev = w < 700 ? 'phone' : w < 1100 ? 'tablet' : 'computer';

  // ----- A/B test (one at a time). Half of browsers get version B, picked once and kept. Set TEST to null to stop. -----
  // join2: on news stories, B adds a compact "Stay in the loop" box (weekly email + Facebook group + Reddit) high on the page:
  // above the live river panel on a flood story, else after the first section. (join1, Nov 10: same box lower down, where 6% of readers got to.)
  var TEST = 'join2', ab = '';
  var body = /^\/news\/[^/]+/.test(path) ? document.querySelector('.nw-body') : null;
  if (TEST && body) {
    var arm = ls('sv_ab_' + TEST); if (arm !== 'A' && arm !== 'B') { arm = Math.random() < 0.5 ? 'A' : 'B'; ls('sv_ab_' + TEST, arm); }
    if (/[?&]ab=([AB])\b/.test(location.search)) arm = RegExp.$1; // ?ab=B to preview a version
    ab = TEST + ':' + arm;
    if (arm === 'B') try { loopBox(body); } catch (e) { ab = TEST + ':A'; }
  }
  function loopBox(body) {
    var box = document.createElement('aside'); box.className = 'sv-loop no-print'; box.setAttribute('aria-label', 'Stay in the loop');
    box.innerHTML = '<h3>Stay in the loop on Squamish</h3>' +
      '<p>One short email every Friday: what council decided and what is coming up.</p>' +
      '<form novalidate><div class="sv-loop-row"><input type="email" name="email" autocomplete="email" required placeholder="Your email" aria-label="Your email"><button class="btn" type="submit">Sign up</button></div><p class="small sv-loop-msg" role="status"></p></form>' +
      '<div class="sv-loop-btns"><span>Or join in:</span><a class="sv-loop-fb" href="https://www.facebook.com/groups/1090076830319905" target="_blank" rel="noopener">Facebook group</a><a class="sv-loop-rd" href="https://www.reddit.com/r/Squamish_News/" target="_blank" rel="noopener">Reddit</a></div>';
    // flood story: above the live river panel (most readers stop inside it). Others: after the first section; short stories after the third paragraph.
    var live = document.querySelector('section[data-flood-live]');
    var h2s = body.querySelectorAll('h2'), ps = [].filter.call(body.children, function (x) { return x.tagName === 'P'; });
    var before = live || (h2s.length > 1 ? h2s[1] : ps.length > 4 ? ps[3] : null);
    if (before) before.parentNode.insertBefore(box, before); else body.appendChild(box);
    var f = box.querySelector('form'), msg = box.querySelector('.sv-loop-msg'), btn = f.querySelector('button');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = f.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Please check your email address.'; return; }
      var prefs = {}; try { prefs = JSON.parse(ls('sv_prefs') || '{}') || {}; } catch (x) {}
      btn.disabled = true; msg.textContent = 'Signing you up…';
      ev('signup try', { kind: 'weekly email', from: 'story-loop', at: 'Stay in the loop box' });
      fetch('/api/subscribe/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, consent: true, from: 'story-loop', area: prefs.area || '', topics: prefs.topics || [] }) })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          msg.textContent = r.ok ? (!r.pending ? 'You’re already on the list. Thanks!' : 'Almost done: check your inbox and tap the link to confirm.') : (r.error || 'Something went wrong. Please try again.');
          if (r.ok) { f.reset(); if (r.pending) ev('signup', { kind: 'weekly email', from: 'story-loop' }); }
        })
        .catch(function () { msg.textContent = 'Something went wrong. Please try again.'; })
        .then(function () { btn.disabled = false; });
    });
  }

  // sections: the headings inside the page's main part, in order
  var main = document.querySelector('main') || document.body;
  var heads = [].slice.call(main.querySelectorAll('h2')).filter(function (x) { return x.offsetParent !== null; });
  function label(x) { return (x.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60); }

  send({ t: 'view', ab: ab, ref: ref, utm: utm.slice(0, 40), app: app, dev: dev, n: s.n, ret: ret, title: document.title.slice(0, 90), secs_all: heads.map(label).slice(0, 40) });

  // seconds spent with the page showing and the reader doing something (stops counting after 45 s of nothing)
  var secs = 0, lastAct = Date.now(), maxScroll = 0, maxSec = -1, dirty = false;
  function act() { lastAct = Date.now(); }
  ['scroll', 'touchstart', 'click', 'keydown', 'mousemove'].forEach(function (ev) { window.addEventListener(ev, act, { passive: true }); });
  function measure() {
    var doc = document.documentElement, full = Math.max(doc.scrollHeight, document.body.scrollHeight), seen = window.scrollY + window.innerHeight;
    var p = full > 0 ? Math.min(100, Math.round(100 * seen / full)) : 0;
    if (p > maxScroll) { maxScroll = p; dirty = true; }
    for (var i = maxSec + 1; i < heads.length; i++) { if (heads[i].getBoundingClientRect().top < window.innerHeight) { maxSec = i; dirty = true; } else if (heads[i].getBoundingClientRect().top > window.innerHeight * 3) break; }
  }
  var raf = 0; window.addEventListener('scroll', function () { if (!raf) raf = setTimeout(function () { raf = 0; measure(); }, 250); }, { passive: true });
  measure();
  var MARKS = [5, 15, 30, 60, 120, 180, 300, 600, 900, 1800];
  setInterval(function () {
    if (document.visibilityState !== 'visible' || Date.now() - lastAct > 45e3) return;
    secs += 1; dirty = true;
    if (MARKS.indexOf(secs) >= 0) leave();
  }, 1000);
  function leave() {
    if (!dirty) return; dirty = false; measure();
    send({ t: 'leave', secs: secs, scroll: maxScroll, sec: maxSec, secname: maxSec >= 0 ? label(heads[maxSec]) : '' });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leave(); });
  window.addEventListener('pagehide', leave);

  // taps
  function ev(name, data) { send({ t: 'ev', name: name, data: data || {}, secs: secs }); }
  function zone(el) {
    if (el.closest('.sv-loop')) return 'Stay in the loop box';
    if (el.closest('.tabbar')) return 'bottom bar'; if (el.closest('#menu-panel')) return 'menu'; if (el.closest('header')) return 'top bar';
    if (el.closest('footer')) return 'footer';
    var sec = el.closest('section, .card, article, details'), hd = sec && sec.querySelector('h2, h3, summary');
    return hd ? label(hd) : 'page';
  }
  document.addEventListener('click', function (e) {
    var t = e.target; if (!t.closest) return;
    var sh = t.closest('[data-sh], [data-nw-share], [data-area-share], [data-natshare], [data-copy]');
    if (sh) { ev('share', { how: sh.getAttribute('data-sh') || sh.getAttribute('data-area-share') || (sh.hasAttribute('data-copy') ? 'copy' : 'share'), at: zone(sh) }); return; }
    var a = t.closest('a[href]'); if (!a) return;
    var href = a.getAttribute('href') || ''; if (href.charAt(0) === '#') { ev('jump', { to: href.slice(0, 60), at: zone(a) }); return; }
    var u; try { u = new URL(a.href); } catch (x) { return; }
    if (!/^https?:$/.test(u.protocol)) { ev('out', { to: u.protocol.replace(':', ''), at: zone(a) }); return; }
    if (u.hostname === location.hostname) { ev('nav', { to: (u.pathname.replace(/\/+$/, '') || '/').slice(0, 120), at: zone(a) }); leave(); return; }
    var host = u.hostname.replace(/^www\./, '');
    if (/facebook\.com$/.test(host) && /\/groups\/1090076830319905/.test(u.pathname)) ev('facebook group', { at: zone(a) });
    else if (/reddit\.com$/.test(host) && /\/r\/Squamish_News/i.test(u.pathname)) ev('reddit group', { at: zone(a) });
    else ev('out', { to: host.slice(0, 60), at: zone(a) });
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f || !f.closest) return;
    var kind = f.hasAttribute('data-subscribe') ? 'weekly email' : f.closest('[data-flood-alert]') ? 'flood alert' : null;
    if (kind) ev('signup try', { kind: kind, from: f.getAttribute('data-subscribe') || 'flood story', at: zone(f) });
  }, true);
  document.addEventListener('focusin', function (e) {
    var i = e.target; if (!i || i.type !== 'email' || i._svf) return; i._svf = 1;
    ev('email box tapped', { at: zone(i) });
  });
  document.addEventListener('toggle', function (e) {
    var d = e.target; if (!d || !d.open || d.tagName !== 'DETAILS' || !main.contains(d)) return;
    var sm = d.querySelector('summary'), st = sm && (sm.querySelector('b, strong, span') || sm); ev('opened', { what: st ? label(st) : '' });
  }, true);
  // a sign-up that the server accepted (site.js and flood-live.js call this)
  window.SVpulse = { ev: ev, signup: function (kind, from) { ev('signup', { kind: kind, from: from || '' }); } };
})();
