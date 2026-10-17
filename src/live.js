// Results page on election night: counts down to polls closing, then polls /api/live-results and draws the
// District's unofficial numbers as they come in. The static page stays readable if any of this fails.
(function () {
  var CLOSE = Date.parse('2026-10-18T03:00:00Z'); // 8 p.m. Pacific, October 17
  var cd = document.getElementById('countdown'), cdTime = document.getElementById('cd-time');
  var box = document.getElementById('live-results'), status = document.getElementById('live-status');
  if (!box) return;
  var found = false;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var ms = CLOSE - Date.now();
    if (ms <= 0) {
      cd.querySelector('.cd-label').textContent = 'Polls are closed';
      cdTime.textContent = found ? 'Results are coming in' : 'Counting the votes';
      cdTime.style.fontSize = '1.6rem';
      return false;
    }
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    cdTime.textContent = (h ? h + ' h ' : '') + pad(m) + ' min ' + pad(s % 60) + ' s';
    return true;
  }
  if (tick()) { var t = setInterval(function () { if (!tick()) clearInterval(t); }, 1000); }
  var NAMES = { mayor: 'Mayor', council: 'Council', trustees: 'School trustees' };
  function esc(x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function race(k, r) {
    if (!r || !r.rows.length) return '';
    var top = r.rows[0].total || 1;
    return '<h2>' + NAMES[k] + ' <span class="small">(' + r.seats + ' elected)</span></h2>' + r.rows.map(function (x, i) {
      var lead = i < r.seats && x.total > 0;
      return '<div class="lr-row' + (lead ? ' lead' : '') + '"><span class="lr-name">' + esc(x.name) + (lead ? ' · leading' : '') + '</span><span class="lr-votes">' + x.total.toLocaleString('en-CA') + '</span><span class="lr-bar"><span style="width:' + (100 * x.total / top).toFixed(1) + '%"></span></span></div>';
    }).join('');
  }
  function load() {
    fetch('/api/live-results/', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.found) return;
      found = true; tick();
      box.innerHTML = '<p><b>Unofficial results' + (d.progress ? ', ' + esc(d.progress) : '') + '.</b> Updated ' + new Date(d.checked).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) + '. <a href="' + esc(d.source_url) + '" target="_blank" rel="noopener">[District of Squamish]</a></p>' + race('mayor', d.races.mayor) + race('council', d.races.council) + race('trustees', d.races.trustees);
      status.textContent = 'These are unofficial numbers read from the District of Squamish results page and update every minute. Official results are declared on October 21.';
    }).catch(function () {});
  }
  load();
  setInterval(load, 60000);
})();
