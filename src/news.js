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
