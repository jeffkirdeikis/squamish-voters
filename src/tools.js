// Interactive story pieces drawn by build.mjs: the address zoning check ([data-zonecheck]), the slope slider ([data-slope]),
// "who voted most like you" ([data-match], fed by poll.js 'sv:poll' events), the talk time toggle ([data-talk-toggle])
// and tap-for-detail charts ([data-chart]). Each piece works on its own and leaves the static page readable if this fails.
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(n, d) { if (window.SV && SV.track) try { SV.track(n, d || {}); } catch (e) {} }
  function cfg(el, k) { try { return JSON.parse(el.getAttribute(k)); } catch (e) { return {}; } }
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- Address -> zone (District of Squamish open data, ArcGIS) ----------
  var GIS = 'https://services.arcgis.com/YCM10gnCAvCoAhpj/arcgis/rest/services/';
  function q(layer, params) {
    var u = GIS + layer + '/query?f=json&' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(u).then(function (r) { return r.json(); });
  }
  [].forEach.call(document.querySelectorAll('[data-zonecheck]'), function (box) {
    var c = cfg(box, 'data-zonecheck'), inp = box.querySelector('[data-zone-in]'), list = box.querySelector('[data-zone-list]'), out = box.querySelector('[data-zone-out]');
    var t, seq = 0;
    function search() {
      var s = inp.value.trim().toUpperCase().replace(/'/g, ''), my = ++seq;
      if (s.length < 3) { list.hidden = true; return; }
      var parts = s.match(/^(\d+)\s*(.*)$/), where = parts ? "STREET_NUMBER = '" + parts[1] + "'" + (parts[2] ? " AND UPPER(STREET_NAME) LIKE '" + parts[2] + "%'" : '') : "UPPER(STREET_NAME) LIKE '" + s + "%'";
      q('Addressing/FeatureServer/0', { where: where, outFields: 'FULL_ADDRESS,LATITUDE,LONGITUDE', returnGeometry: 'false', resultRecordCount: 8, orderByFields: 'FULL_ADDRESS' }).then(function (j) {
        if (my !== seq) return;
        var seen = {}, rows = (j.features || []).map(function (f) { return f.attributes; }).filter(function (a) { var k = a.FULL_ADDRESS.replace(/^[^,]*,\s*/, ''); if (seen[k]) return false; seen[k] = 1; return true; });
        list.innerHTML = rows.length ? rows.map(function (a, i) { return '<li><button type="button" data-i="' + i + '">' + esc(a.FULL_ADDRESS.replace(/^[^,]*,\s*/, '')) + '</button></li>'; }).join('') : '<li class="small muted">No Squamish address found. Try the house number and street, like 37841 Cleveland.</li>';
        list.hidden = false;
        [].forEach.call(list.querySelectorAll('button'), function (b) { b.addEventListener('click', function () { pick(rows[+b.getAttribute('data-i')]); }); });
      }).catch(function () { list.innerHTML = '<li class="small muted">Couldn’t reach the District’s map just now. Try again in a minute.</li>'; list.hidden = false; });
    }
    function pick(a) {
      list.hidden = true; inp.value = a.FULL_ADDRESS.replace(/^[^,]*,\s*/, '');
      var x = parseFloat(a.LATITUDE), y = parseFloat(a.LONGITUDE);
      if (x > 0) { var tmp = x; x = y; y = tmp; } // the District's file has the two columns swapped; longitude is the negative one
      out.innerHTML = '<p class="small muted">Checking the zoning map…</p>';
      q('Zoning/FeatureServer/31', { geometry: x + ',' + y, geometryType: 'esriGeometryPoint', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', outFields: 'ZONE_CODE,ZONE_DES', returnGeometry: 'false' }).then(function (j) {
        var z = (j.features || [])[0], code = z ? z.attributes.ZONE_CODE : '';
        var yes = (c.zones || []).indexOf(code) >= 0;
        out.innerHTML = !z ? '<p>We couldn’t find a zone for that address on the District’s map.</p>' :
          '<div class="tl-zone-res ' + (yes ? 'yes' : 'no') + '"><b>' + esc(yes ? c.yes_head : c.no_head) + '</b><p>Your zone: <b>' + esc(code) + '</b> (' + esc(z.attributes.ZONE_DES || '') + '). ' + esc(yes ? c.yes : c.no) + '</p></div>';
        track('Zone check', { zone: code, yes: yes });
      }).catch(function () { out.innerHTML = '<p>Couldn’t reach the District’s map just now. Try again in a minute.</p>'; });
    }
    inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(search, 250); });
  });

  // ---------- Slope slider ----------
  [].forEach.call(document.querySelectorAll('[data-slope]'), function (fig) {
    var c = cfg(fig, 'data-slope'), svg = fig.querySelector('[data-slope-svg]'), inp = fig.querySelector('[data-slope-in]'), v = fig.querySelector('[data-slope-v]'), deg = fig.querySelector('[data-slope-deg]'), out = fig.querySelector('[data-slope-out]');
    var marks = c.marks || [];
    function draw() {
      var p = +inp.value, rise = Math.min(200, 400 * p / 100), x0 = 80, x1 = 480, yb = 230;
      v.textContent = p + '%'; deg.textContent = '(' + Math.round(Math.atan(p / 100) * 180 / Math.PI) + '°, a ' + Math.round(p) + ' m rise every 100 m)';
      var hit = marks.filter(function (m) { return p >= m.at; }).pop();
      var col = hit ? (hit.tone === 'red' ? '#b3261e' : hit.tone === 'amber' ? '#c0702a' : '#0f4c3a') : '#0f4c3a';
      var hx = x0 + 150, hy = yb - rise * 150 / 400;
      svg.innerHTML = '<rect x="0" y="0" width="600" height="260" fill="#eaf2ee"/>' +
        '<polygon points="' + x0 + ',' + yb + ' ' + x1 + ',' + (yb - rise) + ' ' + x1 + ',' + yb + '" fill="' + col + '" opacity=".85"/>' +
        '<line x1="20" y1="' + yb + '" x2="580" y2="' + yb + '" stroke="#5d6661" stroke-width="2"/>' +
        '<g transform="translate(' + hx + ',' + hy + ') rotate(0)"><rect x="-16" y="-24" width="32" height="24" fill="#fff" stroke="#14211c" stroke-width="2"/><polygon points="-20,-24 0,-40 20,-24" fill="#f5b800" stroke="#14211c" stroke-width="2"/></g>' +
        '<text x="' + (x1 + 8) + '" y="' + (yb - rise / 2) + '" font-size="15" fill="#14211c">' + Math.round(rise / 4) + ' m</text>' +
        '<text x="' + ((x0 + x1) / 2) + '" y="' + (yb + 20) + '" font-size="15" fill="#14211c" text-anchor="middle">100 m</text>';
      out.innerHTML = '<ul class="tl-slope-rules">' + marks.map(function (m) { var on = p >= m.at; return '<li class="' + (on ? 'on' : '') + '"><b>' + m.at + '% and up</b> ' + esc(m.label) + '</li>'; }).join('') + '</ul>';
    }
    inp.addEventListener('input', draw); inp.addEventListener('change', function () { track('Slope slider', { v: inp.value }); });
    draw();
  });

  // ---------- Who voted most like you ----------
  [].forEach.call(document.querySelectorAll('[data-match]'), function (box) {
    var c = cfg(box, 'data-match'), out = box.querySelector('[data-match-out]'), mine = get('sv_match_' + location.pathname, {});
    function draw() {
      var done = c.rows.filter(function (r) { return mine[r.wid] === 'yes' || mine[r.wid] === 'no'; });
      if (!done.length) return;
      var res = c.people.map(function (p) {
        var same = 0, n = 0;
        done.forEach(function (r) { var v = r.votes[p.slug]; if (v === 'yes' || v === 'no') { n++; if (v === mine[r.wid]) same++; } });
        return { p: p, same: same, n: n };
      }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.same / b.n - a.same / a.n; });
      if (!res.length) return;
      var top = res[0], ties = res.filter(function (x) { return x.same / x.n === top.same / top.n; });
      out.innerHTML = '<p class="tl-match-head">' + (ties.length > 1 && ties.length === res.length ? 'You voted the same as <b>every member</b> on these.' : 'Closest to you: <b>' + ties.map(function (x) { return esc(x.p.name); }).join(', ') + '</b>, ' + top.same + ' of ' + top.n + ' the same.') + '</p>' +
        '<ul class="tl-match-list">' + res.map(function (x) { return '<li>' + (x.p.photo ? '<img src="' + esc(x.p.photo) + '" alt="" width="32" height="32" loading="lazy">' : '') + '<span>' + esc(x.p.name) + '</span><span class="tl-match-bar"><i style="width:' + Math.round(100 * x.same / x.n) + '%"></i></span><b>' + x.same + '/' + x.n + '</b></li>'; }).join('') + '</ul>' +
        (done.length < c.rows.length ? '<p class="small muted">Based on ' + done.length + ' of ' + c.rows.length + ' questions. Answer the rest for a fuller match.</p>' : '<p class="small muted">Based on your ' + done.length + ' answers and how each member voted tonight. Only “yes” and “no” answers count.</p>');
    }
    document.addEventListener('sv:poll', function (e) {
      var d = e.detail || {}; if (!c.rows.some(function (r) { return r.wid === d.wid; })) return;
      mine[d.wid] = d.choice; put('sv_match_' + location.pathname, mine); draw();
    });
    draw();
  });

  // ---------- Talk time toggle ----------
  [].forEach.call(document.querySelectorAll('[data-talk-toggle]'), function (box) {
    var bs = box.querySelectorAll('[data-v]');
    [].forEach.call(bs, function (b) { b.addEventListener('click', function () {
      [].forEach.call(bs, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      box.setAttribute('data-show', b.getAttribute('data-v')); track('Talk toggle', { v: b.getAttribute('data-v') });
    }); });
  });

  // ---------- Tap-for-detail charts ----------
  [].forEach.call(document.querySelectorAll('[data-chart]'), function (fig) {
    var tip = fig.querySelector('[data-tip-out]');
    [].forEach.call(fig.querySelectorAll('.tl-pt'), function (g) {
      function show() { [].forEach.call(fig.querySelectorAll('.tl-pt.on'), function (x) { x.classList.remove('on'); }); g.classList.add('on'); tip.textContent = g.getAttribute('data-tip'); }
      g.addEventListener('click', show); g.addEventListener('mouseenter', show); g.addEventListener('focus', show);
    });
  });
})();
