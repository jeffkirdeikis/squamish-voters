// Live flood panel at the top of a flood story (<section data-flood-live>). Reads /api/flood/ on load and every five
// minutes: river now, the province's newest forecast, notices in effect, regional district evacuation alerts, and a
// small chart of the last three days and the next ten. If the province has issued a newer forecast than the one the
// story was written from (data-issued), the panel says so, because the story text keeps the older numbers.
(function () {
  const box = document.querySelector('[data-flood-live]') || document.createElement('div');
  const band = document.querySelector('[data-flood-band]');
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
  const issuedPlain = (x) => String(x || '').replace(/^(\d{1,2}:\d\d) ?([AP])M (\w+).*$/i, (m, t, ap, day) => `${t} ${ap.toLowerCase()}.m. ${day}`);
  // Forecast hours are good to about an hour, so the peak is shown as a part of the day.
  const partOfDay = (t) => { const h = +fmt(t, { hour: 'numeric', hourCycle: 'h23' }); return `${fmt(t, { weekday: 'long' })} ${h < 5 ? 'overnight' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}`; };
  const r10 = (x) => Math.round(x / 10) * 10;
  const hourDay = (t) => fmt(t, { hour: 'numeric', hour12: true }).replace(/\s*([ap])\.?m\.?/i, (m, a) => ` ${a.toLowerCase()}.m.`) + ' ' + fmt(t, { weekday: 'long' });
  const inHours = (t) => { const h = Math.round((t - Date.now()) / 36e5); return h <= 1 ? 'within the hour' : `in about ${h} hours`; };
  const NOTICE = ['No flood notice', 'High Streamflow Advisory', 'Flood Watch', 'Flood Warning'];

  function chart(d) {
    const g = d.gauge, f = d.forecast, S = d.sizes;
    if (!g && !f) return '';
    const obs = g ? g.series : [], last = obs[obs.length - 1];
    const fc = f ? f.rows.filter((r) => !last || r[0] >= last[0]) : [];
    const x0 = obs[0]?.[0] ?? fc[0][0], x1 = fc.length ? fc[fc.length - 1][0] : last[0] + 864e5;
    const top = Math.max(3300, ...fc.map((r) => r[3]), ...obs.map((p) => p[1])) * 1.03;
    const W = 640, H = 230, L = 44, R = 8, T = 8, B = 22;
    const X = (t) => L + (t - x0) / (x1 - x0) * (W - L - R), Y = (v) => H - B - v / top * (H - T - B);
    const P = (a) => a.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('');
    let s = '';
    for (const v of [0, 1000, 2000, 3000]) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="fl-grid"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${n0(v)}</text>`;
    for (const [v, name] of [[S.y2, 'Every 2 years'], [S.y10, '1 in 10 years'], [S.y50, '1 in 50 years']]) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="fl-size"/><text x="${L + 4}" y="${Y(v) - 4}" class="fl-sizet">${name}</text>`;
    let t = x0 - (x0 % 864e5) + 864e5 + 8 * 36e5; let i = 0;
    for (; t < x1; t += 864e5, i++) if (i % 2 === 0) s += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${fmt(t, { weekday: 'short', day: 'numeric' })}</text>`;
    if (fc.length) s += `<path d="${P(fc.map((r) => [r[0], r[3]]))}${P(fc.map((r) => [r[0], r[2]]).reverse()).replace('M', 'L')}Z" class="fl-band"/><path d="${P([...(last ? [last] : []), ...fc.map((r) => [r[0], r[1]])])}" class="fl-fc"/>`;
    if (obs.length) s += `<path d="${P(obs)}" class="fl-obs"/><circle cx="${X(last[0])}" cy="${Y(last[1])}" r="4.5" class="fl-dot"/><line x1="${X(last[0])}" x2="${X(last[0])}" y1="${T}" y2="${H - B}" class="fl-now"/>`;
    return `<figure class="fl-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Squamish River flow: measured for the last three days and the province's newest forecast">${s}</svg><figcaption><span class="k obs"></span>Measured <span class="k fc"></span>Newest forecast <span class="k band"></span>Possible range. Cubic metres per second at the gauge near Brackendale.</figcaption></figure>`;
  }

  function render(d) {
    const g = d.gauge, f = d.forecast, nt = d.notices, sl = d.slrd, S = d.sizes;
    const newer = f && storyIssued && f.issued && f.issued !== storyIssued;
    const past = f && g && f.peak.t < Date.now() && g.flow < S.y2;
    const trend = g && g.perHour != null ? (Math.abs(g.perHour) < Math.max(2, g.flow * 0.004) ? 'steady' : g.perHour > 0 ? `rising about ${n0(g.perHour)} an hour` : `falling about ${n0(-g.perHour)} an hour`) : '';
    const lvl = nt?.here?.level || 0;
    box.innerHTML = `
      <div class="fl-head"><h2>Live: river, forecast and alerts</h2><p>Updates every five minutes. Checked ${esc(when(d.at))}.</p></div>
      ${newer ? `<p class="fl-flag">The province has issued a newer forecast (${esc(issuedPlain(f.issued))}) since this story was written. The numbers in this panel are the newest. The story below uses the forecast from ${esc(issuedPlain(storyIssued))}.</p>` : ''}
      ${past ? '<p class="fl-flag ok">The forecast peak has passed and the river is back under the size it reaches every second year.</p>' : ''}
      <div class="fl-tiles">
        <div class="fl-tile"><span class="k">Squamish River now</span><b>${g ? n0(g.flow) : '?'}</b><span>${g ? `${esc(trend)}. Read ${esc(when(g.t))}.` : 'The gauge did not answer. Try again shortly.'}</span></div>
        <div class="fl-tile"><span class="k">Newest forecast peak</span><b>${f ? n0(f.peak.flow) : '?'}</b><span>${f ? `${esc(partOfDay(f.peak.t))}, ${esc(sizeName(f.peak.flow, S))}. Range about ${n0(r10(f.low))} to ${n0(f.high)}. Issued ${esc(issuedPlain(f.issued))}.` : 'The forecast did not load.'}</span></div>
        <div class="fl-tile lv${lvl}"><span class="k">Province's flood notice</span><b class="fl-word">${nt ? NOTICE[lvl] : '?'}</b><span>${nt?.here ? `Issued ${esc(nt.here.issued)}. <a href="${esc(nt.here.url)}" target="_blank" rel="noopener">Read it</a>` : nt ? `<a href="${esc(nt.page)}" target="_blank" rel="noopener">Notice page</a>` : 'Could not reach the province.'}</span></div>
        <div class="fl-tile${sl?.active ? ' lv3' : ''}"><span class="k">Evacuation alerts, regional district</span><b class="fl-word">${sl ? (sl.active ? 'Active' : 'None found') : 'Check unavailable'}</b><span>${sl ? (sl.active ? `${sl.items.map(esc).join('. ')} <a href="${esc(sl.page)}" target="_blank" rel="noopener">Details</a>` : `In our last check of the regional district's list (Upper Squamish Valley, upper Paradise Valley). Our check can miss things: <a href="${esc(sl.page)}" target="_blank" rel="noopener">confirm here</a>.`) : `We could not reach the regional district. <a href="https://www.slrd.bc.ca/emergency-program/evacuation-alerts-orders" target="_blank" rel="noopener">Check its list</a>.`} For town, check <a href="https://squamish.ca/alert" target="_blank" rel="noopener">Squamish Alert</a>.</span></div>
      </div>
      ${chart(d)}`;
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
    const rng = f ? `<span class="rng" style="left:${pc(f.low)};width:calc(${pc(f.high)} - ${pc(f.low)})" title="Possible range"></span>` : '';
    const marks = (g ? `<span class="m" style="left:${pc(g.flow)}"><span>Now</span></span>` : '') + (f ? `<span class="m peak" style="left:${pc(f.peak.flow)}"><span>Peak</span></span>` : '');
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
        line = `${parts.join(', and ')}${parts.length ? '. ' : ''}Peak near <b>${n0(f.peak.flow)}</b> ${esc(partOfDay(f.peak.t))}, ${esc(sizeName(f.peak.flow, S))}.`;
      }
    }
    band.innerHTML = `
      <div class="fl-nums">
        <div class="fl-num"><span class="k">River now</span><b>${g ? n0(g.flow) : '?'}</b><small>${g ? `Read ${esc(when(g.t))}.` : 'Gauge did not answer'}</small></div>
        <span class="fl-arrow" aria-hidden="true">→</span>
        <div class="fl-num peak"><span class="k">Forecast peak</span><b>${f ? n0(f.peak.flow) : '?'}</b><small>${f ? `Range about ${n0(r10(f.low))} to ${n0(f.high)}` : 'Forecast did not load'}</small></div>
        ${nt ? `<span class="fl-pill lv${lvl}">${NOTICE[lvl]}</span>` : ''}
      </div>
      <div class="fl-scale" role="img" aria-label="Flood size scale. Now ${g ? n0(g.flow) : 'unknown'}, forecast peak ${f ? n0(f.peak.flow) : 'unknown'}, cubic metres per second.">${zones}${rng}${ticks}${marks}</div>
      <p class="fl-when">${line} <span style="color:#a9bccd">Cubic metres per second at the gauge near Brackendale. Updates every five minutes.</span></p>`;
  }

  const good = {};
  async function load() {
    try {
      const r = await fetch('/api/flood/', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      // Keep the last good reading of any source that failed this time, and try again soon.
      for (const k of ['gauge', 'forecast', 'notices', 'slrd']) { if (d[k]) good[k] = d[k]; else if (good[k]) d[k] = good[k]; }
      render(d); renderBand(d);
      if (!d.gauge || !d.forecast) setTimeout(load, 40 * 1000);
    }
    catch (e) { if (!box.dataset.loaded) box.innerHTML = '<div class="fl-head"><h2>Live: river, forecast and alerts</h2><p>The live numbers did not load. Try refreshing in a minute.</p></div>'; }
    box.dataset.loaded = '1';
  }
  load();
  setInterval(load, 5 * 60 * 1000);
})();
