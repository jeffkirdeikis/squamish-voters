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

  // sections: the headings inside the page's main part, in order
  var main = document.querySelector('main') || document.body;
  var heads = [].slice.call(main.querySelectorAll('h2')).filter(function (x) { return x.offsetParent !== null; });
  function label(x) { return (x.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60); }

  send({ t: 'view', ref: ref, utm: utm.slice(0, 40), app: app, dev: dev, n: s.n, ret: ret, title: document.title.slice(0, 90), secs_all: heads.map(label).slice(0, 40) });

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
    var sm = d.querySelector('summary'); ev('opened', { what: sm ? label(sm) : '' });
  }, true);
  // a sign-up that the server accepted (site.js and flood-live.js call this)
  window.SVpulse = { ev: ev, signup: function (kind, from) { ev('signup', { kind: kind, from: from || '' }); } };
})();
