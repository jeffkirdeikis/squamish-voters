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

  // Home page strip: one short value per cell, a coloured dot where there's a status.
  var SVG = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var WXI = {
    sun: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
    moon: SVG('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
    cloud: SVG('<path d="M7 18a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 11 3.5 3.5 0 0 1 18 18z"/>'),
    rain: SVG('<path d="M7 14a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 7 3.5 3.5 0 0 1 18 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>'),
    snow: SVG('<path d="M7 14a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 7 3.5 3.5 0 0 1 18 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 22h.01M14 22h.01"/>'),
    fog: SVG('<path d="M4 9h16M2 13h20M5 17h14M8 21h8"/>'),
    storm: SVG('<path d="M7 14a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 7 3.5 3.5 0 0 1 18 14z"/><path d="M12 13l-2 4h4l-2 4"/>'),
  };
  var wxKind = function (c, night) {
    c = String(c || '').toLowerCase();
    return /thunder/.test(c) ? 'storm' : /snow|flurr|ice pellet/.test(c) ? 'snow' : /rain|shower|drizzle/.test(c) ? 'rain' : /fog|mist|haze|smoke/.test(c) ? 'fog'
      : /clear|sunny/.test(c) && !/cloud/.test(c) ? (night ? 'moon' : 'sun') : /mainly sunny|mix of sun|partly/.test(c) ? (night ? 'moon' : 'sun') : 'cloud';
  };
  var dot = function (lvl) { return '<i class="ts-d ' + lvl + '" aria-hidden="true"></i>'; };

  function fillStrip(d) {
    var set = function (k, html, label) {
      var c = strip.querySelector('[data-k="' + k + '"]');
      if (!c) return;
      if (html == null) { c.hidden = true; return; }
      c.querySelector('b').innerHTML = html;
      if (label) c.querySelector('small').textContent = label;
    };
    var w = d.weather, now = Date.now();
    var night = !!(w && w.sunrise && w.sunset && (now < Date.parse(w.sunrise) || now > Date.parse(w.sunset)));
    if (w && w.temp != null) {
      strip.querySelector('[data-k="weather"] .ts-i').innerHTML = WXI[wxKind(w.cond, night)];
      var today = (d.days || [])[0], todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
      set('weather', deg(w.temp) + ' <span>' + e(w.cond) + '</span>', today && today.date === todayStr && !night ? 'Now · high ' + today.hi + '°' : 'Weather now');
    } else set('weather', null);
    set('highway', d.highway ? dot(HWY[d.highway.status][1]) + HWY[d.highway.status][0] : null);
    var t = d.tide && d.tide.next && d.tide.next[0];
    set('tide', t ? (t.high ? 'High' : 'Low') + ' <span>' + time(t.t) + '</span>' : null, d.tide && (d.tide.rising ? 'Tide coming in' : 'Tide going out'));
    set('wind', d.wind ? d.wind.kn + ' knots <span>' + compass(d.wind.dir) + '</span>' : null, 'Spit wind');
    var rb = d.river && d.river.band;
    set('river', rb ? dot({ 'very low': 'info', low: 'info', normal: 'ok', high: 'warn', 'very high': 'bad' }[rb]) + rb.charAt(0).toUpperCase() + rb.slice(1) : null, 'River');
    set('air', d.air ? dot(d.air.aqhi <= 3 ? 'ok' : d.air.aqhi <= 6 ? 'warn' : 'bad') + e(d.air.risk) + ' risk' : null, 'Air');
    if (w && w.sunset) {
      var before = !night;
      set('sun', time(before ? w.sunset : w.sunrise), before ? 'Sunset' : 'Sunrise');
    } else set('sun', null);
    strip.classList.add('ts-ready');
    fit();
    more();
  }

  // Desktop shows the row without scrolling: drop cells from least to most important until it fits.
  var DROP = ['sun', 'air', 'river', 'wind'];
  function fit() {
    var row = strip.querySelector('.ts-row');
    DROP.forEach(function (k) { var c = strip.querySelector('[data-k="' + k + '"]'); if (c) c.removeAttribute('data-fit-off'); });
    if (window.innerWidth < 900) return;
    for (var i = 0; i < DROP.length && row.scrollWidth > row.clientWidth + 1; i++) {
      var c = strip.querySelector('[data-k="' + DROP[i] + '"]');
      if (c) c.setAttribute('data-fit-off', '');
    }
  }
  if (strip) window.addEventListener('resize', function () { if (strip.classList.contains('ts-ready')) fit(); });
  // Phones: show the swipe arrow while more cells are hidden off to the right.
  function more() {
    var row = strip.querySelector('.ts-row');
    strip.classList.toggle('ts-more', !strip.hidden && window.innerWidth < 900 && row.scrollLeft + row.clientWidth < row.scrollWidth - 8);
  }
  if (strip) {
    var tsRow = strip.querySelector('.ts-row');
    tsRow.addEventListener('scroll', more, { passive: true });
    window.addEventListener('resize', more);
    setTimeout(more, 0); // before data arrives the placeholders already overflow
  }

  // Open-Meteo weather codes (WMO) in plain words.
  var WX = function (c) {
    return c === 0 ? ['☀️', 'Sunny'] : c <= 2 ? ['🌤️', 'Mostly sunny'] : c === 3 ? ['☁️', 'Cloudy'] : c <= 48 ? ['🌫️', 'Fog']
      : c <= 57 ? ['🌦️', 'Drizzle'] : c <= 65 ? [c >= 65 ? '🌧️' : '🌦️', c >= 65 ? 'Heavy rain' : c >= 63 ? 'Rain' : 'Light rain'] : c <= 67 ? ['🌧️', 'Freezing rain']
      : c <= 77 ? ['🌨️', 'Snow'] : c <= 82 ? ['🌧️', 'Showers'] : c <= 86 ? ['🌨️', 'Snow showers'] : ['⛈️', 'Thunderstorms'];
  };
  var SHOW = 3;
  function daysList(days) {
    if (!days || !days.length) return '';
    var now = new Date(), todayStr = now.toLocaleDateString('en-CA', { timeZone: TZ });
    var evening = +now.toLocaleTimeString('en-CA', { timeZone: TZ, hour: 'numeric', hour12: false }) >= 18;
    // After 6 p.m. today's high is already behind us, so the list starts tomorrow.
    days = days.filter(function (d) { return !(evening && d.date === todayStr); }).slice(0, 14);
    var lo = Math.min.apply(null, days.map(function (d) { return d.lo; })), hi = Math.max.apply(null, days.map(function (d) { return d.hi; })), span = Math.max(1, hi - lo);
    var rows = days.map(function (d, i) {
      var dt = new Date(d.date + 'T12:00:00'), w = WX(d.code);
      var name = d.date === todayStr ? 'Today' : i === 0 || (i === 1 && days[0].date === todayStr) ? 'Tomorrow' : dt.toLocaleDateString('en-CA', { weekday: 'short' });
      var wet = d.snow >= 1 ? d.snow + ' cm snow' : d.rain >= 1 ? d.rain + ' mm' : d.pop >= 30 ? d.pop + '%' : '';
      return '<li' + (i >= SHOW ? ' class="td-more" hidden' : '') + '><span class="td-dn"><b>' + name + '</b><small>' + dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + '</small></span>'
        + '<span class="td-dw" title="' + w[1] + '"><span aria-hidden="true">' + w[0] + '</span><small>' + w[1] + '</small></span>'
        + '<span class="td-dr">' + e(wet) + '</span>'
        + '<span class="td-dt"><small>' + d.lo + '°</small><i class="td-range"><i style="left:' + ((d.lo - lo) / span * 100) + '%;right:' + ((hi - d.hi) / span * 100) + '%"></i></i><b>' + d.hi + '°</b></span></li>';
    }).join('');
    return '<h3 class="td-sub">Next ' + days.length + ' days</h3><ul class="td-days">' + rows + '</ul>'
      + (days.length > SHOW ? '<button type="button" class="td-expand" data-td-expand aria-expanded="false">Show ' + (days.length - SHOW) + ' more days ▾</button>' : '');
  }

  function weather(w) {
    var hrs = w.hourly.slice(0, 8).map(function (h) {
      return '<li><span>' + hour(h.t) + '</span>' + (h.icon != null ? '<img src="https://weather.gc.ca/weathericons/' + (+h.icon < 10 ? '0' : '') + h.icon + '.gif" alt="" width="30" height="30" loading="lazy">' : '') + '<b>' + deg(h.temp) + '</b><small>' + (h.pop ? h.pop + '%' : '&nbsp;') + '</small></li>';
    }).join('');
    return '<div class="td-now"><b class="td-big">' + deg(w.temp) + '</b><div><p class="td-cond">' + e(w.cond) + '</p><p class="small muted">Wind: ' + e(w.wind || 'n/a') + '</p></div></div>'
      + (hrs ? '<ul class="td-hours" aria-label="Next hours (chance of rain or snow underneath)">' + hrs + '</ul>' : '')
      + (w.periods[0] ? '<p class="td-period"><b>' + e(w.periods[0].name) + ':</b> ' + e(w.periods[0].text) + '</p>' : '')
      + daysList(D.days)
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
    var dir = Math.abs(r.change) < 0.05 ? 'steady' : r.change > 0 ? 'rising' : 'falling';
    var month = new Date().toLocaleDateString('en-CA', { timeZone: TZ, month: 'long' });
    var part = +new Date().toLocaleDateString('en-CA', { timeZone: TZ, day: 'numeric' }) <= 10 ? 'early ' : +new Date().toLocaleDateString('en-CA', { timeZone: TZ, day: 'numeric' }) <= 20 ? 'mid ' : 'late ';
    var cls = { 'very low': 'low', low: 'low', normal: 'ok', high: 'warn', 'very high': 'bad' }[r.band];
    // Log scale from 10 to the record, so a normal day and the 2003 flood both fit on one line.
    var pos = function (q) { return Math.max(0, Math.min(100, Math.log(q / 10) / Math.log(r.record.flow / 10) * 100)); };
    var ratio = r.flow / r.usual, k = Math.round(1 / ratio);
    var how = ratio > 1.15 ? (ratio >= 2 ? 'about ' + Math.round(ratio) + ' times' : 'about ' + Math.round(ratio * 100) + '% of')
      : ratio >= 0.85 ? 'right around' : ratio > 0.6 ? 'about ' + Math.round(ratio * 100) + '% of' : 'about ' + (['', '', 'half', 'a third', 'a quarter', 'a fifth'][k] || 'a tenth') + ' of';
    return '<p class="td-pill ' + cls + '">' + r.band.charAt(0).toUpperCase() + r.band.slice(1) + ' for ' + part + month + '</p>'
      + '<div class="td-now"><b class="td-big">' + Math.round(r.flow) + '</b><div><p class="td-cond">cubic metres of water a second</p><p class="small muted">That’s ' + how + ' the usual ' + r.usual + ' for this time of year, and ' + dir + ' today.</p></div></div>'
      + '<div class="td-gauge" aria-hidden="true"><i class="td-gn" style="left:' + pos(r.range[0]) + '%;right:' + (100 - pos(r.range[1])) + '%"></i><i class="td-gm" style="left:' + pos(r.flow) + '%"></i></div>'
      + '<p class="td-gl small muted"><span>Trickle</span><span>2003 flood</span></p>'
      + '<p class="td-gk small muted"><span><i class="m"></i>Now</span><span><i class="n"></i>Normal range for this week</span></p>'
      + '<p class="small">Most years this week it runs between ' + r.range[0] + ' and ' + r.range[1] + '. The record is ' + r.record.flow.toLocaleString('en-CA') + ' in the October 2003 flood, about ' + Math.round(r.record.flow / r.usual) + ' times normal. Based on daily readings since ' + r.since + '.</p>'
      + '<p class="small muted">Water level at the gauge: ' + r.level.toFixed(2) + ' m · read at ' + time(r.at) + '</p>';
  }

  function tide(t) {
    if (!t.next.length) return '<p>No tide times right now.</p>';
    var n = t.next[0];
    return '<div class="td-now"><b class="td-big td-tarrow">' + (t.rising ? '↑' : '↓') + '</b><div><p class="td-cond">' + (t.rising ? 'Coming in' : 'Going out') + '</p><p class="small muted">' + (n.high ? 'High' : 'Low') + ' tide at ' + time(n.t) + ', ' + n.m + ' m</p></div></div>'
      + '<ul class="td-tides">' + t.next.map(function (x) {
        var day = new Date(x.t).toLocaleDateString('en-CA', { timeZone: TZ }) === new Date().toLocaleDateString('en-CA', { timeZone: TZ }) ? '' : new Date(x.t).toLocaleDateString('en-CA', { timeZone: TZ, weekday: 'short' }) + ' ';
        return '<li class="' + (x.high ? 'hi' : 'lo') + '"><b>' + (x.high ? 'High' : 'Low') + '</b><span>' + day + time(x.t) + '</span><span>' + x.m + ' m</span></li>';
      }).join('') + '</ul>';
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

  // "Is the rock dry?": a rough guide from recent rain at the Chief, never a promise.
  function rock(r) {
    var V = { dry: ['Probably dry', 'ok', 'No real rain at the Chief in the last two days.'], drying: ['Drying, maybe damp', 'warn', 'It rained in the last two days but has been dry for ' + r.dryHours + ' hours. Sunny faces may be fine; shady and seepy spots may still be wet.'], wet: ['Probably wet', 'bad', 'It is raining now or rained recently. Give it a dry day or two.'] }[r.verdict];
    return '<p class="td-pill ' + V[1] + '">' + V[0] + '</p><p>' + e(V[2]) + '</p>'
      + '<p class="small">Rain at the Chief: <b>' + r.rain24 + ' mm</b> in the last 24 hours, <b>' + r.rain48 + ' mm</b> in the last 48. ' + (r.next12 >= 0.5 ? 'About ' + r.next12 + ' mm more expected in the next 12 hours.' : 'Little or no rain expected in the next 12 hours.') + '</p>'
      + '<p class="small muted"><b>Rough guide only.</b> Worked out from rainfall, not from the rock itself. Granite can seep for days after heavy rain, and forest crags stay wet longer. Look before you climb.</p>';
  }

  var FILL = { weather: weather, highway: highway, wind: wind, tide: tide, rock: rock, river: river, air: air, avalanche: avalanche };

  function fail(el) { el.innerHTML = '<p class="td-wait">Couldn’t load this right now. Use the source link below.</p>'; }

  var D = {};
  fetch('/api/today/').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    D = d;
    if (strip) fillStrip(d);
    if (!page) return;
    Object.keys(FILL).forEach(function (k) {
      var el = page.querySelector('[data-td="' + k + '"] [data-body]');
      if (!el) return;
      try { if (d[k]) el.innerHTML = FILL[k](d[k]); else fail(el); } catch (err) { fail(el); }
    });
    var more = page.querySelector('[data-td-expand]');
    if (more) more.addEventListener('click', function () {
      var open = more.getAttribute('aria-expanded') !== 'true';
      page.querySelectorAll('.td-days .td-more').forEach(function (li) { li.hidden = !open; });
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      more.textContent = open ? 'Show fewer days ▴' : 'Show ' + page.querySelectorAll('.td-days .td-more').length + ' more days ▾';
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
    if (strip) strip.hidden = true;
    if (page) page.querySelectorAll('[data-body]').forEach(fail);
  });

  // Category buttons: on phones the cards scroll sideways and a button slides to its card; on wider screens the
  // cards are a grid and a button scrolls down to it. Either way the button for the card in view lights up.
  var grid = page && page.querySelector('.td-grid'), bar = page && page.querySelector('.td-chips');
  if (grid && bar) {
    var chips = [].slice.call(bar.querySelectorAll('[data-tdc]')), cards = [].slice.call(grid.querySelectorAll('[data-td]'));
    var pos = page.querySelector('[data-td-pos]');
    var sideways = function () { return getComputedStyle(grid).overflowX !== 'visible'; };
    var mark = function (k) {
      chips.forEach(function (a) {
        var on = a.getAttribute('data-tdc') === k;
        a.classList.toggle('on', on);
        if (on) { a.setAttribute('aria-current', 'true'); bar.scrollTo({ left: a.offsetLeft - (bar.clientWidth - a.offsetWidth) / 2, behavior: 'smooth' }); } else a.removeAttribute('aria-current');
      });
      var i = cards.findIndex(function (c) { return c.getAttribute('data-td') === k; });
      if (pos && i >= 0) pos.textContent = (i + 1) + ' of ' + cards.length;
    };
    var lock = 0; // after a tap, the tapped button stays lit while the page scrolls to it
    var go = function (k, smooth) {
      lock = Date.now() + 1200;
      var c = grid.querySelector('[data-td="' + k + '"]'); if (!c) return;
      var how = smooth ? 'smooth' : 'auto';
      if (sideways()) {
        grid.scrollTo({ left: c.offsetLeft - (grid.clientWidth - c.offsetWidth) / 2, behavior: how });
        var top = bar.getBoundingClientRect().top;
        if (top < 0 || top > innerHeight * 0.6) bar.scrollIntoView({ behavior: how, block: 'start' });
      } else c.scrollIntoView({ behavior: how, block: 'start' });
      mark(k);
    };
    chips.forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        var k = a.getAttribute('data-tdc');
        go(k, true);
        if (history.replaceState) history.replaceState(null, '', '#t-' + k);
      });
    });
    // Phones: whichever card is nearest the middle after a swipe.
    var t;
    grid.addEventListener('scroll', function () {
      if (!sideways()) return;
      clearTimeout(t);
      t = setTimeout(function () {
        var mid = grid.scrollLeft + grid.clientWidth / 2, best = cards[0], d = Infinity;
        cards.forEach(function (c) { var x = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (x < d) { d = x; best = c; } });
        mark(best.getAttribute('data-td'));
      }, 80);
    }, { passive: true });
    // Wider screens: whichever card is near the top of the screen.
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        if (sideways() || Date.now() < lock) return;
        es.forEach(function (x) { if (x.isIntersecting) mark(x.target.getAttribute('data-td')); });
      }, { rootMargin: '-30% 0px -60% 0px' });
      cards.forEach(function (c) { io.observe(c); });
    }
    var h = (location.hash.match(/^#t-(\w+)$/) || [])[1];
    if (h) setTimeout(function () { go(h, false); }, 50);
  }
})();
