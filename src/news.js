// Squamish news: friendly dates, section filter, share button. The pages work without it.
(function () {
  var DAY = 864e5;
  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

  // "Yesterday", "3 days ago"; older stories keep their date.
  var t0 = today();
  document.querySelectorAll('time[data-rel]').forEach(function (t) {
    var n = Math.round((t0 - parse(t.getAttribute('datetime'))) / DAY);
    t.title = t.textContent;
    if (n === 0) t.textContent = 'Today';
    else if (n === 1) t.textContent = 'Yesterday';
    else if (n > 1 && n < 7) t.textContent = n + ' days ago';
  });

  // Dates that have passed drop off "Coming up".
  document.querySelectorAll('[data-until]').forEach(function (li) {
    if (parse(li.getAttribute('data-until')) < t0) li.hidden = true;
  });
  var cu = document.querySelector('.nw-coming');
  if (cu && !cu.querySelector('li:not([hidden])')) cu.hidden = true;

  // Section filter.
  var chips = document.querySelectorAll('.nw-chip');
  var stories = document.querySelectorAll('.nw article[data-s]');
  var empty = document.querySelector('[data-nw-empty]');
  chips.forEach(function (ch) {
    ch.addEventListener('click', function () {
      var f = ch.getAttribute('data-f');
      chips.forEach(function (c) { c.setAttribute('aria-pressed', c === ch ? 'true' : 'false'); });
      stories.forEach(function (a) { a.hidden = !(f === 'all' || a.getAttribute('data-s') === f); });
      document.querySelectorAll('.nw [data-group]').forEach(function (g) {
        g.hidden = !g.querySelector('article[data-s]:not([hidden])');
      });
      if (empty) empty.hidden = !!document.querySelector('.nw-main article[data-s]:not([hidden])');
      if (window.SV && SV.track) SV.track('News filter', { section: f });
    });
  });

  // Fade on the chip row until it is scrolled to the end, so people know it swipes.
  var row = document.querySelector('.nw-chips'), wrap = document.querySelector('.nw-chips-wrap');
  if (row && wrap) {
    var edge = function () { wrap.classList.toggle('at-end', row.scrollLeft + row.clientWidth >= row.scrollWidth - 4); };
    row.addEventListener('scroll', edge, { passive: true }); window.addEventListener('resize', edge); edge();
  }

  // Stories Jeff just approved show right away, before the site is rebuilt with them (api/news-live.js).
  var live = document.querySelector('[data-nw-live]');
  if (live && window.fetch) {
    fetch('/api/news-live/').then(function (r) { return r.json(); }).then(function (d) {
      var have = {};
      document.querySelectorAll('.nw-h a').forEach(function (a) { have[a.getAttribute('href')] = 1; });
      var e = function (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
      var n = 0;
      (d.stories || []).forEach(function (st) {
        var url = '/news/' + st.slug + '/';
        if (have[url]) return;
        var a = document.createElement('article');
        // The newest one runs full width like the top story; any others sit as cards beside each other.
        var top = n++ === 0;
        a.className = top ? 'nw-lead solo' : 'nw-card'; a.setAttribute('data-s', st.s);
        a.innerHTML = (st.photo ? '<figure class="nw-photo"><img src="' + e(st.photo.remote) + '" alt="' + e(st.photo.alt) + '"><figcaption>' + e(st.photo.caption) + ' <span>Photo: ' + e(st.photo.credit) + '</span></figcaption></figure>' : '') + '<div class="nw-kicker"><span>' + e(st.sec) + '</span><time>Just now</time></div>' + (top ? '<h2' : '<h3') + ' class="nw-h"><a href="' + url + '">' + e(st.head) + '</a>' + (top ? '</h2>' : '</h3>') +
          (st.big ? '<div class="nw-big">' + e(st.big) + '<small>' + e(st.small) + '</small></div>' : '') + '<p class="nw-dek">' + e(st.dek) + '</p>' +
          (st.take ? '<p class="nw-take"><b>What changes</b>' + e(st.take) + '</p>' : '') +
          '<div class="nw-foot"><p class="nw-src">Source: <a href="' + e(st.src[1]) + '" target="_blank" rel="noopener">' + e(st.src[0]) + '</a></p><button class="nw-share no-print" type="button" data-nw-share="https://squamishvoters.com' + url + '" data-title="' + e(st.head) + '">Share</button></div>';
        live.appendChild(a); live.hidden = false;
      });
    }).catch(function () {});
  }

  // Tap anywhere on a story box to open the full story (links and buttons inside it still do their own thing).
  var mark = function () {
    document.querySelectorAll('.nw-main article[data-s], .nw-rail article[data-s]').forEach(function (a) {
      if (a.hasAttribute('data-open')) return;
      var h = a.querySelector('.nw-h a'); if (h) a.setAttribute('data-open', h.getAttribute('href'));
    });
  };
  mark();
  if (window.MutationObserver && live) new MutationObserver(mark).observe(live, { childList: true });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-open]');
    if (!a || e.target.closest('a, button, input, label, summary') || (window.getSelection && String(window.getSelection()).length)) return;
    var url = a.getAttribute('data-open');
    if (e.metaKey || e.ctrlKey) window.open(url, '_blank'); else location.href = url;
  });

  // Share: the phone's own share sheet where there is one, otherwise copy the link.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-nw-share]');
    if (!b) return;
    var url = b.getAttribute('data-nw-share'), title = b.getAttribute('data-title');
    if (window.SV && SV.track) SV.track('News share', { url: url });
    if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
    var done = function () { if (window.SV && SV.toast) SV.toast('Link copied. Paste it into Facebook or a text.'); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link:', url); });
    else window.prompt('Copy this link:', url);
  });
})();

// "What does this mean for me?" on flood stories: one area at a time, remembered on this device.
(function () {
  var box = document.querySelector('[data-me]');
  if (!box) return;
  var KEY = 'sv-flood-area';
  var chips = box.querySelectorAll('.fl-me-chip'), outs = box.querySelectorAll('[data-me-out]');
  function show(i, save) {
    chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-i') === String(i))); });
    outs.forEach(function (o) { o.hidden = o.getAttribute('data-me-out') !== String(i); });
    if (save) try { localStorage.setItem(KEY, chips[i] ? chips[i].textContent : ''); } catch (e) {}
  }
  chips.forEach(function (c) { c.addEventListener('click', function () { show(c.getAttribute('data-i'), true); }); });
  var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) {}
  var start = -1; chips.forEach(function (c, i) { if (c.textContent === saved) start = i; });
  show(start, false);
})();

// Folded story sections (details.nw-fsec / .nw-fold): a jump link or a #link straight to one opens it first.
(function () {
  function openTo(id) {
    var el = id && document.getElementById(id); if (!el) return;
    for (var d = el; d; d = d.parentElement) if (d.tagName === 'DETAILS') d.open = true;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]'); if (a) openTo(decodeURIComponent(a.getAttribute('href').slice(1)));
  });
  window.addEventListener('hashchange', function () { openTo(decodeURIComponent(location.hash.slice(1))); });
  if (location.hash) openTo(decodeURIComponent(location.hash.slice(1)));
})();
