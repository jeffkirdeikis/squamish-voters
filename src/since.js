// Home: the yellow "New" line in the hero for returning visitors (build.mjs sinceData). Political stories only. This
// browser remembers which stories it has already seen (localStorage sv_seen); on a later visit, at least 30 minutes on,
// the newest unseen political story shows in the hero, and stays for the rest of that visit so a reload doesn't wipe it.
// The "Since your last visit" box under the hero is gone (Jeff, Nov 26 2026: "I hate this section"). Nothing is sent anywhere.
(function () {
  // Hero meeting card: "Next meeting · in 6 days", worked out on the reader's own clock.
  Array.prototype.forEach.call(document.querySelectorAll('[data-until]'), function (u) {
    var p = u.getAttribute('data-until').split('-'), t = new Date(), n = Math.round((new Date(+p[0], +p[1] - 1, +p[2]) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
    if (n >= 0) u.textContent = ' · ' + (n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days');
  });
  var el = document.getElementById('since-data');
  if (!el) return;
  var D; try { D = JSON.parse(el.textContent); } catch (e) { return; }
  function get(st, k) { try { return JSON.parse(st.getItem(k)); } catch (e) { return null; } }
  function put(st, k, v) { try { st.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(n, d) { if (window.SV && SV.track) try { SV.track(n, d); } catch (e) {} }
  var now = Date.now();
  var snap = { at: now, slugs: D.stories.map(function (s) { return s.slug; }), meets: D.decided.map(function (m) { return m.id; }) };

  var shown = get(sessionStorage, 'sv_since'); // already worked out earlier in this visit
  if (shown) {
    // A list saved earlier in this visit only keeps what the page lists now (Nov 26 2026: after the list went politics
    // only, a refresh kept showing the canoe story saved before the update).
    var cur = {}, curM = {};
    D.stories.forEach(function (s) { cur[s.slug] = s; });
    D.decided.forEach(function (m) { curM[m.id] = m; });
    shown.stories = (shown.stories || []).filter(function (s) { return cur[s.slug]; }).map(function (s) { return cur[s.slug]; });
    shown.decided = (shown.decided || []).filter(function (m) { return curM[m.id]; }).map(function (m) { return curM[m.id]; });
  }
  if (!shown) {
    var prev = get(localStorage, 'sv_seen');
    if (!prev || !prev.at || now - prev.at < 30 * 60e3) { if (!prev || !prev.at) put(localStorage, 'sv_seen', snap); return; }
    var seenS = {}, seenM = {};
    (prev.slugs || []).forEach(function (x) { seenS[x] = 1; });
    (prev.meets || []).forEach(function (x) { seenM[x] = 1; });
    shown = {
      at: prev.at,
      stories: D.stories.filter(function (s) { return !seenS[s.slug]; }),
      decided: D.decided.filter(function (m) { return !seenM[m.id]; }),
    };
    // Keep what they'd already seen plus everything on the page now, so a story that drops off the list isn't "new" again.
    snap.slugs = snap.slugs.concat((prev.slugs || []).filter(function (x) { return snap.slugs.indexOf(x) < 0; })).slice(0, 300);
    snap.meets = snap.meets.concat((prev.meets || []).filter(function (x) { return snap.meets.indexOf(x) < 0; })).slice(0, 60);
    put(localStorage, 'sv_seen', snap);
    put(sessionStorage, 'sv_since', shown);
  }
  if (!shown.stories.length) return;

  var S = shown.stories, hl = document.querySelector('[data-since-hero]');
  if (hl && document.documentElement.classList.contains('sv-back')) {
    hl.href = '/news/' + S[0].slug + '/';
    hl.lastElementChild.innerHTML = '<b>' + esc(S[0].head) + '</b>&nbsp;→';
    hl.hidden = false;
    hl.addEventListener('click', function () { track('Since click', { to: 'hero' }); });
  }
})();
