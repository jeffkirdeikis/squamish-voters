// Property tax calculator (/property-tax-calculator/). Rates come from build.mjs in data-taxcalc (District of Squamish
// 2026 tax rate table, Province of BC Home Owner Grant rules). The page's static table stays readable if this fails.
(function () {
  var box = document.querySelector('[data-taxcalc]');
  if (!box) return;
  var C; try { C = JSON.parse(box.getAttribute('data-taxcalc')); } catch (e) { return; }
  function $(s) { return box.querySelector(s); }
  function money(n) { return (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-CA'); }
  function num(s) { var n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
  function track(n, d) { if (window.SV && SV.track) try { SV.track(n, d || {}); } catch (e) {} }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var val = $('[data-tc-value]'), cls = $('[data-tc-class]'), grant = $('[data-tc-grant]'), tote = $('[data-tc-tote]'),
    rise = $('[data-tc-rise]'), riseOut = $('[data-tc-rise-out]'), out = $('[data-tc-out]'), out27 = $('[data-tc-out27]');

  // Saved on this device only, so a return visit opens on your own numbers.
  var saved = {}; try { saved = JSON.parse(get('sv_taxcalc') || '{}') || {}; } catch (e) {}
  if (saved.v) val.value = Number(saved.v).toLocaleString('en-CA');
  if (saved.c) cls.value = saved.c;
  if (saved.g) grant.value = saved.g;
  if (saved.t) tote.value = saved.t;

  // Home Owner Grant: full amount up to the threshold, then $5 less per $1,000 over it. The grant can't take the bill
  // below the minimum the Province requires ($350 regular, $100 additional).
  function hog(kind, value, gross, amt) {
    if (kind === 'none' || cls.value !== 'res') return 0;
    var g = kind === 'add' ? amt.add : amt.reg;
    if (value > C.hog.threshold) g -= (value - C.hog.threshold) / 1000 * C.hog.per1000;
    g = Math.max(0, g);
    var floor = kind === 'add' ? C.hog.minAdd : C.hog.minReg;
    return Math.max(0, Math.min(g, gross - floor));
  }
  // Extra provincial school tax on homes over $3 million: 0.2% of the part between $3M and $4M, 0.4% above $4M.
  // The Province raises these to 0.3% and 0.6% from 2027.
  function extraSchool(value, y27) {
    if (cls.value !== 'res' || value <= 3e6) return 0;
    var x = C.extraSchool[y27 ? 'y2027' : 'y2026'];
    return (Math.min(value, 4e6) - 3e6) * x[0] + Math.max(0, value - 4e6) * x[1];
  }

  function calc() {
    var v = num(val.value), r = C.rates[cls.value], gk = grant.value;
    box.classList.toggle('tc-biz', cls.value !== 'res');
    if (v < 10000) { out.innerHTML = '<p class="muted">Type your assessed value to see your bill.</p>'; out27.innerHTML = ''; return; }
    var parts = C.order.map(function (k) { return [C.names[k], v / 1000 * r[k]]; });
    var xs = extraSchool(v); if (xs) parts.push(['Extra school tax (homes over $3 million)', xs]);
    var gross = parts.reduce(function (s, p) { return s + p[1]; }, 0);
    var g = hog(gk, v, gross, C.hog.y2026), net = gross - g;
    var util = cls.value === 'res' && tote.value !== 'none' ? C.util.water + C.util.sewer + (C.util.tote[tote.value] || 0) : 0;
    var muni = v / 1000 * r.muni, avg = C.avg[cls.value];
    var rows = parts.map(function (p, i) { return '<tr' + (i === 0 ? ' class="tc-muni"' : '') + '><th scope="row">' + p[0] + '</th><td>' + money(p[1]) + '</td></tr>'; }).join('');
    out.innerHTML =
      '<p class="tc-big"><span>Your 2026 property tax</span><b>' + money(net) + '</b><small>' + money(net / 12) + ' a month</small></p>' +
      '<div class="table-scroll"><table class="res-how tc-table"><tbody>' + rows +
      (cls.value === 'res' ? '<tr class="tc-sum"><th scope="row">Total before the grant</th><td>' + money(gross) + '</td></tr><tr><th scope="row">Home Owner Grant</th><td>' + (g ? money(-g) : '$0') + '</td></tr>' : '') +
      '<tr class="tc-sum"><th scope="row">You pay</th><td>' + money(net) + '</td></tr></tbody></table></div>' +
      (gk !== 'none' && cls.value === 'res' && v > C.hog.threshold ? '<p class="small">' + (g ? 'Your grant is smaller' : 'There is no grant') + ' because your home is assessed over ' + money(C.hog.threshold) + '. The grant shrinks by $5 for every $1,000 over.</p>' : '') +
      '<p>The District’s own share is <b>' + money(muni) + '</b>. ' + (avg ? 'That is ' + (muni >= avg.tax ? money(muni - avg.tax) + ' more' : money(avg.tax - muni) + ' less') + ' than the ' + avg.label + ' (' + money(avg.tax) + ').' : '') + '</p>' +
      (util ? '<p>Water, sewer and garbage come on a separate bill: <b>' + money(util) + '</b> a year. With your taxes that is <b>' + money((net + util) / 12) + '</b> a month.</p>' : '');
    calc27(v, r, gk);
    put('sv_taxcalc', JSON.stringify({ v: v, c: cls.value, g: gk, t: tote.value }));
  }

  // 2027: the District's part grows by whatever increase council adopts, if your assessment moves like the average.
  // Other bodies' rates are held at 2026 since they set theirs in spring 2027. The grant loses its $200 northern part.
  function calc27(v, r, gk) {
    var pct = num(rise.value);
    riseOut.textContent = pct.toFixed(1).replace('.0', '') + '%';
    var other = C.order.slice(1).reduce(function (s, k) { return s + v / 1000 * r[k]; }, 0);
    var xs26 = extraSchool(v), xs27 = extraSchool(v, true);
    var muni26 = v / 1000 * r.muni, muni27 = muni26 * (1 + pct / 100);
    var gross26 = muni26 + other + xs26, gross27 = muni27 + other + xs27;
    var net26 = gross26 - hog(gk, v, gross26, C.hog.y2026), net27 = gross27 - hog(gk, v, gross27, C.hog.y2027);
    var d = net27 - net26, dm = muni27 - muni26, dx = xs27 - xs26, dg = d - dm - dx;
    out27.innerHTML = '<p class="tc-big tc-27"><span>Your 2027 bill at ' + riseOut.textContent + '</span><b>' + money(net27) + '</b><small>' + (d >= 0 ? '+' : '') + money(d) + ' a year (' + (d >= 0 ? '+' : '') + money(d / 12) + ' a month)</small></p>' +
      '<ul class="small"><li>' + money(dm) + ' from the District’s increase</li>' + (dx > 0.5 ? '<li>' + money(dx) + ' because the Province raises the extra school tax on homes over $3 million</li>' : '') + (dg > 0.5 ? '<li>' + money(dg) + ' because the Home Owner Grant drops in 2027 (the $200 northern and rural part ends)</li>' : '') + '</ul>';
  }

  var t;
  function soon() { clearTimeout(t); t = setTimeout(calc, 120); }
  val.addEventListener('input', soon);
  val.addEventListener('blur', function () { var n = num(val.value); if (n) val.value = n.toLocaleString('en-CA'); });
  [cls, grant, tote].forEach(function (el) { el.addEventListener('change', calc); });
  rise.addEventListener('input', function () { var v = num(val.value); if (v >= 10000) calc27(v, C.rates[cls.value], grant.value); else riseOut.textContent = num(rise.value).toFixed(1).replace('.0', '') + '%'; });
  [].forEach.call(box.querySelectorAll('[data-tc-set]'), function (b) {
    b.addEventListener('click', function () { rise.value = b.getAttribute('data-tc-set'); rise.dispatchEvent(new Event('input')); });
  });
  [].forEach.call(box.querySelectorAll('[data-tc-avg]'), function (b) {
    b.addEventListener('click', function () { val.value = Number(b.getAttribute('data-tc-avg')).toLocaleString('en-CA'); cls.value = 'res'; calc(); track('taxcalc_avg', {}); });
  });
  var used = false;
  val.addEventListener('change', function () { if (!used) { used = true; track('taxcalc_use', {}); } });
  calc();
})();
