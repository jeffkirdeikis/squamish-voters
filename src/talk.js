// Deep stories: the comments under the story (build.mjs talkHtml, api/wants.js "comment" actions) and the
// "what it means for my bill" box (build.mjs st.calc). Uses the same saved reader id as the votes (sv_voter), so a
// reader's comment shows the answer they gave to the story's main question.
(function () {
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function track(n, d) { if (window.SV && SV.track) try { SV.track(n, d); } catch (e) {} }
  function toast(m) { if (window.SV && SV.toast) SV.toast(m); }
  var money = function (n) { return '$' + Math.round(n).toLocaleString('en-CA'); };

  // ---------- Your bill ----------
  [].forEach.call(document.querySelectorAll('[data-calc]'), function (box) {
    var inp = box.querySelector('[data-calc-in]'), out = box.querySelectorAll('[data-calc-out] em');
    var saved = get('sv_calc_bill', null); if (saved) inp.value = saved;
    function draw() {
      var v = parseFloat(inp.value); if (!(v >= 0)) v = 0;
      [].forEach.call(out, function (em) {
        var p = parseFloat(em.getAttribute('data-pct')), add = v * p / 100;
        em.innerHTML = (p === 0 ? '<b>' + money(0) + '</b> more' : '<b>+' + money(add) + '</b> a year<small>about ' + money(add / 12) + ' a month, ' + money(v + add) + ' total</small>');
      });
    }
    var t; inp.addEventListener('input', function () { draw(); clearTimeout(t); t = setTimeout(function () { put('sv_calc_bill', inp.value); track('Bill calculator', {}); }, 800); });
    draw();
  });

  // ---------- Comments ----------
  var box = document.querySelector('[data-talk]');
  if (!box || !window.fetch) return;
  var story = box.getAttribute('data-talk');
  var voter = get('sv_voter', '');
  if (!voter) { voter = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)); put('sv_voter', voter); }
  var list = box.querySelector('[data-talk-list]'), form = box.querySelector('[data-talk-form]'), ta = form.querySelector('textarea'), msg = box.querySelector('[data-talk-msg]');
  var bar = box.querySelector('[data-talk-bar]'), count = box.querySelector('[data-talk-count]');
  var C = [], held = [], sort = 'top', open = {}, busy = false;

  function ago(t) {
    var m = (Date.now() - new Date(t)) / 60000;
    if (m < 1) return 'just now'; if (m < 60) return Math.round(m) + ' min ago'; if (m < 1440) return Math.round(m / 60) + ' h ago';
    if (m < 10080) { var d = Math.round(m / 1440); return d + (d === 1 ? ' day ago' : ' days ago'); }
    return new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }
  function post(body) {
    body.voter = voter;
    return fetch('/api/wants/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || 'Something went wrong. Please try again.'); return j; }); });
  }
  function one(c, kids) {
    var h = '<li class="nw-c' + (c.mine ? ' mine' : '') + (c.status ? ' held' : '') + '" id="c-' + esc(c.id) + '"><div class="nw-c-head">' +
      (c.stance ? '<span class="nw-c-st">Answered: ' + esc(c.stance) + '</span>' : '<span class="nw-c-st none">Resident</span>') +
      '<span class="nw-c-at">' + esc(ago(c.at)) + (c.mine ? ' · you' : '') + '</span></div>' +
      '<p class="nw-c-text">' + esc(c.text).replace(/\n/g, '<br>') + '</p>';
    if (c.status) h += '<p class="nw-c-held">' + (c.status === 'hidden' ? 'Only you can see this. ' + esc(c.note || 'It breaks one of the rules.') : 'Only you can see this until we’ve had a look at it.') + '</p>';
    else h += '<div class="nw-c-acts">' +
      '<button type="button" data-like="' + esc(c.id) + '" aria-pressed="' + (c.liked ? 'true' : 'false') + '"' + (c.mine ? ' disabled' : '') + '>👍 Agree' + (c.likes ? ' <b>' + c.likes + '</b>' : '') + '</button>' +
      (c.parent ? '' : '<button type="button" data-reply="' + esc(c.id) + '">Reply</button>') +
      (c.mine ? '<button type="button" data-del="' + esc(c.id) + '">Delete</button>' : '<button type="button" class="nw-c-rep" data-report="' + esc(c.id) + '">Report</button>') + '</div>';
    if (!c.parent) {
      if (kids && kids.length) h += '<ol class="nw-c-kids">' + kids.map(function (k) { return one(k); }).join('') + '</ol>';
      if (open[c.id]) h += '<form class="nw-c-rform" data-rform="' + esc(c.id) + '"><label class="visually-hidden" for="r-' + esc(c.id) + '">Your reply</label><textarea id="r-' + esc(c.id) + '" maxlength="1000" rows="2" placeholder="Your reply" required></textarea><button type="submit" class="btn">Reply</button> <button type="button" class="btn secondary" data-rcancel="' + esc(c.id) + '">Cancel</button><p class="nw-poll-msg" role="status"></p></form>';
    }
    return h + '</li>';
  }
  function draw() {
    var all = C.concat(held);
    var tops = all.filter(function (c) { return !c.parent; }), kids = {};
    all.forEach(function (c) { if (c.parent) (kids[c.parent] = kids[c.parent] || []).push(c); });
    Object.keys(kids).forEach(function (k) { kids[k].sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }); });
    var score = function (c) { return (c.likes || 0) * 3 + (kids[c.id] || []).length * 2; };
    tops.sort(sort === 'top' ? function (a, b) { return (b.status ? 1e9 : 0) + score(b) - ((a.status ? 1e9 : 0) + score(a)) || String(b.at).localeCompare(String(a.at)); } : function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    count.textContent = C.length ? C.length + (C.length === 1 ? ' comment' : ' comments') : '';
    bar.hidden = C.length < 2;
    list.innerHTML = tops.length ? tops.map(function (c) { return one(c, kids[c.id]); }).join('') : '<li class="nw-talk-empty">No comments yet. Be the first to say what you think.</li>';
  }
  function load() {
    return fetch('/api/wants/?talk=' + encodeURIComponent(story) + '&voter=' + encodeURIComponent(voter)).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error();
      C = j.comments || []; held = j.waiting || []; draw();
    }).catch(function () { list.innerHTML = '<li class="nw-talk-empty">Comments couldn’t load. Reload the page to try again.</li>'; });
  }
  function send(text, parent, msgEl, done) {
    if (busy) return; busy = true; msgEl.textContent = 'Checking your comment…';
    post({ action: 'comment', story: story, text: text, parent: parent || undefined }).then(function (j) {
      busy = false;
      if (j.held || j.pending) { msgEl.textContent = j.held ? 'Not posted: ' + j.held : 'Thanks. It shows here once we’ve had a look at it.'; return load(); }
      msgEl.textContent = ''; done(); C = j.comments || C; held = j.waiting || []; draw();
      var el = document.getElementById('c-' + j.comment.id); if (el) { el.classList.add('fresh'); el.scrollIntoView({ block: 'nearest' }); }
      track(parent ? 'Story reply' : 'Story comment', { story: story });
    }).catch(function (e) { busy = false; msgEl.textContent = e.message; });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault(); var t = ta.value.trim(); if (t.length < 2) return;
    send(t, '', msg, function () { ta.value = ''; });
  });
  list.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-rform]'); if (!f) return; e.preventDefault();
    var id = f.getAttribute('data-rform'), t = f.querySelector('textarea').value.trim(); if (t.length < 2) return;
    send(t, id, f.querySelector('[role=status]'), function () { open[id] = false; });
  });
  list.addEventListener('click', function (e) {
    var b;
    if ((b = e.target.closest('[data-like]'))) {
      var c = C.filter(function (x) { return x.id === b.getAttribute('data-like'); })[0]; if (!c || c.mine) return;
      var undo = c.liked; c.liked = !undo; c.likes = (c.likes || 0) + (undo ? -1 : 1); draw();
      post({ action: 'comment-like', cid: c.id, undo: undo || undefined }).catch(function (err) { c.liked = undo; c.likes += undo ? 1 : -1; draw(); toast(err.message); });
      if (!undo) track('Story comment agree', { story: story });
      return;
    }
    if ((b = e.target.closest('[data-reply]'))) { var id = b.getAttribute('data-reply'); open[id] = true; draw(); var r = document.getElementById('r-' + id); if (r) r.focus(); return; }
    if ((b = e.target.closest('[data-rcancel]'))) { open[b.getAttribute('data-rcancel')] = false; draw(); return; }
    if ((b = e.target.closest('[data-report]'))) {
      b.disabled = true; post({ action: 'comment-report', cid: b.getAttribute('data-report') }).then(function () { b.textContent = 'Reported. Thanks'; }).catch(function (err) { b.disabled = false; toast(err.message); });
      return;
    }
    if ((b = e.target.closest('[data-del]'))) {
      if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = 'Tap again to delete'; return; }
      var did = b.getAttribute('data-del');
      post({ action: 'comment-delete', cid: did }).then(function () { C = C.filter(function (x) { return x.id !== did; }); held = held.filter(function (x) { return x.id !== did; }); draw(); }).catch(function (err) { toast(err.message); });
    }
  });
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-sort]'); if (!b) return; sort = b.getAttribute('data-sort');
    [].forEach.call(bar.querySelectorAll('[data-sort]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); draw();
  });
  // Load when the comments come near the screen (most readers never scroll that far).
  if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); load(); } }, { rootMargin: '600px' }); io.observe(box); }
  else load();
  if (location.hash.indexOf('#c-') === 0 || location.hash === '#talk') load().then(function () { var el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView({ block: 'center' }); });
})();
