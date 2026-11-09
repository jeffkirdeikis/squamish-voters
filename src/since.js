// Home: "Since your last visit" (build.mjs sinceData). This browser remembers which stories and council meetings it
// has already seen (localStorage sv_seen). On a later visit, at least 30 minutes on, the strip lists what's new plus
// the next dates coming up. First visits show nothing. The strip stays the same for the rest of that visit, so a
// reload doesn't wipe it. Nothing is sent anywhere.
(function () {
  var box = document.querySelector('[data-since]'), el = document.getElementById('since-data');
  if (!box || !el) return;
  var D; try { D = JSON.parse(el.textContent); } catch (e) { return; }
  function get(st, k) { try { return JSON.parse(st.getItem(k)); } catch (e) { return null; } }
  function put(st, k, v) { try { st.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(n, d) { if (window.SV && SV.track) try { SV.track(n, d); } catch (e) {} }
  var now = Date.now();
  var snap = { at: now, slugs: D.stories.map(function (s) { return s.slug; }), meets: D.decided.map(function (m) { return m.id; }) };

  var shown = get(sessionStorage, 'sv_since'); // already worked out earlier in this visit
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
  if (!shown.stories.length && !shown.decided.length) return;
  if (get(sessionStorage, 'sv_since_x')) return; // closed during this visit

  function ago(t) {
    var m = Math.round((now - t) / 60e3);
    if (m < 90) return 'an hour ago';
    var h = Math.round(m / 60); if (h < 24) return h + ' hours ago';
    var d = Math.round(h / 24); if (d === 1) return 'yesterday'; if (d < 14) return d + ' days ago';
    var w = Math.round(d / 7); if (w < 9) return w + ' weeks ago';
    return 'a while ago';
  }
  function until(iso) {
    var p = iso.split('-'), t = new Date(), a = new Date(t.getFullYear(), t.getMonth(), t.getDate()), b = new Date(+p[0], +p[1] - 1, +p[2]);
    var n = Math.round((b - a) / 864e5);
    return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days';
  }
  var S = shown.stories, M = shown.decided, MAX = 3;
  var html = '<div class="since-top"><p class="since-k">Since your last visit <span>' + esc(ago(shown.at)) + '</span></p><button type="button" class="since-x" data-since-x aria-label="Close">×</button></div>';
  html += '<div class="since-cols">';
  if (S.length) html += '<div class="since-g"><p class="since-n"><b>' + S.length + (S.length === 1 ? ' new story' : ' new stories') + '</b></p><ul class="since-list">' +
    S.slice(0, MAX).map(function (s) { return '<li><a href="/news/' + esc(s.slug) + '/" data-since-go="story">' + esc(s.head) + '</a>' + (s.poll ? ' <span class="since-tag">Vote</span>' : '') + '</li>'; }).join('') + '</ul>' +
    (S.length > MAX ? '<p class="since-more"><a href="/news/" data-since-go="news">See all ' + S.length + ' new stories →</a></p>' : '') + '</div>';
  if (M.length) html += '<div class="since-g"><p class="since-n"><b>Council decided</b></p><ul class="since-list">' +
    M.slice(0, 1).map(function (m) { return '<li><a href="' + esc(m.url) + '" data-since-go="meeting">' + esc(m.head) + '</a></li>'; }).join('') + '</ul></div>';
  if (D.soon.length) html += '<div class="since-g"><p class="since-n"><b>Coming up</b></p><ul class="since-list since-soon">' +
    D.soon.map(function (x) { return '<li><span class="since-when">' + esc(until(x.date)) + '</span><a href="' + esc(x.url) + '" data-since-go="soon">' + esc(x.label) + '</a></li>'; }).join('') + '</ul></div>';
  html += '</div>';
  box.innerHTML = html; box.hidden = false;
  track('Since shown', { stories: S.length, meetings: M.length });
  box.addEventListener('click', function (e) {
    if (e.target.closest('[data-since-x]')) { box.hidden = true; put(sessionStorage, 'sv_since_x', 1); track('Since closed'); return; }
    var a = e.target.closest('[data-since-go]'); if (a) track('Since click', { kind: a.getAttribute('data-since-go') });
  });
})();
