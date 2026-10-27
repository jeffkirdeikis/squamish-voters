/* What Squamish Wants (/wants/, and a short version on Home and /your-say/).
   The full list is the front door: every ask has Yes / No / Don't mind right on its row. The totals stay hidden behind a
   blurred bar until you answer or tap the ask, so people answer before they see the crowd and have a reason to open each one.
   Ranking: share of yes among yes and no ("don't mind" stays out of the percentage so a local ask isn't buried by people
   it doesn't affect), ties broken by how many answered. Ranked from the first answer.
   The order is frozen while someone answers, so rows never jump under their finger.
   Rows stay slim: the title, the answer buttons, and one line under them (how many answered and More info before you
   answer; where you stand, Share and More info after). Tapping the title opens the rest.
   Phones open on One by one: answer, the card turns into the results with a line on where you stand, then moves on by
   itself after a few seconds. The raised Your say button in the bottom bar becomes a progress ring; tapping it goes to
   the next unanswered ask. At 5 answers a "My Squamish" card offers a share picture (/wants/me/).
   Desktop (1000px and up): a side rail with a progress ring and a live Most wanted board (locked until 5 answers, like
   the Top 10); the add box sits under the list. A live line under the title says how many answered in the last hour,
   and asks gaining answers fastest today get a Trending label.
   The Top 10 board opens after 5 answers. One by one takes Y, N, M and the right arrow on a keyboard.
   Adding an ask: Claude checks the rules, writes a short neutral ask, and lists asks already on the list that look the
   same, so the writer can answer that one or add their words to it instead of posting a copy.
   Sharing: every answered ask has a share bar (Facebook, Copy link, and the phone's own share sheet). The link carries the
   answer (/wants/<id>/said/<key>/?n=<answers>), so the Facebook picture says "I said Yes" over the question with the live
   results under it (Jeff's call, Oct 26 2026). The plain question link still has no numbers. "Share my picks" sends up to 5 answers as one picture (/wants/my/).
   Multiple choice asks: residents can add a missing answer (Claude checks it isn't already there). Starter answers keep
   their order; added ones follow, ranked by popularity when the page loads. Past 6 answers the rest fold behind
   "Show more". */
(function () {
  var root = document.querySelector('[data-wants]');
  var dataEl = document.getElementById('wa-data');
  if (!root || !dataEl) return;
  var D = JSON.parse(dataEl.textContent);
  var mode = root.getAttribute('data-wants') || 'page'; // page | short
  var only = root.getAttribute('data-only'); // a More info page: just that ask
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(n, d) { if (window.SV && SV.track) try { SV.track(n, d); } catch (e) {} }
  function toast(m) { if (window.SV && SV.toast) SV.toast(m); }
  function $(sel) { return root.querySelector(sel); }
  var voter = get('sv_voter', '');
  if (!voter) { voter = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)); put('sv_voter', voter); }
  // A short summary of this phone or computer (screen, browser, time zone, language). It stays the same in a private window,
  // so the API can tell when one device answers an ask again after its saved id was cleared. Nothing here identifies a person.
  var dev = (function () {
    var n = navigator, sc = window.screen || {}, tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    var str = [n.userAgent, n.platform, (n.languages || [n.language]).join(','), n.hardwareConcurrency, n.maxTouchPoints, sc.width + 'x' + sc.height, sc.colorDepth, window.devicePixelRatio, tz].join('|'), h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36) + str.length.toString(36);
  })();
  var prefs = get('sv_prefs', { area: '', topics: [] });
  var desk = window.matchMedia ? window.matchMedia('(min-width: 1000px)') : { matches: false };

  var asks = D.asks.slice(), tallies = {}, mine = {}, notes = {}, people = 0, loaded = false;
  var arriving = D.focus || (location.hash || '').slice(1);
  var view = mode === 'page' && !only && !desk.matches && !arriving ? 'one' : 'list', topic = 'all', sort = 'wanted', topSort = 'votes', openId = null, focusId = D.focus || (location.hash || '').slice(1) || null, deckSkip = {}, deckShown = null;
  var reported = {}, pending = {}, hintId = null, hinted = false;
  var live = { hour: 0, day: 0, today: {} }, trending = {}, advT = null, autoId = null, autoAt = 0, grown = {};
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var expanded = {}, sug = { id: null, text: '', busy: false, msg: '', same: '' };
  var SHOW = 6, MAX_OPTIONS = 12; // answers shown before "Show more"; most answers a question can have
  // The order is frozen while someone is answering, so rows never jump under their finger. It is worked out again only
  // when they change the sort, filter or neighbourhood, or come back to the page.
  var order = null, shortOrder = null, touched = false;
  var UNLOCK = 5; // answers before the Top 10 board opens
  var STATUS = D.statuses, HOODS = D.hoods, TOPIC = {};
  D.topics.forEach(function (t) { TOPIC[t.key] = t.label; });
  function byId(id) { for (var i = 0; i < asks.length; i++) if (asks[i].id === id) return asks[i]; return null; }
  function t(id) { return tallies[id] || { y: 0, n: 0, m: 0, areas: {} }; }
  function pct(n, d) { return d ? Math.round((100 * n) / d) : 0; }
  // Yes / no asks have two answers; multiple choice asks ("kind": "choice") have their own options. Everyone can pick
  // Don't mind (m), which is counted and shown but left out of the shares.
  var YESNO = [{ key: 'y', label: 'Yes' }, { key: 'n', label: 'No' }];
  function isChoice(a) { return a.kind === 'choice' && a.options; }
  function opts(a) { return (isChoice(a) ? a.options : YESNO).concat(a.extra || []); }
  // A yes / no ask that residents have added answers to is shown like a multiple choice one.
  function multi(a) { return isChoice(a) || !!(a.extra && a.extra.length); }
  // The answers on screen: all of them up to 6, then the first 6 unless the list is open (or your pick is further down).
  function shown(a) {
    var o = opts(a);
    if (o.length <= SHOW || expanded[a.id]) return o;
    var my = mine[a.id], v = o.slice(0, SHOW);
    return my && my !== 'm' && !v.some(function (x) { return x.key === my; }) ? o : v;
  }
  function col(a, k) { if (!isChoice(a) && (k === 'y' || k === 'n')) return k; var o = opts(a); for (var i = 0; i < o.length; i++) if (o[i].key === k) return 'o' + ((i % 8) + 1); return 'm'; }
  function isExtra(a, o) { return (a.extra || []).indexOf(o) > -1; }
  function c(x, k) { return (x && x[k]) || 0; }
  function total(x) { var n = 0; for (var k in x) if (k !== 'areas') n += x[k] || 0; return n; }
  function opinions(a, x) { return opts(a).reduce(function (s, o) { return s + c(x, o.key); }, 0); }
  function ranked(a, x) { return opts(a).slice().sort(function (p, q) { return c(x, q.key) - c(x, p.key); }); }
  function labelOf(a, k) { if (k === 'm') return 'Don’t mind'; var o = opts(a).filter(function (o) { return o.key === k; })[0]; return o ? o.label : k; }
  // Most wanted: the share of yes among yes and no; for a multiple choice ask, the share of its most picked option.
  function score(a) { var x = t(a.id), o = opinions(a, x); return o ? (isChoice(a) ? c(x, ranked(a, x)[0].key) : c(x, 'y')) / o : -1; }
  // Where Squamish stands, in words for a share: "87% say yes" or "“Freeze it” leads with 62%" (same as api/_wants-ask.js).
  function standing(a) { var x = t(a.id), o = opinions(a, x); if (!o) return ''; if (!multi(a)) return pct(c(x, 'y'), o) + '% say yes'; var top = ranked(a, x)[0]; return '“' + top.label + '” leads with ' + pct(c(x, top.key), o) + '%'; }
  // How evenly split: 1 means the top two answers are tied.
  // How close to everyone agreeing: the share of the leading answer (yes or no alike), left out don't mind.
  function agreement(a) { var x = t(a.id), o = opinions(a, x); return o ? c(x, ranked(a, x)[0].key) / o : -1; }
  function splitness(a) { var x = t(a.id), o = opinions(a, x), r = ranked(a, x); return o && c(x, r[1].key) ? 1 - (c(x, r[0].key) - c(x, r[1].key)) / o : -1; }
  function done() { return asks.filter(function (a) { return mine[a.id]; }).length; }
  function infoLink(a, cls) { return a.info ? '<a class="' + (cls || 'wa-info') + '" href="/wants/' + esc(a.id) + '/info/">More info <span aria-hidden="true">›</span></a>' : ''; }
  function linkOf(a) { return location.origin + '/wants/' + a.id + '/'; }
  // Up to 5 answers for "My picks": the things they want first (yes, or a pick on a multiple choice ask), then their nos.
  function picks() {
    var a = asks.filter(function (x) { var k = mine[x.id]; return k && k !== 'm' && k !== 'n'; });
    var b = asks.filter(function (x) { return mine[x.id] === 'n'; });
    return a.concat(b).slice(0, 5);
  }
  // Where your answer stands, in a few words: with the most picked answer, outnumbered, or first.
  function verdict(a) {
    var my = mine[a.id], x = t(a.id), o = opinions(a, x);
    if (!my) return '';
    if (my === 'm') { var st = standing(a); return st ? 'Most took a side: ' + esc(st) : 'No one has taken a side yet'; }
    if (o <= 1) return 'You’re the first to answer this one';
    var p = pct(c(x, my), o), top = c(x, ranked(a, x)[0].key);
    return c(x, my) >= top ? 'You’re with <b>' + p + '% of Squamish</b>' : 'Only <b>' + p + '% agree</b> with you';
  }
  // My Squamish: how many answers match the most picked one, the boldest take, and the neighbourhood that answers most
  // like you (only neighbourhoods with 5 or more answers on an ask are in the totals, and at least 3 asks must compare).
  function meStats() {
    var agree = 0, of = 0, bold = null, hoods = {};
    asks.forEach(function (a) {
      var my = mine[a.id], x = t(a.id), o = opinions(a, x);
      if (!my || my === 'm' || !o) return;
      var top = c(x, ranked(a, x)[0].key), share = pct(c(x, my), o);
      of++; if (c(x, my) >= top) agree++;
      if (share < 50 && c(x, my) < top && (!bold || share < bold.share)) bold = { a: a, share: share };
      Object.keys(x.areas || {}).forEach(function (h) {
        if (h === 'outside') return;
        var ar = x.areas[h], best = opts(a).slice().sort(function (p, q) { return c(ar, q.key) - c(ar, p.key); })[0];
        if (!best || !c(ar, best.key)) return;
        var hs = hoods[h] || (hoods[h] = { same: 0, n: 0 }); hs.n++; if (c(ar, my) >= c(ar, best.key)) hs.same++;
      });
    });
    var hood = Object.keys(hoods).filter(function (h) { return hoods[h].n >= 3 && HOODS[h]; }).sort(function (p, q) { return hoods[q].same / hoods[q].n - hoods[p].same / hoods[p].n || hoods[q].n - hoods[p].n; })[0] || '';
    return { agree: agree, of: of, bold: bold, hood: hood };
  }
  function meSpec() { return asks.filter(function (a) { return mine[a.id] && mine[a.id] !== 'm'; }).map(function (a) { return a.id + '.' + mine[a.id]; }).join(','); }
  function meCard() {
    var m = meStats(); if (!m.of) return '';
    return '<div class="wa-me"><span class="wa-me-k">My Squamish</span><p class="wa-me-big">I agree with Squamish on <b>' + m.agree + ' of ' + m.of + '</b></p>' +
      (m.bold ? '<p class="wa-me-row"><span>Boldest take</span><b>' + (mine[m.bold.a.id] !== 'y' && mine[m.bold.a.id] !== 'n' ? esc(m.bold.a.title) + ' “' + esc(labelOf(m.bold.a, mine[m.bold.a.id])) + '”' : esc(labelOf(m.bold.a, mine[m.bold.a.id])) + ': ' + esc(m.bold.a.title)) + ' <em>only ' + m.bold.share + '% agree</em></b></p>' : '') +
      (m.hood ? '<p class="wa-me-row"><span>Answers most like</span><b>' + esc(HOODS[m.hood]) + '</b></p>' : '') + '</div>';
  }
  function allAnswers() { return asks.reduce(function (s, a) { return s + total(t(a.id)); }, 0); }
  var NATIVE = !!navigator.share;
  // Before sharing, an answered ask stays calm: a single Share button. Everything else (the picture, the switch, the
  // buttons) is in the share panel that opens from it.
  function shareBar(a) {
    return '<div class="wa-shareline"><button type="button" class="wa-sharego" data-share="' + esc(a.id) + '">' + SHARE_ICON + 'Share</button></div>';
  }
  function picksBar() {
    if (!picks().length) return '';
    return '<div class="wa-shareline wa-picksline"><p><b>Your picks in one picture</b>, with how many agree on each.</p><button type="button" class="wa-sharego" data-share="@my">' + SHARE_ICON + 'Share my picks</button></div>';
  }
  var SHARE_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';

  // ---------- share panel ----------
  // Opens from Share: a preview of the exact picture Facebook will show (the same address, so the sharer sees what gets
  // posted), a "Show my answer" switch, then Post in a Facebook group. Facebook won't let a site fill in a post, so that
  // copies a ready caption with the numbers plus the link, and the panel says to paste it in the group.
  // Each link carries ?n= (the answer count right now), a new address per moment, so Facebook draws a fresh picture with
  // the live results instead of reusing an old one. Facebook never updates a picture after posting.
  var shareSt = null, NATIVE_LABEL = 'Text or other apps';
  function shareInfo(st) {
    if (st.id === '@me') {
      var ms = meStats(), sp = meSpec(), nn = allAnswers(), tail = (ms.hood ? '&hd=' + ms.hood : '') + '&n=' + nn;
      return { title: 'Share My Squamish', img: '/api/og/?me=' + encodeURIComponent(sp) + '&v=1' + tail, url: location.origin + '/wants/me/?a=' + sp + tail,
        text: 'I agree with Squamish on ' + ms.agree + ' of ' + ms.of + '.' + (ms.bold ? ' My boldest take: only ' + ms.bold.share + '% agree with me on “' + ms.bold.a.title.replace(/[?.!]$/, '') + '”.' : '') + ' Took 2 minutes. Where do you land?', what: 'me' };
    }
    if (st.id === '@my') {
      var spec = picks().map(function (x) { return x.id + '.' + mine[x.id]; }).join(','), n = allAnswers();
      var url = location.origin + '/wants/my/?a=' + spec + '&n=' + n;
      return { title: 'Share your picks', img: '/api/og/?my=' + encodeURIComponent(spec) + '&v=2&n=' + n, url: url, text: 'Here’s what I want for Squamish. What do you want?', what: 'picks' };
    }
    var a = byId(st.id); if (!a) return null;
    var my = mine[a.id], x = t(a.id), n = total(x), q = a.title.replace(/[?.!]?$/, '?'), now = standing(a);
    if (!my) return { title: 'Share this question', img: '/api/og/?id=' + encodeURIComponent(a.id) + '&v=1', url: linkOf(a), text: q + (isChoice(a) ? ' Pick your answer' : ' Say yes, no or don’t mind') + ' on What Squamish Wants.', what: 'question' };
    var show = st.show, base = linkOf(a) + (show ? 'said/' + encodeURIComponent(my) + '/' : 'live/') + '?n=' + n;
    var mineTxt = !show ? '' : my === 'm' ? ' I don’t mind either way.' : ' I said “' + labelOf(a, my) + '”.';
    return { title: 'Share this question', url: base, what: show ? 'answer' : 'results', toggle: true, my: my,
      img: '/api/og/?id=' + encodeURIComponent(a.id) + (show ? '&said=' + encodeURIComponent(my) : '&live=1') + '&v=3&n=' + n,
      text: q + (now ? ' So far ' + now + ' (' + n + ' answer' + (n === 1 ? '' : 's') + ').' : '') + mineTxt + ' Where do you stand?' };
  }
  function drawShare() {
    var el = $('[data-wa-share]');
    if (!el) { el = document.createElement('div'); el.className = 'wa-modal'; el.setAttribute('data-wa-share', ''); root.appendChild(el); }
    if (!shareSt) { el.hidden = true; el.innerHTML = ''; document.documentElement.classList.remove('wa-noscroll'); return; }
    var x = shareInfo(shareSt); if (!x) { shareSt = null; return drawShare(); }
    var h;
    if (shareSt.stage === 'copied') {
      h = '<div class="wa-done"><span class="wa-tick" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></span><h2 id="wa-share-h">' + (shareSt.copied ? 'Copied. Paste it in your Facebook group.' : 'Copy this, then paste it in your Facebook group.') + '</h2></div>' +
        // A look at the post they're about to paste: the caption, then the link card Facebook draws from the link.
        '<div class="wa-post">' + (shareSt.copied ? '<p class="wa-posttext">' + esc(x.text) + '</p>' : '<textarea id="wa-cap" class="wa-cap" rows="4" readonly aria-label="Your post">' + esc(x.text + '\n' + x.url) + '</textarea>') +
        '<div class="wa-postcard"><img src="' + esc(x.img) + '" alt="The picture your post will show" width="1200" height="630"><small>squamishvoters.com</small></div></div>' +
        '<a class="wa-big fb" href="https://www.facebook.com/groups/feed/" target="_blank" rel="noopener">' + FB + 'Open Facebook</a>' +
        '<p class="wa-postlinks"><button type="button" class="wa-link" data-sharex>Done</button><span aria-hidden="true">·</span><button type="button" class="wa-link" data-sharefb>Use Facebook’s share window</button></p>';
    } else {
      h = '<div class="wa-modalhead"><h2 id="wa-share-h">' + x.title + '</h2><button type="button" class="wa-x" data-sharex aria-label="Close">×</button></div>' +
        '<div class="wa-preview"><img src="' + esc(x.img) + '" alt="The picture your post will show" width="1200" height="630"></div>' +
        (x.toggle ? '<button type="button" class="wa-toggle" data-sharetoggle role="switch" aria-checked="' + shareSt.show + '"><span><b>Show my answer</b><small>' + (shareSt.show ? 'The picture says what you answered' : 'Only the results show') + '</small></span><i aria-hidden="true"></i></button>' : '') +
        '<button type="button" class="wa-big fb" data-sharepost>' + FB + 'Post in a Facebook group</button>' +
        '<div class="wa-twobtn"><button type="button" class="wa-big ghost" data-sharecopy>Copy link</button>' + (NATIVE ? '<button type="button" class="wa-big ghost" data-sharenative>' + NATIVE_LABEL + '</button>' : '') + '</div>';
    }
    el.innerHTML = '<div class="wa-backdrop" data-sharex></div><div class="wa-panel" role="dialog" aria-modal="true" aria-labelledby="wa-share-h">' + h + '</div>';
    el.hidden = false; document.documentElement.classList.add('wa-noscroll');
  }
  var FB = '<span class="wa-fbf" aria-hidden="true">f</span>';
  function openShare(id) {
    stopAuto(); shareSt = { id: id, show: true, stage: 'pick' }; drawShare(); track('Wants share open', { what: id === '@my' ? 'picks' : id === '@me' ? 'me' : 'ask' });
    var x = el$('.wa-panel button'); if (x) x.focus({ preventScroll: true });
    // Fresh totals first, so the caption's numbers match the picture Facebook draws a moment later.
    fetch('/api/wants/?voter=' + encodeURIComponent(voter)).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.tallies && shareSt && shareSt.stage === 'pick') { Object.keys(j.tallies).forEach(function (k) { tallies[k] = j.tallies[k]; }); drawShare(); }
    }).catch(function () {});
  }
  function el$(sel) { return root.querySelector('[data-wa-share] ' + sel); }
  function copyText(text) { return navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(); }

  // ---------- pieces ----------
  function chips(a) {
    var s = STATUS[a.res ? 'resident' : a.status] || STATUS.none;
    return '<span class="wa-chips"><span class="wa-chip ' + s.cls + '">' + esc(s.label) + '</span>' + (a.area && HOODS[a.area] ? '<span class="wa-chip area">' + esc(HOODS[a.area]) + '</span>' : '') + '</span>';
  }
  function bar(a, x) {
    var n = total(x);
    if (!n) return '<p class="wa-first">No answers yet. Yours is the first.</p>';
    var segs = multi(a) ? opts(a).map(function (o) { return [col(a, o.key), o.label, c(x, o.key)]; }).concat([['m', 'don’t mind', c(x, 'm')]])
      : [['y', 'yes', c(x, 'y')], ['m', 'don’t mind', c(x, 'm')], ['n', 'no', c(x, 'n')]];
    return '<div class="wa-bar" role="img" aria-label="' + esc(segs.map(function (g) { return pct(g[2], n) + '% ' + g[1]; }).join(', ')) + '">' +
      segs.map(function (g) { return '<i class="' + g[0] + '" style="width:' + pct(g[2], n) + '%"></i>'; }).join('') + '</div>';
  }
  function totals(a) {
    var x = t(a.id), n = total(x), o = opinions(a, x);
    var out = '<div class="wa-totals">' + bar(a, x);
    if (n && multi(a)) {
      var sh = shown(a), more = opts(a).length - sh.length;
      out += '<ul class="wa-optlegend">' + sh.map(function (op) { return '<li><i class="dot ' + col(a, op.key) + '"></i><span>' + esc(op.label) + (isExtra(a, op) ? ' <small class="wa-added">added by a resident</small>' : '') + '</span><b>' + pct(c(x, op.key), o) + '%</b></li>'; }).join('') + '</ul>' +
        (more ? '<button type="button" class="wa-link" data-more="' + esc(a.id) + '">Show ' + more + ' more answer' + (more === 1 ? '' : 's') + '</button>' : '') +
        '<p class="wa-legend"><span>' + n + ' answer' + (n === 1 ? '' : 's') + '</span><span>' + c(x, 'm') + ' don’t mind</span><span>Shares leave out don’t mind</span></p>';
    } else if (n) out += '<p class="wa-legend"><em>' + (o ? '<b>' + pct(c(x, 'y'), o) + '% yes</b> of people with an opinion' : '<b>No one has said yes or no yet</b>') + '</em>' +
      '<span>' + n + ' answer' + (n === 1 ? '' : 's') + '</span><span>' + c(x, 'y') + ' yes · ' + c(x, 'n') + ' no · ' + c(x, 'm') + ' don’t mind</span></p>';
    // Share sits under the results once someone has answered; an opened ask has it in its detail instead.
    return out + (mine[a.id] ? shareBar(a) : '') + areaBox(a) + '</div>';
  }
  // After the first answer: which part of Squamish, asked inside that ask (under its results) so nothing covers the list.
  var areaAsk = null;
  function areaBox(a) {
    if (areaAsk !== a.id || prefs.area) return '';
    return '<div class="wa-areaq"><button type="button" class="wa-sheetx" data-areax aria-label="Close">×</button><p><b>Which part of Squamish do you live in?</b> We’ll show how your area answered. Optional, and saved on this phone only.</p><select data-wa-sheetarea><option value="">Choose your area</option>' + Object.keys(HOODS).map(function (k) { return '<option value="' + esc(k) + '">' + esc(HOODS[k]) + '</option>'; }).join('') + '</select></div>';
  }
  function canAdd(a) { return opts(a).length < MAX_OPTIONS; }
  // "Other": write in an answer that isn't there. Opens right under the answer buttons.
  function sugBox(a) {
    if (!canAdd(a) || sug.id !== a.id) return '';
    var same = sug.same && labelOf(a, sug.same);
    return '<div class="wa-sug"><label class="fld" for="wa-sug">What’s your answer?<span class="small">Write it in a few words. If it’s new, it’s added for everyone and counted as your answer. If it means the same as one already there, we’ll point you to it.</span></label>' +
      '<div class="wa-sugrow"><input id="wa-sug" type="text" maxlength="300" autocomplete="off" value="' + esc(sug.text) + '" placeholder="Your answer"><button type="button" class="btn" data-sugsend' + (sug.busy ? ' disabled' : '') + '>' + (sug.busy ? 'Checking…' : 'Add') + '</button></div>' +
      (same ? '<p class="wa-msg">That’s already an answer: <b>' + esc(same) + '</b>. <button type="button" class="wa-link" data-ans="' + esc(sug.same) + '" data-id="' + esc(a.id) + '">Pick that one</button></p>' : '') +
      (sug.msg ? '<p class="wa-msg bad">' + esc(sug.msg) + '</p>' : '') +
      '<button type="button" class="wa-link" data-sugx>Cancel</button></div>';
  }
  // The closed door: a blurred bar that hints there is a result behind it, without giving anything away.
  function tease(a) {
    return '<button type="button" class="wa-tease' + (multi(a) ? ' choice' : '') + '" data-open="' + esc(a.id) + '"><span class="wa-tease-bar" aria-hidden="true"><i></i><i></i><i></i></span><span class="wa-tease-t">Answer to see what Squamish said</span></button>';
  }
  var WORD = { y: 'Yes', n: 'No', m: 'Don’t mind' };
  function buttons(a, big) {
    var my = mine[a.id];
    if (multi(a)) {
      var sh = shown(a), more = opts(a).length - sh.length;
      return '<div class="wa-ans choice n' + sh.length + (big ? ' big' : '') + '" role="group" aria-label="Your answer">' + sh.map(function (o, i) {
        return '<button type="button" class="wa-b opt" data-ans="' + esc(o.key) + '" data-id="' + esc(a.id) + '" aria-pressed="' + (my === o.key) + '">' + (big && desk.matches && i < 9 ? '<kbd>' + (i + 1) + '</kbd> ' : '') + esc(o.label) + '</button>';
      }).join('') + (more ? '<button type="button" class="wa-more" data-more="' + esc(a.id) + '">Show ' + more + ' more answer' + (more === 1 ? '' : 's') + ', most picked first</button>' : '') +
        '<div class="wa-ans-extra"><button type="button" class="wa-b m" data-ans="m" data-id="' + esc(a.id) + '" aria-pressed="' + (my === 'm') + '">Don’t mind</button>' +
        (canAdd(a) ? '<button type="button" class="wa-b other" data-sug="' + esc(a.id) + '" aria-expanded="' + (sug.id === a.id) + '">Other…</button>' : '') + '</div></div>';
    }
    return '<div class="wa-ans' + (big ? ' big' : '') + '" role="group" aria-label="Your answer">' + ['y', 'n', 'm'].map(function (k) {
      return '<button type="button" class="wa-b ' + k + '" data-ans="' + k + '" data-id="' + esc(a.id) + '" aria-pressed="' + (my === k) + '">' + WORD[k] + '</button>';
    }).join('') + (canAdd(a) && (big || openId === a.id) ? '<button type="button" class="wa-otherline" data-sug="' + esc(a.id) + '" aria-expanded="' + (sug.id === a.id) + '">Other answer…</button>' : '') + '</div>';
  }
  function detail(a) {
    var s = STATUS[a.res ? 'resident' : a.status] || STATUS.none;
    var who = a.res ? '' : '<dt>Who decides</dt><dd>' + (a.who === 'province' ? 'The Province. Council can press for it.' : 'Squamish council') + '</dd>';
    var ns = notes[a.id] || [];
    return '<div class="wa-detail">' +
      (a.why ? '<p>' + esc(a.why) + '</p>' : '') +
      '<dl><dt>Where it stands</dt><dd><span class="wa-chip ' + s.cls + '">' + esc(s.label) + '</span> ' + esc(s.explain || '') + '</dd>' + who +
      '<dt>Topic</dt><dd>' + esc(TOPIC[a.topic] || 'Everything else') + '</dd>' +
      (a.other_side ? '<dt>The other side</dt><dd>' + esc(a.other_side) + '</dd>' : '') +
      (multi(a) ? '<dt>' + (isChoice(a) ? 'What each answer means' : 'Answers residents added') + '</dt><dd><ul class="wa-means">' + (isChoice(a) ? opts(a) : a.extra).map(function (o) {
        var rk = a.id + '#' + o.key;
        return '<li><b>' + esc(o.label) + ':</b> ' + esc(o.means || '') + (isExtra(a, o) ? ' <span class="small muted">Added by a resident.</span> ' + (reported[rk] ? '<span class="small muted">Thanks, reported.</span>' : '<button type="button" class="wa-link muted" data-optreport="' + esc(rk) + '">Report</button>') : '') + '</li>';
      }).join('') + '</ul></dd>' : '') +
      (a.source_url ? '<dt>Source</dt><dd><a href="' + esc(a.source_url) + '"' + (/^https?:/.test(a.source_url) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(a.source_label || 'Source') + '</a></dd>' : '') + '</dl>' +
      (a.res && a.body ? '<div class="wa-words"><b>In the words of the resident who added it</b><p>' + esc(a.body) + '</p></div>' : '') +
      (ns.length ? '<div class="wa-words"><b>More from residents</b>' + ns.slice(0, 20).map(function (n) { return '<p>' + esc(n.text) + '</p>'; }).join('') + '</div>' : '') +
      (a.info && !only ? '<p class="wa-infobig">' + infoLink(a, 'btn secondary') + '<span class="small muted">The facts, the timeline and the case for each answer.</span></p>' : '') +
      '<p class="wa-acts"><button type="button" class="wa-link" data-share="' + esc(a.id) + '">Share this ask</button>' +
      (a.res ? (reported[a.id] ? '<span class="small muted">Thanks, reported.</span>' : '<button type="button" class="wa-link muted" data-report="' + esc(a.id) + '">Report</button>') : '') +
      '<button type="button" class="wa-link" data-open="' + esc(a.id) + '">Close</button></p>' +
      '</div>';
  }
  // Small labels on a closed row: New (a resident added it in the last 3 days), Trending (most answers today), Done.
  function badges(a) {
    var b = '';
    if (a.status === 'done') b += '<span class="wa-chip done">Done</span>';
    if (trending[a.id]) b += '<span class="wa-badge hot">Trending</span>';
    if (a.res && Date.now() - (Date.parse(a.created_at) || 0) < 3 * 864e5) b += '<span class="wa-badge new">New</span>';
    return b ? '<span class="wa-chips">' + b + '</span>' : '';
  }
  var LOCK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  // Under a closed, unanswered row: how many answered (tap to open it) and More info.
  function closedLine(a) {
    var n = total(t(a.id));
    return '<div class="wa-under"><button type="button" class="wa-count" data-open="' + esc(a.id) + '">' + LOCK + (loaded ? (n ? n + ' answered' : 'Be the first to answer') : 'Answer to see results') + '<span class="visually-hidden">. Answer to see the results</span></button>' + (only ? '' : infoLink(a)) + '</div>';
  }
  // Under a closed, answered row: a thin results bar, where you stand, Share and More info.
  function answeredLine(a) {
    return '<div class="wa-res">' + bar(a, t(a.id)) + '<div class="wa-resrow"><p class="wa-verdict">' + verdict(a) + '<span class="wa-n">' + total(t(a.id)).toLocaleString('en-CA') + (total(t(a.id)) === 1 ? ' person' : ' people') + ' answered</span></p>' +
      '<span class="wa-resacts">' + (only ? '' : infoLink(a)) + '<button type="button" class="wa-sharego small" data-share="' + esc(a.id) + '">' + SHARE_ICON + 'Share</button></span></div></div>' + areaBox(a);
  }
  function row(a) {
    var my = mine[a.id], open = openId === a.id, show = my || open;
    return '<li class="wa-row' + (multi(a) ? ' choice' : '') + (my ? ' answered' : '') + (open ? ' open' : '') + (focusId === a.id ? ' arrived' : '') + '" id="ask-' + esc(a.id) + '">' +
      '<button type="button" class="wa-title" data-open="' + esc(a.id) + '" aria-expanded="' + open + '">' + (open ? chips(a) : badges(a)) + '<span class="wa-t">' + esc(a.title) + '</span></button>' +
      (D.said && D.said.id === a.id ? '<p class="wa-saidby">A neighbour shared this' + (D.said.label ? '. They said <b>' + esc(D.said.label) + '</b>' : ' question') + '.' + (loaded && total(t(a.id)) ? ' <b>' + total(t(a.id)) + ' people</b> have answered so far.' : '') + ' What do you say?</p>' : '') +
      buttons(a) + sugBox(a) + (hintId === a.id && mine[a.id] ? '<p class="wa-hint">Tap your answer again to undo it.</p>' : '') +
      (open ? totals(a) + detail(a) : my ? answeredLine(a) : closedLine(a)) + '</li>';
  }

  // ---------- list ----------
  function listed() {
    if (order) return order.map(byId).filter(Boolean);
    var area = prefs.area;
    var L = asks.filter(function (a) {
      if (topic === 'all') return true;
      if (topic === 'near') return area && a.area === area;
      if (topic === 'todo') return !mine[a.id];
      return a.topic === topic;
    });
    var key = {
      wanted: function (a) { return score(a) * 1e6 + opinions(a, t(a.id)); },
      split: function (a) { var sp = splitness(a); return sp < 0 ? -1 : sp * 1e6 + opinions(a, t(a.id)); },
      voted: function (a) { return total(t(a.id)); },
      newest: function (a) { return a.res ? Date.parse(a.created_at) || 0 : -1; },
    }[sort];
    L.sort(function (p, q) { return key(q) - key(p); });
    if (focusId) { var f = byId(focusId); if (f && L.indexOf(f) > -1) { L.splice(L.indexOf(f), 1); L.unshift(f); } }
    order = L.map(function (a) { return a.id; });
    return L;
  }
  function drawList() {
    var el = $('[data-wa-rows]'); if (!el) return;
    var L = listed();
    $('[data-wa-count]').textContent = L.length + ' ask' + (L.length === 1 ? '' : 's');
    el.innerHTML = L.length ? L.map(row).join('') : '<li class="wa-empty">' + (topic === 'near' && !prefs.area ? 'Pick your area in the box above to see asks near you.' : topic === 'todo' ? 'You’ve answered every ask on this list. Thank you.' : 'Nothing here yet. Add one below.') + '</li>';
  }

  // ---------- one by one ----------
  function deck() {
    var area = prefs.area;
    return asks.filter(function (a) { return !mine[a.id] && !deckSkip[a.id]; }).sort(function (p, q) {
      var lp = p.area && p.area === area ? 0 : 1, lq = q.area && q.area === area ? 0 : 1;
      return lp - lq || total(t(p.id)) - total(t(q.id));
    });
  }
  // One by one, after answering: where you stand, then a bar per answer (yours marked), biggest first.
  function reveal(a) {
    var x = t(a.id), n = total(x), o = opinions(a, x), my = mine[a.id];
    var rows = ranked(a, x).filter(function (op) { return c(x, op.key) || op.key === my; }).slice(0, 6);
    return '<p class="wa-bigverdict">' + verdict(a) + '</p><div class="wa-bars">' + rows.map(function (op) {
      var p = pct(c(x, op.key), o);
      return '<div class="wa-brow' + (op.key === my ? ' mine' : '') + '"><span class="wa-blab"><span>' + esc(op.label) + (op.key === my ? ' <em>you</em>' : '') + '</span><b>' + p + '%</b></span><span class="wa-btrack"><i class="wa-fill" data-w="' + p + '" style="width:' + (REDUCED || grown[a.id] ? p : 0) + '%"></i></span></div>';
    }).join('') + '</div><p class="wa-legend"><span>' + n + ' answer' + (n === 1 ? '' : 's') + '</span><span>' + c(x, 'm') + ' don’t mind' + (my === 'm' ? ', you too' : '') + '</span></p>' +
      shareBar(a) + areaBox(a);
  }
  // After an answer in One by one, the next card comes up by itself unless they touch the card, open Share, or a
  // question about their area is waiting.
  var AUTO_MS = 3200;
  function startAuto(id) { stopAuto(); autoId = id; autoAt = Date.now(); advT = setTimeout(function () { advT = null; autoId = null; if (view === 'one' && !shareSt && !sheet) { deckShown = null; drawOne(); drawProgress(); } }, AUTO_MS); }
  function stopAuto() { if (advT) clearTimeout(advT); advT = null; autoId = null; var cd = root.querySelector('.wa-card.auto'); if (cd) cd.classList.remove('auto'); }
  var KEYS_CHOICE = '<p class="wa-keys">On a keyboard: <kbd>1</kbd> to <kbd>4</kbd> pick an answer, <kbd>M</kbd> don’t mind, <kbd>→</kbd> skip</p>';
  var KEYS = '<p class="wa-keys">On a keyboard: <kbd>Y</kbd> yes, <kbd>N</kbd> no, <kbd>M</kbd> don’t mind, <kbd>→</kbd> skip</p>';
  function drawOne() {
    var el = $('[data-wa-one]'); if (!el) return;
    var d = done();
    var prog = '<div class="wa-prog" aria-hidden="true"><i style="width:' + pct(d, asks.length) + '%"></i></div><p class="small muted">' + d + ' of ' + asks.length + ' answered</p>';
    var a = deckShown && byId(deckShown);
    if (a && mine[a.id]) {
      el.innerHTML = prog + '<div class="wa-card wa-revealed' + (autoId === a.id ? ' auto' : '') + '">' + chips(a) + '<h2>' + esc(a.title) + '</h2>' + reveal(a) +
        '<div class="wa-timer" aria-hidden="true"><i style="animation-duration:' + AUTO_MS + 'ms;animation-delay:-' + (autoId === a.id ? Date.now() - autoAt : 0) + 'ms"></i></div><div class="wa-nextrow">' + (a.info ? infoLink(a) : '') + '<button type="button" class="btn" data-next>Next question <span aria-hidden="true">→</span></button></div>' +
        (desk.matches ? '<p class="wa-keys">Press <kbd>Enter</kbd> for the next ask</p>' : '') + '</div>';
      // The bars grow from zero once they're on screen.
      grown[a.id] = true;
      requestAnimationFrame(function () { requestAnimationFrame(function () { el.querySelectorAll('.wa-fill[data-w]').forEach(function (f) { f.style.width = f.getAttribute('data-w') + '%'; }); }); });
      return;
    }
    var L = deck(); a = L[0];
    if (!a) { el.innerHTML = prog + '<div class="wa-card wa-done"><h2>That’s every ask for now.</h2><p>New ones go up as residents add them.</p>' + meCard() + (meStats().of ? '<button type="button" class="wa-sharego" data-share="@me">' + SHARE_ICON + 'Share My Squamish</button>' : '') + '<button type="button" class="btn block" data-view="top">See the Top 10</button><button type="button" class="btn secondary block" data-view="add">Missing something? Add it</button></div>'; return; }
    deckShown = a.id;
    el.innerHTML = prog + '<div class="wa-card">' + chips(a) + '<h2>' + esc(a.title) + '</h2>' + (a.why ? '<p>' + esc(a.why) + '</p>' : '') + (a.info ? '<p class="wa-onelink">' + infoLink(a) + '</p>' : '') + buttons(a, true) + sugBox(a) +
      '<button type="button" class="wa-link center" data-skip="' + esc(a.id) + '">Skip this one</button>' + (desk.matches ? (multi(a) ? KEYS_CHOICE : KEYS) : '') + '</div>';
  }

  // ---------- top 10 (opens after 5 answers) ----------
  function drawTop() {
    var el = $('[data-wa-top]'); if (!el) return;
    var d = done();
    if (d < UNLOCK) {
      el.innerHTML = '<div class="wa-card wa-locked"><p class="wa-lockicon" aria-hidden="true">🔒</p><h2>Answer ' + (UNLOCK - d) + ' more to open the Top 10</h2><p>The results board shows the most answered, most unanimous and most split asks in Squamish. It opens once you’ve answered ' + UNLOCK + ', so everyone answers before they look.</p><div class="wa-prog" aria-hidden="true"><i style="width:' + pct(d, UNLOCK) + '%"></i></div><button type="button" class="btn block" data-view="list">Keep answering</button></div>';
      return;
    }
    var withAns = asks.filter(function (a) { return opinions(a, t(a.id)) > 0; });
    // Most votes by default; ties go to the ask with more yes or no answers.
    var by = { votes: function (a) { return total(t(a.id)); }, unanimous: agreement, split: splitness }[topSort];
    var top = withAns.filter(function (a) { return by(a) >= 0; }).sort(function (p, q) { return (by(q) - by(p)) || (opinions(q, t(q.id)) - opinions(p, t(p.id))); }).slice(0, 10);
    var NOTE = {
      votes: 'The asks the most people have answered. Tap one to answer or see more.',
      unanimous: 'Where people agree most: the share of the leading answer among people who took a side, yes or no alike. Tap one to answer or see more.',
      split: 'Closest to an even split between the top two answers. Tap one to answer or see more.',
    };
    function line(a, i) {
      var x = t(a.id), o = opinions(a, x), lead = ranked(a, x)[0], my = mine[a.id];
      return '<li><button type="button" class="wa-topline" data-goto="' + esc(a.id) + '"><span class="wa-rank">' + (i + 1) + '</span><span class="wa-topbody"><span class="wa-topt">' + esc(a.title) + '</span>' + bar(a, x) +
        '<span class="wa-legend"><em>' + (isChoice(a) ? 'Most picked: <b>' + esc(lead.label) + '</b> (' + pct(c(x, lead.key), o) + '%)' : (c(x, 'n') > c(x, 'y') ? '<b>' + pct(c(x, 'n'), o) + '% no</b>' : '<b>' + pct(c(x, 'y'), o) + '% yes</b>')) + '</em><span>' + total(x) + ' answer' + (total(x) === 1 ? '' : 's') + '</span>' +
        (my ? '<span>' + (my === 'm' ? 'You don’t mind' : multi(a) ? 'You picked “' + esc(labelOf(a, my)) + '”' : 'You said ' + WORD[my].toLowerCase()) + '</span>' : '') + '</span></span></button></li>';
    }
    var sortBtns = '<div class="wa-filters wa-topsort" role="group" aria-label="Sort the Top 10">' + [['votes', 'Most votes'], ['unanimous', 'Most unanimous'], ['split', 'Most split']].map(function (o) {
      return '<button type="button" class="wa-f" data-wa-topsort="' + o[0] + '" aria-pressed="' + (topSort === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
    el.innerHTML = '<div class="wa-board"><h2>Top 10</h2>' + sortBtns + '<p class="small muted">' + NOTE[topSort] + '</p><ol class="wa-toplist">' + (top.length ? top.map(line).join('') : '<li class="wa-empty">' + (topSort === 'split' ? 'No ask has answers on both sides yet.' : 'No answers yet.') + '</li>') + '</ol>' +
      '<p class="small muted">Not a scientific poll. ' + people + ' people have answered so far.</p>' +
      // My Squamish only shows when they ask for it (Jeff: no popup), here and in the desktop rail.
      (meStats().of ? '<div class="wa-shareline wa-picksline"><p><b>My Squamish:</b> how your answers line up with everyone’s, as a picture.</p><button type="button" class="wa-sharego" data-share="@me">' + SHARE_ICON + 'Share</button></div>' : '') + '</div>';
  }

  // ---------- add ----------
  var add = { text: '', res: null, stage: 'write', msg: '' };
  function areaSelect(sel) {
    return '<select data-wa-newarea><option value="all">The whole town</option>' + Object.keys(HOODS).filter(function (k) { return k !== 'outside'; }).map(function (k) { return '<option value="' + esc(k) + '"' + (sel === k ? ' selected' : '') + '>' + esc(HOODS[k]) + '</option>'; }).join('') + '</select>';
  }
  function drawAdd() {
    var el = $('[data-wa-add]'); if (!el) return;
    var r = add.res, h = '';
    if (add.stage === 'write' || add.stage === 'checking') {
      h = '<label class="fld" for="wa-text">' + (desk.matches ? 'Missing something? Add it.' : 'What should Squamish do?') + '<span class="small">Write as much as you like. We’ll turn it into a short ask for the list and keep your words underneath it. Please don’t name private people.</span></label>' +
        '<textarea id="wa-text" rows="' + (desk.matches ? 4 : 6) + '" maxlength="2000" placeholder="For example: the off leash area at John Hunter Park still has no fence, so I can’t let my dog run there with kids nearby.">' + esc(add.text) + '</textarea>' +
        (add.msg ? '<p class="wa-msg bad">' + esc(add.msg) + '</p>' : '') +
        '<button type="button" class="btn block" data-check' + (add.stage === 'checking' ? ' disabled' : '') + '>' + (add.stage === 'checking' ? 'Checking the list…' : 'Check my idea') + '</button>' +
        '<p class="small muted">We check it against the asks already on the list first, so the same idea isn’t added twice.</p>';
    } else if (add.stage === 'similar') {
      h = '<div class="wa-similar"><h3>Is this the same as one already on the list?</h3><p class="small">It looks close to ' + (r.similar.length === 1 ? 'this ask' : 'these asks') + '. If it’s the same idea, answer that one instead so the votes stay together. You can add your words to it too.</p>' +
        r.similar.map(function (s) {
          var a = byId(s.id); if (!a) return '';
          return '<div class="wa-sim"><b>' + esc(a.title) + '</b>' + (s.how ? '<span class="small muted">' + esc(s.how) + '</span>' : '') +
            '<div class="wa-simbtns"><button type="button" class="btn secondary" data-goto="' + esc(a.id) + '">Yes, answer that one</button><button type="button" class="btn secondary" data-addwords="' + esc(a.id) + '">Add my words to it</button></div></div>';
        }).join('') +
        '<button type="button" class="btn block" data-different>No, mine is different</button><button type="button" class="wa-link center" data-rewrite>Change my words</button></div>';
    } else if (add.stage === 'rules') {
      h = '<div class="wa-msg bad"><b>Not quite yet.</b> ' + esc(r.reason || 'It doesn’t fit the list rules.') + '</div><button type="button" class="btn block" data-rewrite>Edit my idea</button>';
    } else if (add.stage === 'preview') {
      var d = r.draft;
      h = '<div class="wa-preview"><p class="small muted">This is how it will look on the list</p><span class="wa-chips"><span class="wa-chip res">Added by a resident</span></span><h3>' + esc(d.title) + '</h3>' + (d.why ? '<p>' + esc(d.why) + '</p>' : '') +
        '<div class="wa-words"><b>In your words</b><p>' + esc(add.text) + '</p></div>' +
        '<label class="fld">Is it about one neighbourhood?' + areaSelect(d.area || 'all') + '</label></div>' +
        (add.msg ? '<p class="wa-msg bad">' + esc(add.msg) + '</p>' : '') +
        '<button type="button" class="btn block" data-post>Add it to the list</button><button type="button" class="wa-link center" data-rewrite>Change my words</button>';
    } else if (add.stage === 'posted') {
      h = '<div class="wa-msg good"><b>' + (add.held ? 'Thanks. It will show on the list after a quick check.' : 'It’s on the list.') + '</b> ' + (add.held ? '' : 'We counted your yes. Share it so your neighbours can answer too.') + '</div>' +
        (add.held ? '' : '<button type="button" class="btn block" data-goto="' + esc(add.newId) + '">See it on the list</button><button type="button" class="btn secondary block" data-share="' + esc(add.newId) + '">Share it</button>') +
        '<button type="button" class="wa-link center" data-again>Add another</button>';
    } else if (add.stage === 'added-words') {
      h = '<div class="wa-msg good"><b>' + (add.held ? 'Thanks. Your words will show after a quick check.' : 'Your words are added to that ask.') + '</b> Don’t forget to answer it.</div><button type="button" class="btn block" data-goto="' + esc(add.wordsId) + '">Go to that ask</button><button type="button" class="wa-link center" data-again>Add something else</button>';
    }
    el.innerHTML = h;
  }
  // Phones show the add box in its own tab; desktop keeps it in the side rail, always open.
  function placeAdd() {
    var box = $('[data-wa-add]'), target = desk.matches ? $('[data-wa-addfoot]') : $('[data-pane="add"]');
    if (box && target && box.parentNode !== target) target.appendChild(box);
    var sh = $('[data-wa-sheet]'), st = desk.matches ? $('.wa-rail') : $('.wa-fixed');
    if (sh && st && sh.parentNode !== st) st.insertBefore(sh, st.firstChild);
    if (desk.matches && view === 'add') view = 'list';
  }

  // ---------- progress, people, floating counter, bottom sheet ----------
  function drawProgress() {
    var d = done(), n = asks.length;
    var pe = $('[data-wa-people]');
    if (pe && loaded) pe.innerHTML = (people ? '<b>' + people.toLocaleString('en-CA') + ' neighbour' + (people === 1 ? '' : 's') + '</b> ' + (people === 1 ? 'has' : 'have') + ' answered. ' + (d ? 'Keep going.' : 'Your turn.') : 'Be one of the first to answer.') + ' <a href="#wa-how">How it works</a>';
    var rp = $('[data-wa-railprog]');
    if (rp) rp.innerHTML = '<div class="wa-railring">' + ringSvg(d, n, 64) + '<p class="wa-railbig"><span><b>' + d + '</b> of ' + n + ' answered</span><span class="small muted">' + (d < UNLOCK ? 'The Top 10 opens after ' + UNLOCK + ' (' + (UNLOCK - d) + ' to go)' : d < n ? (n - d) + ' to go' : 'All done. Thank you') + '</span></p></div>' +
      (d < n ? '<button type="button" class="btn block" data-nextq>Next unanswered</button>' : '') +
      (d >= UNLOCK ? '<div class="wa-twobtn"><button type="button" class="btn secondary" data-view="top">Top 10</button><button type="button" class="btn secondary" data-share="@me">' + SHARE_ICON + 'My Squamish</button></div>' : '');
    drawRing(d, n); drawBoard(d);
    var lk = $('[data-wa-lock]'); if (lk) lk.textContent = d < UNLOCK ? ' 🔒' : '';
    var fl = $('[data-wa-float]');
    if (fl) {
      fl.hidden = !loaded || view !== 'list' || !!sheet;
      fl.innerHTML = '<span><b>' + d + '</b> of ' + n + ' answered</span>' + (d < n ? '<button type="button" data-nextq>Next unanswered <span aria-hidden="true">↓</span></button>' : '<button type="button" data-view="top">See the Top 10</button>');
    }
  }
  // ---------- progress ring, live board, live line ----------
  function ringSvg(d, n, size) {
    var r = 15.5, len = 2 * Math.PI * r;
    return '<svg class="wa-ringsvg" width="' + size + '" height="' + size + '" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="' + r + '" class="bg"/><circle cx="18" cy="18" r="' + r + '" class="fg" stroke-dasharray="' + len.toFixed(1) + '" stroke-dashoffset="' + (len * (1 - (n ? d / n : 0))).toFixed(1) + '"/></svg>';
  }
  // Phones: the raised Your say button in the bottom bar turns into this page's progress ring. Tapping it goes to the
  // next unanswered ask (in One by one, back up to the card).
  var ringA = mode === 'page' && !only ? document.querySelector('.tabbar a.tab-feature') : null;
  if (ringA) {
    ringA.classList.add('wa-ringtab');
    ringA.insertAdjacentHTML('afterbegin', '<span class="wa-ring" aria-hidden="true"><span class="wa-ringc"></span><span class="wa-ringn"><b>0</b><small>of 0</small></span></span>');
    ringA.addEventListener('click', function (e) {
      e.preventDefault(); stopAuto();
      if (done() >= asks.length) { setView('top'); return; }
      if (view === 'one') { var tb = $('[data-wa-tabs]'); if (tb) window.scrollTo({ top: window.scrollY + tb.getBoundingClientRect().top - 80, behavior: 'smooth' }); return; }
      nextUnanswered();
    });
  }
  function drawRing(d, n) {
    if (!ringA) return;
    ringA.querySelector('.wa-ringc').innerHTML = ringSvg(d, n, 66);
    ringA.querySelector('.wa-ringn').innerHTML = '<b>' + d + '</b><small>of ' + n + '</small>';
    ringA.setAttribute('aria-label', d + ' of ' + n + ' answered. ' + (d < n ? 'Go to the next unanswered ask' : 'See the Top 10'));
  }
  function bumpRing() { if (!ringA || REDUCED) return; ringA.classList.remove('bump'); void ringA.offsetWidth; ringA.classList.add('bump'); }
  // Desktop rail: the most wanted yes or no asks right now, moving as answers come in. Locked until 5 answers, like the
  // Top 10, so people answer before they look. Needs 10 people with a side; asks already done are left out.
  var boardPos = {};
  function drawBoard(d) {
    var el = $('[data-wa-board]'); if (!el || !desk.matches) return;
    var WHY = '<details class="wa-why"><summary>How is this ranked?</summary><p class="small">The share of yes among people who said yes or no. “Don’t mind” is counted but left out of the share, so an ask that matters to one neighbourhood isn’t buried by people it doesn’t affect. Asks need 10 people with a side to show here.</p></details>';
    if (d < UNLOCK) {
      el.innerHTML = '<h2>Most wanted, live</h2><ol class="wa-board locked" aria-hidden="true">' + [80, 64, 72, 56, 68].map(function (w, i) { return '<li><span class="wa-rk">' + (i + 1) + '</span><span class="wa-bt" style="width:' + w + '%"></span></li>'; }).join('') + '</ol><p class="small"><b>Answer ' + (UNLOCK - d) + ' more to see it.</b> It updates as you answer.</p>' + WHY;
      boardPos = {}; return;
    }
    var L = asks.filter(function (a) { return !multi(a) && a.status !== 'done' && opinions(a, t(a.id)) >= 10; }).sort(function (p, q) { return score(q) - score(p) || opinions(q, t(q.id)) - opinions(p, t(p.id)); }).slice(0, 5);
    var old = {};
    el.querySelectorAll('[data-bid]').forEach(function (li) { old[li.getAttribute('data-bid')] = li.getBoundingClientRect().top; });
    el.innerHTML = '<h2>Most wanted, live</h2><ol class="wa-board">' + L.map(function (a, i) {
      var up = boardPos[a.id] != null && boardPos[a.id] > i, x = t(a.id);
      return '<li data-bid="' + esc(a.id) + '"' + (up ? ' class="up"' : '') + '><button type="button" data-goto="' + esc(a.id) + '"><span class="wa-rk">' + (i + 1) + '</span><span class="wa-bn">' + esc(a.title) + (mine[a.id] ? '<small>You said ' + WORD[mine[a.id]].toLowerCase() + '</small>' : '') + '</span><b>' + pct(c(x, 'y'), opinions(a, x)) + '%</b></button></li>';
    }).join('') + '</ol>' + (L.length ? '<p class="small muted">Share of yes. Moves as people answer.</p>' : '<p class="small muted">Not enough answers yet.</p>') + WHY;
    // Rows that moved slide to their new place.
    if (!REDUCED) el.querySelectorAll('[data-bid]').forEach(function (li) {
      var was = old[li.getAttribute('data-bid')]; if (was == null) return;
      var dy = was - li.getBoundingClientRect().top; if (!dy) return;
      li.style.transform = 'translateY(' + dy + 'px)'; li.style.transition = 'none';
      requestAnimationFrame(function () { li.style.transition = 'transform .5s cubic-bezier(.2,.8,.2,1)'; li.style.transform = ''; });
    });
    boardPos = {}; L.forEach(function (a, i) { boardPos[a.id] = i; });
  }
  // Under the title: a line that rolls through what's happening (answers in the last hour, today, the newest ask).
  var liveT = null;
  function drawLive() {
    var el = $('[data-wa-live]'); if (!el) return;
    var msgs = [];
    if (live.hour >= 3) msgs.push(live.hour + ' answers in the last hour');
    if (live.day >= 5) msgs.push(live.day + ' answers today');
    var nw = asks.filter(function (a) { return a.res && Date.now() - (Date.parse(a.created_at) || 0) < 7 * 864e5; }).sort(function (p, q) { return Date.parse(q.created_at) - Date.parse(p.created_at); })[0];
    if (nw) msgs.push('Newest: ' + nw.title);
    if (!msgs.length) { el.hidden = true; return; }
    el.hidden = false;
    var i = 0;
    function show() { el.innerHTML = '<span class="wa-dot" aria-hidden="true"></span><span class="wa-livet">' + esc(msgs[i % msgs.length]) + '</span>'; i++; }
    show();
    if (liveT) clearInterval(liveT);
    if (msgs.length > 1 && !REDUCED) liveT = setInterval(show, 4000);
  }
  var sheet = null;
  function showSheet(kind) {
    var el = $('[data-wa-sheet]'); if (!el) return;
    var ms = get('sv_wa_ms', {}); ms[kind] = 1; put('sv_wa_ms', ms);
    sheet = kind;
    var h = '';
    if (kind === 'me5') h = '<p><b>That’s ' + UNLOCK + '. Here’s where you stand.</b> The Top 10 is open too.</p>' + meCard() + '<div class="wa-sheetbtns"><button type="button" class="btn" data-share="@me">' + SHARE_ICON + 'Share my card</button><button type="button" class="btn secondary" data-view="top">See the Top 10</button></div>';
    if (kind === 'five') h = '<p><b>Nice, that’s ' + UNLOCK + '.</b> The Top 10 is open. Share your picks so your neighbours can weigh in too.</p><div class="wa-sheetbtns"><button type="button" class="btn" data-view="top">See the Top 10</button><button type="button" class="btn secondary" data-share="@my">Share my picks</button></div>';
    if (kind === 'ten') h = '<p><b>10 answered. Thank you.</b> Want to know when council acts on any of these? Get a short email every Friday.</p><div class="wa-sheetbtns"><button type="button" class="btn" data-gosignup>Get the Friday email</button></div>';
    el.innerHTML = '<button type="button" class="wa-sheetx" data-sheetx aria-label="Close">×</button>' + h;
    el.hidden = false;
    drawProgress();
  }
  function closeSheet() { var el = $('[data-wa-sheet]'); if (el) el.hidden = true; sheet = null; drawProgress(); }
  function milestones(id) {
    if (mode !== 'page') return;
    var d = done(), ms = get('sv_wa_ms', {});
    if (d >= 1 && !prefs.area && !ms.area) { ms.area = 1; put('sv_wa_ms', ms); areaAsk = id; draw(); }
    else if (d >= 10 && !ms.ten && !sheet) showSheet('ten');
  }
  function nextUnanswered() {
    if (view !== 'list') { view = 'list'; draw(); }
    var rows = [].slice.call(root.querySelectorAll('[data-wa-rows] > .wa-row'));
    var below = rows.filter(function (r) { return !r.classList.contains('answered') && r.getBoundingClientRect().top > 140; });
    var r = below[0] || rows.filter(function (x) { return !x.classList.contains('answered'); })[0];
    if (!r) { topic = 'all'; order = null; draw(); return; }
    window.scrollTo({ top: window.scrollY + r.getBoundingClientRect().top - (desk.matches ? 100 : 90), behavior: 'smooth' });
  }

  // ---------- drawing ----------
  function draw() {
    if (mode === 'short') { drawShort(); return; }
    root.querySelectorAll('[data-wa-tabs] [data-view]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-view') === view)); });
    root.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== view; });
    root.querySelectorAll('[data-topic]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-topic') === topic)); });
    var ts = $('[data-wa-topic]'); if (ts) ts.value = TOPIC[topic] ? topic : 'all';
    if (view === 'list') drawList(); else if (view === 'one') drawOne(); else if (view === 'top') drawTop(); else drawAdd();
    drawProgress();
  }
  function drawShort() {
    var el = $('[data-wa-rows]'); if (!el) return;
    var pe = $('[data-wa-people]'); if (pe && loaded && people) pe.textContent = people.toLocaleString('en-CA') + (people === 1 ? ' person has' : ' people have') + ' answered so far.';
    var area = prefs.area, n = parseInt(root.getAttribute('data-count') || '3', 10);
    if (only) { var oa = byId(only); el.innerHTML = oa ? row(oa) : ''; return; }
    if (shortOrder) { el.innerHTML = shortOrder.map(byId).filter(Boolean).map(row).join(''); return; }
    var L = asks.slice().sort(function (p, q) {
      var mp = mine[p.id] ? 1 : 0, mq = mine[q.id] ? 1 : 0, lp = p.area && p.area === area ? 0 : 1, lq = q.area && q.area === area ? 0 : 1;
      return mp - mq || lp - lq || total(t(q.id)) - total(t(p.id));
    }).slice(0, n);
    if (touched) shortOrder = L.map(function (a) { return a.id; });
    el.innerHTML = L.map(row).join('');
  }

  // ---------- server ----------
  function load() {
    fetch('/api/wants/?voter=' + encodeURIComponent(voter)).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) return;
      (j.asks || []).forEach(function (a) { if (!byId(a.id)) asks.push({ id: a.id, title: a.title, why: a.why, topic: a.topic || 'other', area: a.area, body: a.body, created_at: a.created_at, res: true }); });
      tallies = j.tallies || {}; mine = j.mine || {}; notes = j.notes || {}; people = j.people || 0; loaded = true;
      live = j.live || live; trending = {};
      // Trending: the 3 asks with the most answers today, if at least 5 each.
      Object.keys(live.today || {}).filter(function (k) { return live.today[k] >= 5; }).sort(function (p, q) { return live.today[q] - live.today[p]; }).slice(0, 3).forEach(function (k) { trending[k] = true; });
      // Added answers, most picked first. Worked out once per load so buttons don't move while someone answers.
      asks.forEach(function (a) {
        var x = t(a.id);
        a.extra = ((j.extras || {})[a.id] || []).slice().sort(function (p, q) { return c(x, q.key) - c(x, p.key); });
      });
      if (!touched) { order = null; shortOrder = null; }
      if (mode === 'page') drawLive();
      // A shared link puts its ask first and scrolls to it, but leaves it closed: the results stay hidden until they answer.
      if (focusId && byId(focusId)) { draw(); var el = document.getElementById('ask-' + focusId); if (el) el.scrollIntoView({ block: 'center' }); }
      else draw();
    }).catch(function () {});
  }
  function post(body) {
    return fetch('/api/wants/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ voter: voter, dev: dev }, body)) })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'That didn’t go through. Check your connection and try again.' }; });
  }
  function sameCounts(p, q) { var k = {}, z; for (z in p || {}) k[z] = 1; for (z in q || {}) k[z] = 1; delete k.areas; return Object.keys(k).every(function (z) { return c(p, z) === c(q, z); }); }
  function answer(id, k) {
    if (!touched) { touched = true; if (mode === 'short' && !shortOrder) { var cur = [].map.call(root.querySelectorAll('[data-wa-rows] > .wa-row'), function (li) { return li.id.slice(4); }); if (cur.length) shortOrder = cur; } }
    var before = mine[id], x = Object.assign({ y: 0, n: 0, m: 0, areas: {} }, t(id));
    var choice = before === k ? '' : k;
    if (!done() && choice) people += 1; // their first answer anywhere on the list
    if (before) x[before] = Math.max(0, c(x, before) - 1);
    if (choice) x[choice] = c(x, choice) + 1;
    tallies[id] = x;
    if (choice) mine[id] = choice; else delete mine[id];
    // Show "tap again to undo" once, on the first ask they answer.
    if (choice && !hinted) { hinted = true; hintId = id; } // it stays put after that: removing it would shift the rows below
    if (choice && navigator.vibrate) try { navigator.vibrate(10); } catch (e) {}
    if (view === 'one') grown[id] = false;
    draw();
    if (choice) milestones(id);
    if (choice && view === 'one' && mode === 'page' && !sheet && areaAsk !== id) { startAuto(id); var cd = root.querySelector('.wa-card.wa-revealed'); if (cd) cd.classList.add('auto'); }
    bumpRing();
    if (pending[id]) return;
    pending[id] = true;
    post({ action: 'vote', wid: id, choice: choice, area: prefs.area || '' }).then(function (j) {
      pending[id] = false;
      // Unchanged numbers don't redraw, so the bars on the results card keep growing smoothly.
      if (j.ok) { var same = sameCounts(j.tally, tallies[id]) && j.choice === (mine[id] || ''); tallies[id] = j.tally; if (same) return; if (j.choice !== (mine[id] || '')) { post({ action: 'vote', wid: id, choice: mine[id] || '', area: prefs.area || '' }).then(function (k) { if (k.ok) { tallies[id] = k.tally; draw(); } }); } draw(); }
      else { if (before) mine[id] = before; else delete mine[id]; toast(j.error || 'That didn’t count. Please try again.'); load(); }
    });
    if (choice) track('Wants answer', { on: mode === 'short' ? location.pathname : view });
  }
  function sendSug() {
    var id = sug.id, a = id && byId(id), inp = $('#wa-sug');
    if (!a || sug.busy) return;
    sug.text = inp ? inp.value.trim() : sug.text.trim();
    if (sug.text.length < 3) { sug.msg = 'Write the answer you’d like to see.'; draw(); return; }
    sug.busy = true; sug.msg = ''; sug.same = ''; draw(); track('Wants add answer');
    post({ action: 'add-option', wid: id, text: sug.text, area: prefs.area || '' }).then(function (j) {
      sug.busy = false;
      if (!j.ok) sug.msg = j.error || 'That didn’t work. Please try again.';
      else if (j.rejected) sug.msg = j.rejected;
      else if (j.same) sug.same = j.same;
      else {
        sug = { id: null, text: '', busy: false, msg: '', same: '' };
        if (j.status !== 'ok') toast('Thanks. Your answer will show after a quick check.');
        else {
          if (!done()) people += 1;
          (a.extra = a.extra || []).push(j.option); tallies[id] = j.tally; mine[id] = j.option.key;
          toast('Added. Your answer is now “' + j.option.label + '”.');
          milestones(id);
        }
      }
      draw();
    });
  }
  function gotoAsk(id) {
    focusId = id; openId = id; topic = 'all'; view = 'list'; order = null; draw();
    var el = document.getElementById('ask-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function setView(v, fromTabs) {
    stopAuto();
    if (v === 'add' && desk.matches) { view = 'list'; draw(); var ta = $('#wa-text'); if (ta) { ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); ta.focus({ preventScroll: true }); } return; }
    view = v; if (v === 'one') deckShown = null; draw();
    var tb = $('[data-wa-tabs]');
    if (tb && (!fromTabs || tb.getBoundingClientRect().top < 70)) window.scrollTo({ top: window.scrollY + tb.getBoundingClientRect().top - 80, behavior: 'smooth' });
  }

  // ---------- events ----------
  root.addEventListener('click', function (e) {
    var b;
    if ((b = e.target.closest('[data-ans]'))) { if (b.closest('.wa-sug')) sug = { id: null, text: '', busy: false, msg: '', same: '' }; answer(b.getAttribute('data-id'), b.getAttribute('data-ans')); return; }
    if ((b = e.target.closest('[data-open]'))) { var oid = b.getAttribute('data-open'); openId = openId === oid ? null : oid; if (openId) track('Wants open'); draw(); return; }
    if ((b = e.target.closest('[data-view]'))) { if (b.closest('[data-wa-sheet]')) closeSheet(); setView(b.getAttribute('data-view'), !!b.closest('[data-wa-tabs]')); return; }
    if ((b = e.target.closest('[data-wa-topsort]'))) { topSort = b.getAttribute('data-wa-topsort'); drawTop(); return; }
    if ((b = e.target.closest('[data-topic]'))) { topic = b.getAttribute('data-topic'); focusId = null; order = null; draw(); return; }
    if (e.target.closest('[data-nextq]')) { nextUnanswered(); return; }
    if (e.target.closest('[data-sheetx]')) { closeSheet(); return; }
    if (e.target.closest('[data-areax]')) { areaAsk = null; draw(); return; }
    if (e.target.closest('[data-gosignup]')) { closeSheet(); var s = document.getElementById('signup'); if (s) { s.scrollIntoView({ behavior: 'smooth', block: 'center' }); var inp = s.querySelector('input[type=email]'); if (inp) setTimeout(function () { inp.focus({ preventScroll: true }); }, 400); } return; }
    if (e.target.closest('[data-next]')) { stopAuto(); deckShown = null; drawOne(); drawProgress(); return; }
    if ((b = e.target.closest('[data-skip]'))) { deckSkip[b.getAttribute('data-skip')] = true; deckShown = null; drawOne(); return; }
    if ((b = e.target.closest('[data-share]'))) { if (b.closest('[data-wa-sheet]')) closeSheet(); openShare(b.getAttribute('data-share')); return; }
    if (e.target.closest('[data-sharex]')) { shareSt = null; drawShare(); return; }
    if (e.target.closest('[data-sharetoggle]')) { shareSt.show = !shareSt.show; drawShare(); var tg = el$('[data-sharetoggle]'); if (tg) tg.focus({ preventScroll: true }); return; }
    var sx = shareSt && shareInfo(shareSt);
    if (sx && e.target.closest('[data-sharepost]')) {
      track('Wants share', { how: 'group', what: sx.what });
      copyText(sx.text + '\n' + sx.url).then(function () { shareSt.copied = true; }, function () { shareSt.copied = false; }).then(function () { shareSt.stage = 'copied'; drawShare(); var ta = el$('#wa-cap'); if (ta && !shareSt.copied) ta.select(); });
      return;
    }
    if (sx && (b = e.target.closest('[data-sharecopy]'))) {
      track('Wants share', { how: 'copy', what: sx.what });
      copyText(sx.url).then(function () { b.textContent = 'Copied ✓'; toast('Link copied. Paste it into a group post or a text.'); }, function () { window.prompt('Copy this link:', sx.url); });
      return;
    }
    if (sx && e.target.closest('[data-sharenative]')) { track('Wants share', { how: 'native', what: sx.what }); navigator.share({ title: 'What Squamish Wants', text: sx.text, url: sx.url }).catch(function () {}); return; }
    if (sx && e.target.closest('[data-sharefb]')) { track('Wants share', { how: 'facebook', what: sx.what }); window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(sx.url), 'fbshare', 'width=640,height=640,noopener'); return; }
    if ((b = e.target.closest('[data-more]'))) { var mid = b.getAttribute('data-more'); expanded[mid] = true; draw(); return; }
    if ((b = e.target.closest('[data-sug]')) && sug.id === b.getAttribute('data-sug')) { sug = { id: null, text: '', busy: false, msg: '', same: '' }; draw(); return; }
    if (b) { sug = { id: b.getAttribute('data-sug'), text: '', busy: false, msg: '', same: '' }; draw(); var si = $('#wa-sug'); if (si) si.focus({ preventScroll: true }); return; }
    if (e.target.closest('[data-sugx]')) { sug = { id: null, text: '', busy: false, msg: '', same: '' }; draw(); return; }
    if (e.target.closest('[data-sugsend]')) { sendSug(); return; }
    if ((b = e.target.closest('[data-optreport]'))) { var rk = b.getAttribute('data-optreport'), cut = rk.indexOf('#'); reported[rk] = true; draw(); post({ action: 'report', wid: rk.slice(0, cut), okey: rk.slice(cut + 1) }); return; }
    if ((b = e.target.closest('[data-report]'))) { var rid = b.getAttribute('data-report'); reported[rid] = true; draw(); post({ action: 'report', wid: rid }); return; }
    if ((b = e.target.closest('[data-goto]'))) { gotoAsk(b.getAttribute('data-goto')); return; }
    if (e.target.closest('[data-check]')) {
      var ta = $('#wa-text'); add.text = ta ? ta.value.trim() : add.text;
      if (add.text.length < 12) { add.msg = 'Add a little more so we can turn it into a clear ask.'; drawAdd(); return; }
      add.stage = 'checking'; add.msg = ''; drawAdd(); track('Wants suggest');
      post({ action: 'check', text: add.text }).then(function (j) {
        if (!j.ok) { add.stage = 'write'; add.msg = j.error || 'That didn’t work. Please try again.'; drawAdd(); return; }
        add.res = j;
        add.stage = !j.publish ? 'rules' : (j.similar || []).length ? 'similar' : 'preview';
        drawAdd();
      });
      return;
    }
    if (e.target.closest('[data-different]')) { add.stage = 'preview'; drawAdd(); return; }
    if (e.target.closest('[data-rewrite]')) { add.stage = 'write'; add.msg = ''; drawAdd(); return; }
    if (e.target.closest('[data-again]')) { add = { text: '', res: null, stage: 'write', msg: '' }; drawAdd(); return; }
    if ((b = e.target.closest('[data-addwords]'))) {
      var wid = b.getAttribute('data-addwords'); b.disabled = true;
      post({ action: 'add-words', wid: wid, text: add.text, draft: add.res.draft && Object.assign({}, add.res.draft, { publish: add.res.publish, held: add.res.held }), sig: add.res.sig }).then(function (j) {
        if (!j.ok) { add.stage = 'write'; add.msg = j.error || 'That didn’t work. Please try again.'; drawAdd(); return; }
        add.held = j.status !== 'ok'; add.wordsId = wid; add.stage = 'added-words';
        if (!add.held) (notes[wid] = notes[wid] || []).unshift({ text: add.text, at: new Date().toISOString() });
        drawAdd();
      });
      return;
    }
    if ((b = e.target.closest('[data-post]'))) {
      b.disabled = true; b.textContent = 'Adding…';
      var sel = $('[data-wa-newarea]');
      post({ action: 'post', text: add.text, draft: Object.assign({}, add.res.draft, { publish: add.res.publish, held: add.res.held }), sig: add.res.sig, area: sel ? sel.value : 'all', myArea: prefs.area || '' }).then(function (j) {
        if (!j.ok) { add.msg = j.error || 'That didn’t work. Please try again.'; drawAdd(); return; }
        add.held = j.status !== 'ok';
        if (!add.held) {
          var a = j.ask; asks.push({ id: a.id, title: a.title, why: a.why, topic: a.topic, area: a.area, body: a.body, created_at: a.created_at, res: true });
          mine[a.id] = 'y'; tallies[a.id] = { y: 1, n: 0, m: 0, areas: {} }; add.newId = a.id; order = null;
          if (view === 'list') drawList();
          drawProgress();
        }
        add.stage = 'posted'; drawAdd(); track('Wants post');
      });
      return;
    }
  });
  // Touching the results card (to read, scroll a bar, pick an area) stops it moving on by itself.
  root.addEventListener('pointerdown', function (e) { if (advT && e.target.closest('.wa-card.wa-revealed') && !e.target.closest('[data-next]')) stopAuto(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopAuto(); });
  root.addEventListener('input', function (e) { if (e.target.id === 'wa-text') add.text = e.target.value; if (e.target.id === 'wa-sug') sug.text = e.target.value; });
  root.addEventListener('keydown', function (e) { if (e.target.id === 'wa-sug' && e.key === 'Enter') { e.preventDefault(); sendSug(); } });
  document.addEventListener('keydown', function (e) { if (shareSt && e.key === 'Escape') { shareSt = null; drawShare(); } });
  root.addEventListener('change', function (e) {
    var areaPick = e.target.matches('[data-wa-area]') || e.target.matches('[data-wa-sheetarea]');
    if (areaPick) {
      prefs.area = e.target.value; put('sv_prefs', prefs);
      var main = $('[data-wa-area]'); if (main) main.value = prefs.area;
      if (e.target.matches('[data-wa-sheetarea]')) { areaAsk = null; if (topic === 'near') order = null; draw(); }
      else { order = null; draw(); }
    }
    if (e.target.matches('[data-wa-topic]')) { topic = e.target.value; focusId = null; order = null; draw(); }
    if (e.target.matches('[data-wa-sort]')) { sort = e.target.value; focusId = null; order = null; draw(); }
  });
  // One by one on a keyboard: Y, N, M to answer, the right arrow to skip, Enter for the next ask.
  document.addEventListener('keydown', function (e) {
    if (mode !== 'page' || view !== 'one' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
    var k = e.key.toLowerCase(), a = deckShown && byId(deckShown);
    if (!a) return;
    if (mine[a.id]) { if (k === 'enter' || k === 'arrowright') { e.preventDefault(); stopAuto(); deckShown = null; drawOne(); drawProgress(); } return; }
    if (multi(a) && /^[1-9]$/.test(k) && shown(a)[+k - 1]) { e.preventDefault(); answer(a.id, shown(a)[+k - 1].key); }
    else if (k === 'm' || (!multi(a) && (k === 'y' || k === 'n'))) { e.preventDefault(); answer(a.id, k); }
    else if (k === 'arrowright') { e.preventDefault(); deckSkip[a.id] = true; deckShown = null; drawOne(); }
  });
  var areaSel = $('[data-wa-area]'); if (areaSel) areaSel.value = prefs.area || '';
  window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (byId(h)) gotoAsk(h); });
  if (mode === 'page') {
    placeAdd(); drawAdd();
    if (desk.addEventListener) desk.addEventListener('change', function () { placeAdd(); drawAdd(); draw(); });
  }
  draw();
  load();
})();
