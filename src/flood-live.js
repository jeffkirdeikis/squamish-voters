// Live flood panel at the top of a flood story (<section data-flood-live>). Reads /api/flood/ on load and every five
// minutes: river now, the province's newest forecast, notices in effect, regional district evacuation alerts, and a
// small chart of the last three days and the next ten. If the province has issued a newer forecast than the one the
// story was written from (data-issued), the panel says so, because the story text keeps the older numbers.
(function () {
  const box = document.querySelector('[data-flood-live]') || document.createElement('div');
  const band = document.querySelector('[data-flood-band]');
  const chartBox = document.querySelector('[data-flood-chart]'), statusBox = document.querySelector('[data-flood-status]');
  if (!box.isConnected && !band) return;
  const TZ = 'America/Vancouver';
  const storyIssued = box.dataset.issued || '';
  const n0 = (x) => (x == null ? '?' : Math.round(x).toLocaleString('en-CA'));
  const fmt = (t, o) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, ...o }).format(new Date(t)).replace(/\.$/, '');
  const when = (t) => fmt(t, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sizeName = (f, S) => f < S.y2 ? 'under the size the river reaches every second year' : f < S.y5 ? 'between a 1 in 2 and a 1 in 5 year flood'
    : f < S.y10 ? 'between a 1 in 5 and a 1 in 10 year flood' : f < S.y20 ? 'between a 1 in 10 and a 1 in 20 year flood'
    : f < S.y50 ? 'between a 1 in 20 and a 1 in 50 year flood' : f < S.y100 ? 'between a 1 in 50 and a 1 in 100 year flood' : 'bigger than a 1 in 100 year flood';
  // The province writes "10:11 AM Monday 2026-11-09"; readers get "10:11 a.m. Monday".
  const issuedPlain = (x) => String(x || '').replace(/^(\d{1,2}:\d\d) ?([AP])M (\w+).*$/i, (m, t, ap, day) => `${t.replace(/^0/, '')} ${ap.toLowerCase()}.m. ${day}`);
  // Forecast hours are good to about an hour, so the peak is shown as a part of the day.
  const partOfDay = (t) => { const h = +fmt(t, { hour: 'numeric', hourCycle: 'h23' }); return `${fmt(t, { weekday: 'long' })} ${h < 5 ? 'overnight' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}`; };
  const r10 = (x) => Math.round(x / 10) * 10;
  const hourDay = (t) => { const h = +fmt(t, { hour: 'numeric', hourCycle: 'h23' }); return `${h === 12 ? 'noon' : h === 0 ? 'midnight' : `${h % 12} ${h < 12 ? 'a.m.' : 'p.m.'}`} ${fmt(t, { weekday: 'long' })}`; };
  // "just under a 1 in 50 year flood" when within 5% below a size, else the plain size band.
  const nearSize = (f, S) => { for (const [v, l] of [[S.y100, '1 in 100'], [S.y50, '1 in 50'], [S.y20, '1 in 20'], [S.y10, '1 in 10'], [S.y5, '1 in 5']]) if (f < v && f >= v * 0.95) return `just under a ${l} year flood`; return sizeName(f, S); };
  const inHours = (t) => { const h = Math.round((t - Date.now()) / 36e5); return h <= 1 ? 'within the hour' : `in about ${h} hours`; };
  const NOTICE = ['No flood notice', 'High Streamflow Advisory', 'Flood Watch', 'Flood Warning'];

  let scale = null, pick = null, touched = false, lastData = null; // pick = the forecast hour the reader dragged to (kept across five minute refreshes)
  // Drawn at the real width of its box (redrawn on resize), so the labels stay readable on a phone.
  function chart(d) {
    const g = d.gauge, f = d.forecast, S = d.sizes;
    if (!g && !f) return '';
    const obs = g ? g.series : [], last = obs[obs.length - 1];
    const fc = f ? f.rows.filter((r) => !last || r[0] >= last[0]) : [];
    const x0 = obs[0]?.[0] ?? fc[0][0], x1 = fc.length ? fc[fc.length - 1][0] : last[0] + 864e5;
    const top = Math.max(3300, ...fc.map((r) => r[3]), ...obs.map((p) => p[1])) * 1.03;
    const W = Math.max(300, Math.round((chartBox || box).clientWidth || 640)), narrow = W < 520;
    const H = Math.round(Math.max(260, Math.min(400, W * 0.58))), L = narrow ? 40 : 48, R = 8, T = 10, B = 26;
    const X = (t) => L + (t - x0) / (x1 - x0) * (W - L - R), Y = (v) => H - B - v / top * (H - T - B);
    scale = { X, Y, fc };
    const P = (a) => a.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('');
    let s = '';
    // Flood size zones behind everything: normal, high water, flood, big flood.
    for (const [a, b, c] of [[S.y2, S.y10, 'z1'], [S.y10, S.y50, 'z2'], [S.y50, top, 'z3']]) s += `<rect x="${L}" y="${Y(b).toFixed(1)}" width="${W - L - R}" height="${(Y(a) - Y(b)).toFixed(1)}" class="fl-zone ${c}"/>`;
    for (const v of [0, 1000, 2000, 3000]) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="fl-grid"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${narrow ? (v ? v / 1000 + 'k' : '0') : n0(v)}</text>`;
    for (const [v, name] of [[S.y2, 'Every second year'], [S.y10, '1 in 10 years'], [S.y50, '1 in 50 years']]) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="fl-size"/><text x="${W - R - 4}" y="${Y(v) - 5}" text-anchor="end" class="fl-sizet">${name}</text>`;
    let t = x0 - (x0 % 864e5) + 864e5 + 8 * 36e5; let i = 0;
    const every = (x1 - x0) / 864e5 > 9 && narrow ? 2 : 1;
    for (; t < x1; t += 864e5, i++) if (i % every === 0) s += `<text x="${X(t)}" y="${H - 7}" text-anchor="middle">${fmt(t, narrow ? { weekday: 'short' } : { weekday: 'short', day: 'numeric' })}</text>`;
    const old = (d.history || []).filter((h) => f && h.issued !== f.issued).slice(0, 4);
    old.forEach((h, k) => { const pts = h.series.filter((p) => p[0] >= x0 && p[0] <= x1); if (pts.length > 1) s += `<path d="${P(pts)}" class="fl-old" style="opacity:${(0.65 - k * 0.13).toFixed(2)}"/>`; });
    if (fc.length) s += `<path d="${P(fc.map((r) => [r[0], r[3]]))}${P(fc.map((r) => [r[0], r[2]]).reverse()).replace('M', 'L')}Z" class="fl-band"/><path d="${P([...(last ? [last] : []), ...fc.map((r) => [r[0], r[1]])])}" class="fl-fc"/>`;
    if (obs.length) s += `<path d="${P(obs)}" class="fl-obs"/><line x1="${X(last[0])}" x2="${X(last[0])}" y1="${T}" y2="${H - B}" class="fl-now"/><circle cx="${X(last[0])}" cy="${Y(last[1])}" r="5" class="fl-dot"/><text x="${X(last[0]) + 6}" y="${T + 13}" class="fl-nowt">Now</text>`;
    if (f) { const pk = f.peak; s += `<text x="${Math.min(X(pk.t) + 9, W - R - 80)}" y="${Y(pk.flow) - 8}" class="fl-pkt">Peak ${n0(pk.flow)}</text>`; }
    if (fc.length) s += `<g class="fl-cur" data-cur><line x1="0" x2="0" y1="${T}" y2="${H - B}"/><circle r="6" cx="0" cy="0"/></g>`;
    return `<figure class="fl-chart"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Squamish River flow: measured for the last three days and the province's newest forecast, peak ${f ? n0(f.peak.flow) + ' ' + partOfDay(f.peak.t) : 'unknown'}">${s}</svg><figcaption><span class="k obs"></span>Measured <span class="k fc"></span>Newest forecast <span class="k band"></span>Possible range${old.length ? ' <span class="k old"></span>Earlier forecasts' : ''} <span class="k zone"></span>Flood sizes. Cubic metres per second at the gauge near Brackendale.</figcaption></figure>`;
  }

  function render(d) {
    const g = d.gauge, f = d.forecast, nt = d.notices, sl = d.slrd, S = d.sizes;
    const newer = f && storyIssued && f.issued && f.issued !== storyIssued;
    const past = f && g && f.peak.t < Date.now() && g.flow < S.y2;
    const trend = g && g.perHour != null ? (Math.abs(g.perHour) < Math.max(2, g.flow * 0.004) ? 'steady' : g.perHour > 0 ? `rising about ${n0(g.perHour)} an hour` : `falling about ${n0(-g.perHour)} an hour`) : '';
    const lvl = nt?.here?.level || 0;
    box.innerHTML = `
      <div class="fl-head"><h2>Live: river, forecast and alerts</h2><p>Updates every five minutes. Checked ${esc(when(d.at))}.</p></div>
      ${newer ? `<p class="fl-flag">The province has issued a newer forecast (${esc(issuedPlain(f.issued))}). The chart, the boxes and the numbers in the story's tiles update themselves. Some written sections still describe the forecast from ${esc(issuedPlain(storyIssued))}.</p>` : ''}
      ${past ? '<p class="fl-flag ok">The forecast peak has passed and the river is back under the size it reaches every second year.</p>' : ''}
      <div class="fl-tiles">
        <div class="fl-tile"><span class="k">Squamish River now</span><b>${g ? n0(g.flow) : '?'}</b><span>${g ? `${esc(trend)}. Read ${esc(when(g.t))}.` : 'The gauge did not answer. Try again shortly.'}</span></div>
        <div class="fl-tile"><span class="k">Newest forecast peak</span><b>${f ? n0(f.peak.flow) : '?'}</b><span>${f ? `${esc(partOfDay(f.peak.t))}, ${esc(sizeName(f.peak.flow, S))}. Range about ${n0(r10(f.low))} to ${n0(f.high)}. Issued ${esc(issuedPlain(f.issued))}.` : 'The forecast did not load.'}</span></div>
        <div class="fl-tile lv${lvl}"><span class="k">Province's flood notice</span><b class="fl-word">${nt ? NOTICE[lvl] : '?'}</b><span>${nt?.here ? `Issued ${esc(nt.here.issued)}. <a href="${esc(nt.here.url)}" target="_blank" rel="noopener">Read it</a>` : nt ? `<a href="${esc(nt.page)}" target="_blank" rel="noopener">Notice page</a>` : 'Could not reach the province.'}</span></div>
        <div class="fl-tile${sl?.active ? ' lv3' : ''}"><span class="k">Evacuation alerts, regional district</span><b class="fl-word">${sl ? (sl.active ? 'Active' : 'None found') : 'Check unavailable'}</b><span>${sl ? (sl.active ? `${sl.items.map(esc).join('. ')} <a href="${esc(sl.page)}" target="_blank" rel="noopener">Details</a>` : `In our last check of the regional district's list (Upper Squamish Valley, upper Paradise Valley). Our check can miss things: <a href="${esc(sl.page)}" target="_blank" rel="noopener">confirm here</a>.`) : `We could not reach the regional district. <a href="https://www.slrd.bc.ca/emergency-program/evacuation-alerts-orders" target="_blank" rel="noopener">Check its list</a>.`} For town, check <a href="https://squamish.ca/alert" target="_blank" rel="noopener">Squamish Alert</a>.</span></div>
        ${rainTile(d)}
      </div>
      ${moves(d)}`;
  }
  // The big chart under the area picker, with the slider. The slider also marks the matching step in the story's timeline.
  function renderChart(d) {
    if (!chartBox) return;
    const c = chart(d); if (!c) { chartBox.innerHTML = ''; return; }
    chartBox.innerHTML = `<h2 class="fl-hc-h">The river, hour by hour</h2>${c}${scale && scale.fc.length > 1 ? `<div class="fl-scrub"><label for="fl-scrub-r">Drag through the forecast</label><input id="fl-scrub-r" type="range" min="0" max="${scale.fc.length - 1}" step="1"><p class="fl-scrub-out" aria-live="polite"></p></div>` : ''}`;
    scrub(d);
  }

  // "Wednesday November 11, 6 a.m.", with noon and midnight in words.
  const stamp = (t) => { const h = +fmt(t, { hour: 'numeric', hourCycle: 'h23' }); return `${fmt(t, { weekday: 'long', month: 'long', day: 'numeric' }).replace(',', '')}, ${h === 0 ? 'midnight' : h === 12 ? 'noon' : `${h % 12} ${h < 12 ? 'a.m.' : 'p.m.'}`}`; };
  // The slider under the chart: pick any forecast hour, see the flow, its flood size and which way the river is going.
  function scrub(d) {
    const root = chartBox || box, r = root.querySelector('#fl-scrub-r'); if (!r) return;
    const fc = scale.fc, S = d.sizes, cur = root.querySelector('[data-cur]'), out = root.querySelector('.fl-scrub-out');
    const peakI = fc.reduce((a, x, i) => (x[1] > fc[a][1] ? i : a), 0);
    let i = pick == null ? peakI : fc.findIndex((x) => x[0] >= pick); if (i < 0) i = peakI;
    r.value = i;
    const show = () => {
      const k = +r.value, row = fc[k]; pick = row[0];
      cur.setAttribute('transform', `translate(${scale.X(row[0]).toFixed(1)},0)`); cur.querySelector('circle').setAttribute('cy', scale.Y(row[1]).toFixed(1));
      const prev = fc[Math.max(0, k - 3)][1], dir = (row[1] - prev) / Math.min(3, Math.max(1, k));
      const peak = fc[peakI][1];
      const how = k === peakI ? 'the forecast peak' : row[1] >= peak * 0.96 ? 'close to the peak' : Math.abs(dir) < Math.max(3, row[1] * 0.005) ? 'about steady' : dir > 0 ? `rising about ${n0(dir)} an hour` : `falling about ${n0(-dir)} an hour`;
      const big = row[1] >= S.y10 ? ' hot' : row[1] >= S.y2 ? ' warm' : '';
      out.innerHTML = `<b>${esc(stamp(row[0]))}</b> <span class="fl-scrub-n${big}">${n0(row[1])}</span> ${esc(how)}, ${esc(sizeName(row[1], S))}. Possible range ${n0(row[2])} to ${n0(row[3])}.`;
      // Mark the step in the story's timeline that this hour falls in.
      let hit = null; document.querySelectorAll('[data-live-tl] li[data-t]').forEach((li) => { li.classList.remove('here'); if (+li.dataset.t <= row[0]) hit = li; });
      if (hit) hit.classList.add('here');
    };
    r.addEventListener('input', () => { touched = true; show(); }); show();
    if (!touched) document.querySelectorAll('[data-live-tl] li.here').forEach((li) => li.classList.remove('here'));
  }


  // The band at the top of the story: now → forecast peak, both placed on the province's flood size scale.
  function renderBand(d) {
    if (!band) return;
    const g = d.gauge, f = d.forecast, nt = d.notices, S = d.sizes;
    if (!g && !f) { band.innerHTML = '<p class="fl-band-wait">The river numbers did not load. They are retried every five minutes.</p>'; return; }
    const lvl = nt?.here?.level || 0;
    const top = Math.max(3300, (f?.high || 0) * 1.05, (g?.flow || 0) * 1.05);
    const pc = (v) => `${Math.min(100, Math.max(0, v / top * 100)).toFixed(2)}%`;
    const zones = [[0, S.y2, '#3f7fb8'], [S.y2, S.y10, '#d9a21b'], [S.y10, S.y50, '#e0623f'], [S.y50, top, '#a3222b']]
      .map(([a, b, c]) => `<span class="z" style="left:${pc(a)};width:calc(${pc(b)} - ${pc(a)});background:${c}"></span>`).join('');
    const ticks = [[S.y2, 'Every 2 years', ' y2'], [S.y10, '1 in 10', ''], [S.y20, '1 in 20', ' mid'], [S.y50, '1 in 50', ''], [S.record, '2003 record', ' mid']]
      .filter(([v]) => v < top).map(([v, l, c]) => `<span class="t${c}" style="left:${pc(v)}">${l}</span>`).join('');
    const rng = f ? `<span class="rng" style="left:${pc(f.low)};width:calc(${pc(f.high)} - ${pc(f.low)})"></span><span class="brk" style="left:${pc(f.low)};width:calc(${pc(f.high)} - ${pc(f.low)})"><span>Possible range ${n0(r10(f.low))} to ${n0(f.high)}</span></span>` : '';
    const marks = (g ? `<span class="m" style="left:${pc(g.flow)}"><span>Now</span></span>` : '') + (f ? `<span class="m peak" style="left:${pc(f.peak.flow)}"><span>Most likely</span></span>` : '');
    // When does it happen: first forecast hour over each flood size, if the river is not there yet.
    let line = '';
    if (f) {
      const ahead = f.rows.filter((r) => r[0] >= Date.now());
      const cross = (v) => (g && g.flow >= v ? null : ahead.find((r) => r[1] >= v)?.[0] ?? null);
      const peakPast = f.peak.t < Date.now() - 36e5;
      const c2 = cross(S.y2), c10 = cross(S.y10);
      if (peakPast) line = g && g.flow >= S.y2 ? 'The forecast peak has passed. The river is still above the size it reaches every second year.' : 'The forecast peak has passed.';
      else {
        const parts = [];
        if (c2) parts.push(`Forecast to pass the every second year mark <b>${inHours(c2)}</b>, about ${esc(hourDay(c2))}`);
        else if (g && g.flow >= S.y2) parts.push('<b>Above the every second year mark now</b>');
        if (c10) parts.push(`the 1 in 10 year mark about ${esc(hourDay(c10))}`);
        line = `${parts.join(', and ')}${parts.length ? '. ' : ''}Most likely peak near <b>${n0(f.peak.flow)}</b> ${esc(partOfDay(f.peak.t))}, ${esc(sizeName(f.peak.flow, S))}. The top of the range, <b>${n0(f.high)}</b>, is ${esc(nearSize(f.high, S))}, and the province says the river can go above its range.`;
      }
    }
    band.innerHTML = `
      <div class="fl-nums">
        <div class="fl-num"><span class="k">River flow now</span><b>${g ? n0(g.flow) : '?'}</b><em class="u">cubic metres a second</em><small>${g ? `Read ${esc(when(g.t))}.` : 'Gauge did not answer'}</small></div>
        <span class="fl-arrow" aria-hidden="true">→</span>
        <div class="fl-num peak"><span class="k">Most likely peak</span><b>${f ? n0(f.peak.flow) : '?'}</b><em class="u">cubic metres a second</em><small>${f ? esc(partOfDay(f.peak.t)) : 'Forecast did not load'}</small></div>
        ${f ? `<div class="fl-num top"><span class="k">Could reach</span><b>${n0(f.high)}</b><em class="u">cubic metres a second</em><small>${esc(nearSize(f.high, S))}</small></div>` : ''}
        ${nt ? `<span class="fl-pill lv${lvl}">${NOTICE[lvl]}</span>` : ''}
      </div>
      <p class="fl-unit"><b>What the numbers mean:</b> how many cubic metres of water flow past the gauge near Brackendale every second. One cubic metre is 1,000 litres, about five full bathtubs. At 2,500 the river moves a whole Olympic swimming pool of water every second.</p>
      <div class="fl-scale" role="img" aria-label="Flood size scale. Now ${g ? n0(g.flow) : 'unknown'}, forecast peak ${f ? n0(f.peak.flow) : 'unknown'}, cubic metres per second.">${zones}${rng}${ticks}${marks}</div>
      <p class="fl-when">${line} <span style="color:#c2d1de">Updates every five minutes.</span></p>`;
  }

  // Rain on the mountains for this storm: so far (model hours already passed) and still to come, from data-rain-from to data-rain-to.
  function rainTile(d) {
    const r = d.rain, a = Date.parse(box.dataset.rainFrom || ''), b = Date.parse(box.dataset.rainTo || '');
    if (!r || !a || !b) return '';
    const now = Date.now(), h = r.hourly.filter((x) => x[0] >= a && x[0] < b);
    const done = h.filter((x) => x[0] <= now).reduce((s, x) => s + x[1], 0), left = h.filter((x) => x[0] > now).reduce((s, x) => s + x[1], 0);
    const fzNow = (r.hourly.filter((x) => x[0] <= now).pop() || [])[2];
    const pct = done + left ? Math.round(done / (done + left) * 100) : 0;
    const end = fmt(b - 1, { weekday: 'long' });
    return `<div class="fl-tile fl-rain"><span class="k">Rain on the mountains this storm</span><b>${n0(done)} mm <small>so far</small></b>
      <span class="fl-rainbar" role="img" aria-label="${n0(done)} of about ${n0(done + left)} millimetres"><i style="width:${pct}%"></i></span>
      <span>${left >= 1 ? `About <b class="fl-inl">${n0(left)} mm</b> more forecast through ${esc(end)}.` : 'The forecast rain for this storm has fallen.'}${fzNow ? ` Freezing level now about ${n0(Math.round(fzNow / 100) * 100)} metres: ${fzNow > 2400 ? 'rain falls on nearly the whole watershed' : 'above that, it falls as snow and stays on the mountain for now'}.` : ''} Open-Meteo weather model, average of three points in the watershed.</span></div>`;
  }
  // How the province's forecast peak has moved from run to run (runs saved since this story went up).
  function moves(d) {
    const runs = [...(d.history || [])].reverse();
    if (runs.length < 2) return '';
    return `<p class="fl-moves"><b>How the forecast peak has moved:</b> ${runs.map((h) => `${n0(h.peak)} <span>(${esc(issuedPlain(h.issued))})</span>`).join(' → ')}</p>`;
  }

  // "Share the river now": the same numbers as a picture (api/og.js ?flood=1), shared as an image file where the phone allows it.
  // The picture is fetched ahead of the tap, because phones only open the share sheet straight from a tap, not after a wait.
  let shareFile = null, shareSrc = '';
  const prepShare = () => {
    shareSrc = `/api/og/?flood=1&t=${Math.floor(Date.now() / 3e5)}`;
    fetch(shareSrc).then((r) => (r.ok ? r.blob() : null)).then((blob) => { shareFile = blob ? new File([blob], 'squamish-river-now.png', { type: 'image/png' }) : null; window.svShareFile = shareFile; window.svSharePic = shareSrc; }).catch(() => {});
  };



  // Sunset for Squamish (49.70 N, 123.15 W) on a given day, from the standard solar position formulas.
  function sunset(day) {
    const rad = Math.PI / 180, lat = 49.70 * rad, lw = 123.15 * rad, J0 = 0.0009, e = rad * 23.4397;
    const d = day / 864e5 - 0.5 + 2440588 - 2451545;
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const Lsun = M + C + rad * 102.9372 + Math.PI, dec = Math.asin(Math.sin(e) * Math.sin(Lsun));
    const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec)));
    const a = J0 + (w + lw) / (2 * Math.PI) + n;
    const J = 2451545 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * Lsun);
    return (J + 0.5 - 2440588) * 864e5;
  }
  const clock = (t) => fmt(t, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s*([ap])\.?m\.?/i, (m, a) => ` ${a.toLowerCase()}.m.`).replace(':00 ', ' ');
  const dayHour = (t) => { const h = +fmt(t, { hour: 'numeric', hourCycle: 'h23' }); return `${fmt(t, { weekday: 'short' })} ${h === 12 ? 'noon' : h === 0 ? 'midnight' : `${h % 12} ${h < 12 ? 'a.m.' : 'p.m.'}`}`; };
  const span = (ms) => { const m = Math.max(0, Math.round(ms / 6e4)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`; };
  const MEANS = ['No provincial flood notice is in effect for this area.', 'Rivers rising fast. No major flooding expected.', 'Flooding possible, not certain. The next step would be a Flood Warning.', 'Flooding expected, or under way.'];

  // Key moments in the newest forecast: when it passes each size, the peak, how long above 2,000.
  function moments(d) {
    const f = d.forecast, g = d.gauge, S = d.sizes; if (!f) return null;
    const now = Date.now(), rows = f.rows, ahead = rows.filter((r) => r[0] >= now - 36e5);
    const cross = (v) => (g && g.flow >= v ? 'now' : (ahead.find((r) => r[1] >= v) || [])[0] || null);
    const step = rows.length > 1 ? rows[1][0] - rows[0][0] : 36e5;
    return { c1000: cross(1000), cy2: cross(S.y2), c2000: cross(2000), cy10: cross(S.y10), cy20: cross(S.y20), cy50: cross(S.y50),
      h2000: Math.round(rows.filter((r) => r[1] >= 2000).length * step / 36e5), peak: f.peak };
  }

  // The strip under the headline: official status first, then the clock (daylight, next size passed, peak).
  function renderStatus(d) {
    if (!statusBox) return;
    const nt = d.notices, sl = d.slrd, lvl = nt?.here?.level || 0, m = moments(d), now = Date.now();
    const ss = sunset(now), sr = ss - 864e5 + 0; // today's sunset
    const day = ss > now ? `<div><small>Daylight left today</small><b>${span(ss - now)}</b><span>Sunset ${esc(clock(ss))}</span></div>` : `<div><small>Daylight</small><b>Dark now</b><span>Sunset was ${esc(clock(ss))}</span></div>`;
    let next = '';
    if (m) {
      const c = m.c2000 && m.c2000 !== 'now' ? [m.c2000, 'River flow passes 2,000', ''] : m.cy10 && m.cy10 !== 'now' ? [m.cy10, 'Passes 1 in 10 year size', ''] : null;
      next = c ? `<div><small>${c[1]}</small><b>in ${span(c[0] - now)}</b><span>${c[2]}about ${esc(dayHour(c[0]))}</span></div>` : m.c2000 === 'now' ? '<div><small>River flow</small><b>Above 2,000 now</b><span>Stay off banks and dikes</span></div>' : '';
      const pk = m.peak.t > now - 36e5 ? `<div><small>Forecast peak</small><b>${esc(dayHour(m.peak.t))}</b><span>near ${n0(m.peak.flow)}</span></div>` : `<div><small>Forecast peak</small><b>Passed</b><span>${n0(m.peak.flow)}, ${esc(dayHour(m.peak.t))}</span></div>`;
      next += pk;
    }
    statusBox.innerHTML = `<div class="fl-st-row"><span class="fl-st-b lv${lvl}">${nt ? NOTICE[lvl] : 'Notice not checked'}</span><span>${nt ? esc(MEANS[lvl]) : 'We could not reach the province just now.'}</span></div>
      <div class="fl-st-row"><span class="fl-st-b ${sl?.active ? 'lv3' : 'ok'}">${sl ? (sl.active ? 'Evacuation alert or order' : 'No evacuation alerts found') : 'Alerts not checked'}</span><span>${sl?.active ? `<a href="${esc(sl.page)}" target="_blank" rel="noopener">See the regional district's list</a>.` : 'Regional district list.'} Checked ${esc(clock(d.at))}, again every 5 minutes.</span></div>
      <div class="fl-st-clock">${day}${next}</div>
      ${m ? '<p class="fl-st-note">River numbers such as 2,000 are cubic metres of water flowing past the gauge near Brackendale every second.</p>' : ''}
      <p class="fl-st-note">If anything here differs from the <a href="https://www.slrd.bc.ca/emergency-program" target="_blank" rel="noopener">regional district</a>, the <a href="https://squamish.ca/alert" target="_blank" rel="noopener">District of Squamish</a> or the <a href="https://bcrfc.env.gov.bc.ca/warnings/index.htm" target="_blank" rel="noopener">River Forecast Centre</a>, follow them.</p>`;
    // The date under the section name says when the numbers were last checked, not "Yesterday".
    const k = document.querySelector('.nw-art .nw-kicker time'); if (k) { k.removeAttribute('data-rel'); k.textContent = `Live, checked ${clock(d.at)}`; }
  }

  // Story numbers that follow the newest forecast: {{live}} spans, the share text, the step by step timeline, the ruler,
  // the Squamish row of the river bars and the peak bar in the sidebar.
  function liveStory(d) {
    const f = d.forecast, g = d.gauge, S = d.sizes, m = moments(d); if (!f || !m) return;
    const when = (t) => (t === 'now' ? 'already (it is above that now)' : t ? `about ${hourDay(t)}` : 'not in the newest forecast');
    const V = { t2000: when(m.c2000), h2000: String(m.h2000), peak: n0(f.peak.flow), peakwhen: `about ${hourDay(f.peak.t)}`, issued: issuedPlain(f.issued), high: n0(f.high) };
    document.querySelectorAll('[data-live]').forEach((el) => { if (V[el.dataset.live] != null) el.textContent = V[el.dataset.live]; });
    document.querySelectorAll('[data-share-bar][data-tpl]').forEach((b) => {
      const text = b.dataset.tpl.replace(/\[\[(\w+)\]\]/g, (x, k) => V[k] ?? ''), msg = encodeURIComponent(`${text} ${b.dataset.url}`);
      b.dataset.text = text;
      const sms = b.querySelector('[data-sh="sms"]'), wa = b.querySelector('[data-sh="wa"]');
      if (sms) sms.href = `sms:?&body=${msg}`; if (wa) wa.href = `https://wa.me/?text=${msg}`;
    });
    // Timeline: rebuilt from the forecast, a row for each moment that matters.
    const tl = document.querySelector('[data-live-tl]');
    if (tl) {
      let notes = {}; try { notes = JSON.parse(tl.dataset.notes || '{}'); } catch (e) {}
      const R = [], now = Date.now();
      if (g) R.push({ t: g.t, v: g.flow, when: `Now, ${clock(g.t)}`, say: `${n0(g.flow)}, measured`, note: notes.now });
      for (const [key, v, label] of [['c1000', 1000, '1000'], ['cy2', S.y2, 'y2'], ['c2000', 2000, '2000'], ['cy10', S.y10, 'y10'], ['cy20', S.y20, 'y20'], ['cy50', S.y50, 'y50']]) {
        const t = m[key]; if (!t || t === 'now' || t > f.peak.t) continue;
        R.push({ t, v, when: dayHour(t), say: `past ${n0(v)}`, note: notes[label] });
      }
      if (f.peak.t > now - 36e5) R.push({ t: f.peak.t, v: f.peak.flow, when: dayHour(f.peak.t), say: `peak, near ${n0(f.peak.flow)}`, note: notes.peak, pk: 1 });
      const after = f.rows.filter((r) => r[0] > f.peak.t);
      const down = (v) => after.find((r) => r[1] < v);
      for (const v of [2000, S.y2, 1000]) { const r = f.peak.flow >= v && down(v); if (r && r[0] > now) R.push({ t: r[0], v: r[1], when: dayHour(r[0]), say: `back under ${n0(v)}` }); }
      // A later, smaller bump: the highest point after the river's low point following the peak.
      if (after.length) { const lowI = after.reduce((a, r, i) => (r[1] < after[a][1] ? i : a), 0), rest = after.slice(lowI), hi = rest.reduce((a, r) => (r[1] > a[1] ? r : a), rest[0]);
        if (hi && hi[1] > after[lowI][1] * 1.15 && hi[1] > 300) R.push({ t: hi[0], v: hi[1], when: dayHour(hi[0]), say: `near ${n0(hi[1])}`, note: notes.bump }); }
      R.sort((a, b) => a.t - b.t);
      const max = Math.max(...R.map((r) => r.v), S.y10) * 1.12, pc = (v) => `${Math.min(100, v / max * 100).toFixed(1)}%`;
      tl.innerHTML = `<figcaption>The Squamish River, step by step (province's forecast, ${esc(issuedPlain(f.issued))}) <span class="nw-tl-key"><i></i>1 in 10 year flood, ${n0(S.y10)}</span></figcaption><ol>${R.map((r) => `<li data-t="${r.t}"${r.v >= S.y10 ? ' class="over"' : ''}><span class="nw-tl-when">${esc(r.when)}</span><span class="nw-tl-bar" role="img" aria-label="${esc(r.say)}"><i style="width:${pc(r.v)}"></i><s style="left:${pc(S.y10)}"></s><em>${esc(r.say)}</em></span>${r.note ? `<span class="nw-tl-note">${esc(r.note)}</span>` : ''}</li>`).join('')}</ol>`;
    }
    // Ruler: move the pin and the range band.
    const ru = document.querySelector('[data-live-ruler]');
    if (ru) {
      const lo = +ru.dataset.lo, hi = +ru.dataset.hi, pc = (v) => `${Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100)).toFixed(1)}%`;
      const pin = ru.querySelector('.nw-ruler-pin'), rg = ru.querySelector('.nw-ruler-range'), cap = ru.querySelector('figcaption');
      if (pin) { pin.style.left = pc(f.peak.flow); pin.querySelector('b').textContent = `Most likely ${n0(f.peak.flow)}`; }
      if (rg) { rg.style.left = pc(f.low); rg.style.width = `calc(${pc(f.high)} - ${pc(f.low)})`; }
      if (cap) cap.textContent = `Cubic metres of water per second at the gauge near Brackendale, from the province's forecast issued ${issuedPlain(f.issued)}. Blue band: the possible range, about ${n0(Math.round(f.low / 10) * 10)} to ${n0(f.high)}. The most likely peak is about ${Math.round(f.peak.flow * 60 / 2500)} Olympic pools of water every minute.`;
    }
    // River bars: the Squamish row.
    const rv = document.querySelector('[data-live-river]');
    if (rv) {
      const rec = +rv.dataset.record, p = Math.round(f.peak.flow / rec * 100);
      rv.querySelector('.nw-rv-bar i').style.width = `${Math.min(100, p)}%`;
      const tk = rv.querySelector('.nw-rv-bar s'); if (tk) tk.style.left = `${Math.min(100, f.high / rec * 100).toFixed(1)}%`;
      rv.querySelector('.nw-rv-pct').textContent = `${p}%`;
      const say = rv.querySelector('.nw-rv-say'); if (say) say.textContent = `Near ${n0(f.peak.flow)} ${hourDay(f.peak.t).replace(/^/, 'about ')} (forecast of ${issuedPlain(f.issued)}). Record ${n0(rec)}, set in October 2003.`;
    }
    // Sidebar bars: the first row is this week's peak.
    const bar = document.querySelector('.nw-art .nw-bars .nw-bar.win');
    if (bar) { const rows = [...bar.parentElement.querySelectorAll('.nw-bar')].slice(1).map((b) => +String(b.querySelector('b').textContent).replace(/\D/g, '')); const top = Math.max(f.peak.flow, ...rows);
      bar.style.setProperty('--w', `${(f.peak.flow / top * 100).toFixed(1)}%`); bar.querySelector('b').textContent = n0(f.peak.flow);
      bar.parentElement.querySelectorAll('.nw-bar').forEach((b, i) => { if (i) b.style.setProperty('--w', `${(rows[i - 1] / top * 100).toFixed(1)}%`); }); }
  }

  const good = {};
  async function load() {
    try {
      const r = await fetch('/api/flood/', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      // Keep the last good reading of any source that failed this time, and try again soon.
      for (const k of ['gauge', 'forecast', 'notices', 'slrd', 'rain']) { if (d[k]) good[k] = d[k]; else if (good[k]) d[k] = good[k]; }
      lastData = d;
      render(d); renderBand(d); renderChart(d); renderStatus(d); liveStory(d); prepShare();
      if (!d.gauge || !d.forecast) setTimeout(load, 40 * 1000);
    }
    catch (e) { if (!box.dataset.loaded) box.innerHTML = '<div class="fl-head"><h2>Live: river, forecast and alerts</h2><p>The live numbers did not load. Try refreshing in a minute.</p></div>'; }
    box.dataset.loaded = '1';
  }
  load();
  setInterval(load, 5 * 60 * 1000);
  setInterval(() => { if (lastData) renderStatus(lastData); }, 60 * 1000);
  let rw = 0, lastW = 0; window.addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(() => { if (lastData && chartBox && chartBox.clientWidth !== lastW) { lastW = chartBox.clientWidth; renderChart(lastData); } }, 200); });
})();

// Flood alert form at the top of the flood story (api/flood-alert.js). Pressing "Email me flood alerts" is the consent.
// After it goes through: a one tap offer of the Friday email (api/subscribe.js) for the same address, and the sticky button goes away.
(function () {
  const box = document.querySelector('[data-flood-alert]'), f = box && box.querySelector('form');
  if (!f) return;
  const msg = f.querySelector('.fl-alert-msg'), btn = f.querySelector('button'), input = f.querySelector('#fl-alert-email'), more = f.querySelector('.fl-alert-more');
  const sticky = document.querySelector('[data-flood-sticky]');
  let done = false;
  try { done = localStorage.getItem('sv_flood_alert') === '1'; } catch (e) {}
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    msg.className = 'fl-alert-msg';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'That email address doesn’t look right.'; msg.classList.add('bad'); input.focus(); return; }
    btn.disabled = true; msg.textContent = 'Sending…';
    if (window.SVpulse) SVpulse.ev('signup try', { kind: 'flood alert', from: 'flood story' });
    try {
      const r = await fetch('/api/flood-alert/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, consent: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || 'Something went wrong. Try again in a minute.');
      msg.textContent = d.already ? 'You’re already signed up for flood alerts.' : 'Check your email and tap the link to turn alerts on. Look in spam if it isn’t there in a minute.';
      msg.classList.add('good'); input.value = '';
      if (!d.already && window.SVpulse) SVpulse.signup('flood alert', 'flood story');
      done = true; try { localStorage.setItem('sv_flood_alert', '1'); } catch (x) {}
      if (sticky) sticky.hidden = true;
      offerWeekly(email);
    } catch (err) { msg.textContent = err.message; msg.classList.add('bad'); }
    btn.disabled = false;
  });
  // One tap: also get the Friday email. A separate choice (not a pre ticked box), so the consent stays clear.
  function offerWeekly(email) {
    more.hidden = false;
    more.innerHTML = '<p><b>Want the rest of Squamish news too?</b> One short email every Friday: what council decided and what is coming up.</p><button type="button" class="btn secondary">Yes, add the Friday email</button><p class="fl-alert-msg" role="status"></p>';
    const b = more.querySelector('button'), m = more.querySelector('.fl-alert-msg');
    b.addEventListener('click', async () => {
      b.disabled = true; m.className = 'fl-alert-msg'; m.textContent = 'Adding you…';
      if (window.SVpulse) SVpulse.ev('signup try', { kind: 'weekly email', from: 'flood alert' });
      try {
        const r = await fetch('/api/subscribe/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, consent: true, from: 'flood-alert' }) });
        const d = await r.json().catch(() => ({}));
        if (!d.ok) throw new Error(d.error || 'Something went wrong. Try again in a minute.');
        m.textContent = d.pending ? 'Done. Check your inbox for a second link to confirm the Friday email.' : 'You’re already on the Friday email. Thanks!';
        m.classList.add('good'); b.hidden = true;
        if (window.SVdone) SVdone('email');
        if (d.pending && window.SVpulse) SVpulse.signup('weekly email', 'flood alert');
      } catch (err) { m.textContent = err.message; m.classList.add('bad'); b.disabled = false; }
    });
  }
  // Sticky "Get flood alerts" button: shows once the reader has scrolled past the box, hides while the box is on screen
  // or once they have signed up. Tapping it scrolls back up and puts the cursor in the email field.
  if (sticky && 'IntersectionObserver' in window) {
    let passed = false;
    new IntersectionObserver((es) => { es.forEach((x) => { passed = !x.isIntersecting && x.boundingClientRect.top < 0; sticky.hidden = done || !passed; }); }).observe(box);
    sticky.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.SVpulse) SVpulse.ev('opened', { what: 'Sticky Get flood alerts button' });
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => input.focus({ preventScroll: true }), 450);
    });
  }
})();
