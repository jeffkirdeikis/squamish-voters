// Squamish today: fills the /today/ cards and the one line strip on the home page from /api/today/.
(function () {
  var strip = document.querySelector('[data-today-strip]');
  var page = document.querySelector('.td');
  if ((!strip && !page) || !window.fetch) return;

  var TZ = 'America/Vancouver';
  var e = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var time = function (iso) { return iso ? new Date(iso).toLocaleTimeString('en-CA', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(/\s?a\.m\./, ' a.m.').replace(/\s?p\.m\./, ' p.m.') : ''; };
  var hour = function (iso) { return new Date(iso).toLocaleTimeString('en-CA', { timeZone: TZ, hour: 'numeric' }).replace(/\s?a\.m\./, 'am').replace(/\s?p\.m\./, 'pm'); };
  // Open-Meteo's local times have no zone ("2026-10-27T14:00"); read the hour straight off the text.
  var hourLocal = function (t) { var h = +t.slice(11, 13); return (h % 12 || 12) + (h < 12 ? 'am' : 'pm'); };
  var compass = function (deg) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8]; };
  var arrow = function (deg) { return '<span class="td-arrow" style="transform:rotate(' + (deg + 180) + 'deg)" aria-hidden="true">↑</span>'; };
  var deg = function (t) { return t == null ? '' : Math.round(t) + '°'; };
  var HWY = { clear: ['Clear', 'ok'], delays: ['Incidents', 'warn'], closed: ['Closed', 'bad'] };
  var KITE = 15; // knots: roughly where kiting at the Spit starts

  function stripText(d) {
    var bits = [];
    if (d.weather && d.weather.temp != null) bits.push(deg(d.weather.temp) + ' ' + e(d.weather.cond));
    if (d.highway) bits.push('Highway 99 ' + HWY[d.highway.status][0].toLowerCase());
    if (d.wind) bits.push('Spit ' + d.wind.kn + ' knots');
    if (d.air) bits.push('Air ' + e(d.air.risk.toLowerCase()));
    return bits.map(function (b) { return '<span>' + b + '</span>'; }).join('<i aria-hidden="true">·</i> ');
  }

  function weather(w) {
    var hrs = w.hourly.slice(0, 8).map(function (h) {
      return '<li><span>' + hour(h.t) + '</span>' + (h.icon != null ? '<img src="https://weather.gc.ca/weathericons/' + (+h.icon < 10 ? '0' : '') + h.icon + '.gif" alt="" width="30" height="30" loading="lazy">' : '') + '<b>' + deg(h.temp) + '</b><small>' + (h.pop ? h.pop + '%' : '&nbsp;') + '</small></li>';
    }).join('');
    return '<div class="td-now"><b class="td-big">' + deg(w.temp) + '</b><div><p class="td-cond">' + e(w.cond) + '</p><p class="small muted">Wind: ' + e(w.wind || 'n/a') + '</p></div></div>'
      + (hrs ? '<ul class="td-hours" aria-label="Next hours (chance of rain or snow underneath)">' + hrs + '</ul>' : '')
      + '<dl class="td-periods">' + w.periods.slice(0, 3).map(function (p) { return '<dt>' + e(p.name) + '</dt><dd>' + e(p.text) + '</dd>'; }).join('') + '</dl>'
      + (w.sunrise ? '<p class="small muted">Sunrise ' + time(w.sunrise) + ' · Sunset ' + time(w.sunset) + '</p>' : '');
  }

  function highway(h) {
    var s = HWY[h.status];
    var list = h.events.slice(0, 6).map(function (ev) {
      var kind = ev.type === 'INCIDENT' ? 'Incident' : ev.severity === 'MAJOR' ? 'Major roadwork' : 'Roadwork';
      return '<li class="' + (ev.type === 'INCIDENT' || ev.severity === 'MAJOR' ? 'hot' : '') + '"><b>' + kind + '</b> ' + e(ev.text) + '</li>';
    }).join('');
    return '<p class="td-pill ' + s[1] + '">' + s[0] + '</p>'
      + (h.status === 'clear' ? '<p>No crashes, closures or major roadwork between Horseshoe Bay and Whistler right now.</p>' : '')
      + (list ? '<ul class="td-events">' + list + '</ul>' : '<p class="small muted">Nothing else reported.</p>')
      + (h.events.length > 6 ? '<p class="small"><a href="' + e(h.link) + '" target="_blank" rel="noopener">' + (h.events.length - 6) + ' more on DriveBC →</a></p>' : '');
  }

  function wind(w) {
    var max = Math.max(25, Math.max.apply(null, w.hours.map(function (x) { return x.gust; })));
    var bars = w.hours.map(function (x) {
      return '<li title="' + hourLocal(x.t) + ': ' + x.kn + ' knots, gusts ' + x.gust + ', from the ' + compass(x.dir) + '"><span class="td-bar"><i class="g" style="height:' + (x.gust / max * 100) + '%"></i><i class="a' + (x.kn >= KITE ? ' kite' : '') + '" style="height:' + (x.kn / max * 100) + '%"></i></span><b>' + x.kn + '</b>' + arrow(x.dir) + '<small>' + hourLocal(x.t).replace('m', '') + '</small></li>';
    }).join('');
    var good = w.hours.filter(function (x) { return x.kn >= KITE; });
    return '<div class="td-now"><b class="td-big">' + w.kn + '<small> knots</small></b><div><p class="td-cond">' + arrow(w.dir) + ' From the ' + compass(w.dir) + ', gusts ' + w.gust + '</p><p class="small muted">About ' + Math.round(w.kn * 1.852) + ' km/h now</p></div></div>'
      + (bars ? '<p class="td-sub">' + (w.tomorrow ? 'Tomorrow' : 'Today') + ', 8 a.m. to 8 p.m.</p><ul class="td-bars">' + bars + '</ul>'
        + '<p class="small">' + (good.length ? '<span class="td-kite"></span>' + good.length + ' hour' + (good.length === 1 ? '' : 's') + ' at ' + KITE + ' knots or more, best around ' + hourLocal(w.best.t) + ' (' + w.best.kn + ' knots).' : 'No hours at ' + KITE + ' knots or more, the usual minimum for kiting.') + ' Light bars are gusts.</p>' : '')
      + '<p><a class="btn secondary td-live" href="' + e(w.live) + '" target="_blank" rel="noopener">Live wind readings at the Spit →</a></p>';
  }

  function river(r) {
    var dir = Math.abs(r.change) < 0.05 ? 'Steady' : r.change > 0 ? 'Rising' : 'Falling';
    return '<div class="td-now"><b class="td-big">' + r.level.toFixed(2) + '<small> m</small></b><div><p class="td-cond">' + dir + (dir === 'Steady' ? '' : ', ' + (r.change > 0 ? 'up ' : 'down ') + Math.abs(r.change).toFixed(2) + ' m') + ' in the last 24 hours</p><p class="small muted">Flow ' + Math.round(r.flow) + ' cubic metres a second · read at ' + time(r.at) + '</p></div></div>';
  }

  function air(a) {
    var lvl = a.aqhi <= 3 ? 'ok' : a.aqhi <= 6 ? 'warn' : 'bad';
    return '<div class="td-now"><b class="td-big td-aq ' + lvl + '">' + a.aqhi + '</b><div><p class="td-cond">' + e(a.risk) + ' health risk</p><p class="small muted">Air Quality Health Index, 1 to 10+ · read at ' + time(a.at) + '</p></div></div>'
      + (a.note ? '<p>' + e(a.note) + '</p>' : '');
  }

  function avalanche(v) {
    if (!v.ratings.length) return '<p>' + e(v.note || 'No forecast right now.') + '</p><p class="small"><a href="' + e(v.link) + '" target="_blank" rel="noopener">Full forecast →</a></p>';
    if (v.ratings.every(function (r) { return r.value === 'earlyseason'; })) return '<p class="td-pill">Early season</p><p>Daily danger ratings start once there is enough snow. Avalanches can still happen wherever snow has built up, so carry a transceiver, shovel and probe.</p><p class="small"><a href="' + e(v.link) + '" target="_blank" rel="noopener">Avalanche Canada’s full forecast →</a></p>';
    return '<ul class="td-av">' + v.ratings.map(function (r) { return '<li data-r="' + e(r.value) + '"><span>' + e(r.zone) + '</span><b>' + e(r.label) + '</b></li>'; }).join('') + '</ul><p class="small muted">' + e(v.day) + '</p><p class="small"><a href="' + e(v.link) + '" target="_blank" rel="noopener">Full forecast and problems →</a></p>';
  }

  var FILL = { weather: weather, highway: highway, wind: wind, river: river, air: air, avalanche: avalanche };

  function fail(el) { el.innerHTML = '<p class="td-wait">Couldn’t load this right now. Use the source link below.</p>'; }

  fetch('/api/today/').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    if (strip) {
      var t = stripText(d);
      if (t) { strip.querySelector('[data-ts]').innerHTML = t; strip.hidden = false; }
    }
    if (!page) return;
    Object.keys(FILL).forEach(function (k) {
      var el = page.querySelector('[data-td="' + k + '"] [data-body]');
      if (!el) return;
      try { if (d[k]) el.innerHTML = FILL[k](d[k]); else fail(el); } catch (err) { fail(el); }
    });
    var at = page.querySelector('[data-td-at]');
    if (at) at.textContent = 'Checked at ' + time(d.at);
    var warn = (d.weather && d.weather.warnings) || [];
    var box = page.querySelector('[data-td-alerts]');
    if (box && warn.length) {
      box.innerHTML = warn.map(function (w) { return '<p><b>' + e(w.type || 'Weather alert') + '</b> ' + e(w.text) + ' <a href="' + e(d.weather.link) + '" target="_blank" rel="noopener">Details →</a></p>'; }).join('');
      box.hidden = false;
    }
  }).catch(function () {
    if (page) page.querySelectorAll('[data-body]').forEach(fail);
  });
})();
