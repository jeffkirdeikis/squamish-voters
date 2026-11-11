// Only runs inside the Squamish Voters phone app (site.js loads it when the app's name is in the browser string).
// Offers phone alerts, remembers the choice, hands the phone's push token to /api/push, and opens the story when an
// alert is tapped. The website in a normal browser never loads this file.
(function () {
  var UA = navigator.userAgent, C = window.Capacitor;
  if (!/SquamishVotersApp/.test(UA) || !/SVPush/.test(UA) || !C || !C.Plugins || !C.Plugins.PushNotifications) return;
  var P = C.Plugins.PushNotifications, KEY = 'sv_push', platform = C.getPlatform ? C.getPlatform() : 'ios';
  var read = function () { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  var save = function (v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };
  var toast = function (m) { if (window.SV && SV.toast) SV.toast(m); };
  var track = function (name, data) { if (window.SV && SV.track) SV.track(name, data); };
  var state = read() || {};

  function send(token, level) {
    return fetch('/api/push/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, platform: platform, level: level }) })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  }
  P.addListener('registration', function (t) {
    state.token = t.value; save(state);
    if (state.level && state.level !== 'off') send(t.value, state.level).then(function (r) { if (state.fresh) { state.fresh = false; save(state); toast(r.ok ? 'Alerts are on for this phone.' : 'Could not turn alerts on. Please try again.'); } });
  });
  P.addListener('registrationError', function () { if (state.fresh) { state.fresh = false; save(state); toast('Could not turn alerts on. Please try again.'); } });
  P.addListener('pushNotificationActionPerformed', function (a) {
    var u = a && a.notification && a.notification.data && a.notification.data.url;
    if (u && u.indexOf('https://squamishvoters.com/') === 0) { track('Alert opened', {}); location.href = u; }
  });

  function choose(level) {
    close();
    if (level === 'later') { state.asked = Date.now(); save(state); return; }
    if (level === 'off') {
      var old = state.token; state.level = 'off'; state.asked = Date.now(); save(state);
      if (old) send(old, 'off'); toast('Alerts are off.'); track('Alerts', { level: 'off' }); return;
    }
    P.requestPermissions().then(function (p) {
      if (p.receive !== 'granted') { state.asked = Date.now(); save(state); toast('Alerts are blocked. Turn them on in your phone’s Settings.'); return; }
      state.level = level; state.asked = Date.now(); state.fresh = true; save(state); track('Alerts', { level: level });
      P.register();
    });
  }

  var sheet;
  function close() { if (sheet) { sheet.remove(); sheet = null; } }
  function open() {
    close();
    sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Phone alerts');
    sheet.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:80;background:rgba(20,33,28,.45);top:0;display:flex;align-items:flex-end';
    var on = state.level === 'big' || state.level === 'all';
    var btn = function (level, label, primary) { return '<button type="button" class="btn block' + (primary ? '' : ' secondary') + '" data-level="' + level + '" style="margin-top:.6rem">' + label + '</button>'; };
    sheet.innerHTML = '<div style="background:var(--surface);color:var(--ink);width:100%;border-radius:18px 18px 0 0;padding:1.25rem 1.1rem calc(1.25rem + env(safe-area-inset-bottom));box-shadow:0 -6px 24px rgba(0,0,0,.2)">' +
      '<h2 style="margin:0 0 .35rem;font-size:1.35rem">Get Squamish alerts on this phone</h2>' +
      '<p style="margin:0 0 .5rem;color:var(--ink-2)">Floods, road closures and big council news, the moment we publish. No account needed. Change it any time from the Menu.</p>' +
      btn('big', 'Big news only' + (state.level === 'big' ? ' (on now)' : ''), true) +
      btn('all', 'Every new story' + (state.level === 'all' ? ' (on now)' : ''), false) +
      btn(on ? 'off' : 'later', on ? 'Turn alerts off' : 'Not now', false) + '</div>';
    sheet.addEventListener('click', function (e) {
      var b = e.target.closest('[data-level]');
      if (b) choose(b.getAttribute('data-level')); else if (e.target === sheet) choose('later');
    });
    document.body.appendChild(sheet);
  }

  // A way back in: "Phone alerts" in the Menu.
  var menu = document.getElementById('menu-panel');
  if (menu) {
    var a = document.createElement('a'); a.href = '#'; a.innerHTML = '<span>Phone alerts</span>';
    a.addEventListener('click', function (e) { e.preventDefault(); open(); });
    (menu.querySelector('nav') || menu).appendChild(a);
  }

  if (state.level === 'big' || state.level === 'all') {
    // Already on: refresh the token quietly each visit (phones change it now and then).
    P.checkPermissions().then(function (p) { if (p.receive === 'granted') P.register(); });
  } else if (!state.asked || (state.level !== 'off' && Date.now() - state.asked > 14 * 864e5)) {
    // Never asked, or said "Not now" more than two weeks ago: offer once, a moment after the page settles.
    setTimeout(open, 2500);
  }
})();
