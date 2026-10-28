/* Quiz: one question per screen, big buttons, results computed entirely in the browser.
   Nothing is sent anywhere. */
(function () {
  var D = window.SV_DATA, Q = D.questions, root = document.getElementById('quiz');
  if (!root) return;
  var SHRINK = 2;
  var MIN_OVERLAP = 4; // a council member needs this many comparable answers to get a % match
  // Below this you disagree more than you agree. Such a candidate is never presented as a pick,
  // even when so few candidates are matchable that they'd otherwise fall into the top 6.
  var RECOMMEND = 55;
  var THIN = 6; // below this many comparable answers the card says "only N" — a 76% on five questions is weaker than a 61% on ten
  var CHOICES = [[2, 'Strongly agree'], [1, 'Somewhat agree'], [0, 'Mixed, I’m in the middle'], [-1, 'Somewhat disagree'], [-2, 'Strongly disagree']];
  var state = SV.store.get('sv26_quiz', null) || { answers: {}, important: {}, i: 0, done: false };

  function save() { SV.store.set('sv26_quiz', state); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function focusTop() { var h = root.querySelector('h2, .q-text'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } window.scrollTo(0, root.getBoundingClientRect().top + window.scrollY - 90); }

  function renderQuestion() {
    var q = Q[state.i], a = state.answers[q.id];
    root.innerHTML =
      '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + Q.length + '" aria-valuenow="' + state.i + '"><div style="width:' + (state.i / Q.length * 100) + '%"></div></div>' +
      '<p class="q-count"><b>' + (state.i + 1) + ' of ' + Q.length + '</b> · ' + esc(q.topic) + (Q.length - state.i - 1 > 0 && Q.length - state.i - 1 <= 3 ? ' · <b>' + (Q.length - state.i - 1) + ' to go</b>' : '') + '</p>' +
      '<h2 class="q-text">“' + esc(q.text) + '”</h2>' +
      (q.what ? '<p class="q-what"><b>' + esc(q.what.term) + '</b>: ' + esc(q.what.def) + '</p>' : '') +
      '<p class="q-why">' + esc(q.why) + '</p>' +
      // Above the answers: tapping an answer moves on, so anything below it can never be reached.
      '<label class="important"><input type="checkbox" id="imp"' + (state.important[q.id] ? ' checked' : '') + '><span>★ This one matters a lot to me <small>(counts double)</small></span></label>' +
      '<div class="answers" role="group" aria-label="Your answer: tap one to continue">' +
      CHOICES.map(function (c) { return '<button type="button" data-a="' + c[0] + '" aria-pressed="' + (a === c[0]) + '">' + c[1] + '</button>'; }).join('') +
      '<button type="button" class="skipbtn" data-a="skip" aria-pressed="' + (a === null) + '">Not sure, skip this one</button></div>' +
      '<div class="quiz-nav"><button type="button" class="btn secondary" id="back"' + (state.i === 0 ? ' disabled' : '') + '>← Back</button>' +
      (a !== undefined ? '<button type="button" class="btn" id="next">' + (state.i === Q.length - 1 ? 'See my matches →' : 'Next →') + '</button>' : '') + '</div>';
  }

  function score(c) {
    var sum = 0, wsum = 0, n = 0, rows = [];
    Q.forEach(function (q) {
      var u = state.answers[q.id], v = c.answers[q.id];
      if (u === undefined || u === null) return;
      // No answer from the candidate, but a comment: list it (unscored) so the voter still sees what they wrote.
      if (v === undefined || v === null) { if (c.notes && c.notes[q.id]) rows.push({ q: q, d: null, u: u, v: null }); return; }
      var w = state.important[q.id] ? 2 : 1, d = Math.abs(u - v);
      // 0 = same answer, 1 step apart = 0.67, 2 steps = 0.33, 3+ steps = 0.
      // (The old 1 - d/4 curve gave a middle answer half credit against a strong yes, which read as agreement.)
      sum += w * Math.max(0, 1 - d / 3); wsum += w; n++;
      rows.push({ q: q, d: d, u: u, v: v });
    });
    // Shrink toward 50% by SHRINK pseudo-questions so a thin public record can't top the list on 4 lucky answers.
    return { c: c, n: n, notes: rows.filter(function (x) { return c.notes && c.notes[x.q.id]; }).length, pct: n >= MIN_OVERLAP ? Math.round((sum + SHRINK * 0.5) / (wsum + SHRINK) * 100) : null, rows: rows };
  }
  function first(c) { var p = c.name.split(' '); return p[0].replace(/\.$/, '') === 'A' ? p[1] : p[0]; }
  function answeredCount() { return Q.filter(function (x) { return typeof state.answers[x.id] === 'number'; }).length; }
  function word(v) { return { '2': 'strongly agrees', '1': 'somewhat agrees', '0': 'is in the middle', '-1': 'somewhat disagrees', '-2': 'strongly disagrees' }[String(v)]; }
  function avatar(c) { return c.photo ? '<img class="avatar sm" src="' + c.photo + '" alt="">' : '<span class="avatar sm" aria-hidden="true">' + esc(c.initials) + '</span>'; }

  function matchCard(r, top) {
    var c = r.c;
    return '<div id="card-' + c.slug + '" class="match-card' + (top ? ' top' : '') + (r.pct < RECOMMEND ? ' far' : '') + '">' +
      '<a class="match" href="/council/' + c.slug + '/">' + avatar(c) +
      '<span class="match-txt"><b>' + esc(c.name) + '</b>' + (c.direct ? '<span class="badge direct">✓ Answered us directly</span>' : '') +
      '<span class="meter" aria-hidden="true"><span style="width:' + r.pct + '%"></span></span>' +
      '<span class="pctline"><b class="pct">' + r.pct + '%</b> ' + (r.pct < RECOMMEND ? 'match: you mostly disagree' : 'match') + ' · ' + 'based on ' + (r.n < THIN ? 'only ' : '') + r.n + ' of your ' + answeredCount() + ' answers' + '</span></span>' +
      '<span class="go" aria-hidden="true">\u203a</span></a>' +
      (r.notes ? '<p class="small notes-hint">💬 ' + esc(first(c)) + ' added comments on ' + r.notes + ' of these. Open “Why ' + r.pct + '%?” to read them in their own words.</p>' : '') +
      '<div class="match-foot no-print">' +
      '<details id="why-' + c.slug + '"><summary>Why ' + r.pct + '%? ' + tally(r.rows) + '</summary><p class="small">✓ same answer as you (counts in full) · ~ one step off (counts two-thirds) · ✕ further apart (counts a third or nothing)</p><ul class="agree-list">' +
      r.rows.slice().sort(function (a, b) { return (a.d === null ? 9 : a.d) - (b.d === null ? 9 : b.d); }).map(function (x) {
        var last = esc(c.name.split(' ').slice(-1)[0]), note = c.notes && c.notes[x.q.id];
        return '<li class="' + (x.d === null ? 'none' : x.d === 0 ? 'same' : x.d === 1 ? 'part' : 'diff') + '"><b>' + esc(x.q.short) + ':</b> ' + last + ' ' + (x.d === null ? 'didn’t pick an answer, but wrote a comment' : word(x.v)) +
          (note ? '<details class="qnote"><summary>💬 Read ' + last + '’s comment</summary><blockquote>“' + esc(note) + '”</blockquote></details>' : '') + '</li>';
      }).join('') + '</ul><p class="small">Based on ' + r.n + ' of your ' + Q.length + ' answers.</p></details></div></div>';
  }

  // Headline for the "Why N%?" toggle. The buckets are the same ones the score uses, so the
  // words and the number can't disagree (a voter once read "close on 9 of 10" as a 90% match).
  function tally(rows) {
    var same = 0, near = 0;
    rows = rows.filter(function (x) { return x.d !== null; });
    rows.forEach(function (x) { if (x.d === 0) same++; else if (x.d === 1) near++; });
    var far = rows.length - same - near, parts = [];
    if (same) parts.push('same answer on ' + same);
    if (near) parts.push('one step off on ' + near);
    if (far) parts.push('further apart on ' + far);
    return 'Of ' + rows.length + ': ' + parts.join(', ');
  }
  // The council is already chosen, so results are one ranked list of all 7: no shortlist, no ballot.
  var REPO = 'https://github.com/jeffkirdeikis/squamish-voters';
  function caveat() { return 'Matches use what each council member <b>said during the campaign</b>. As council votes on these questions, their voting record is shown next to it on their page.'; }
  // Shown once, between the last answer and the results, so nobody reads a match as a verdict.
  function renderGate() {
    root.innerHTML = '<div class="gate"><h2>Before you see your matches</h2>' +
      '<p>' + caveat() + '</p>' +
      '<p>Please treat this as a starting point. Every council member has a page with their answers, their promises and how they have voted.</p>' +
      '<p>This quiz has <b>no agenda</b>. Every score comes only from what council members said and did in public or told us directly, and each one links to its source. The whole site is <b>open source</b>: <a href="' + REPO + '" target="_blank" rel="noopener">github.com/jeffkirdeikis/squamish-voters</a>.</p>' +
      '<div class="btn-row"><button class="btn big" id="showres" type="button">Show my matches →</button><a class="btn secondary" href="/council/">Meet the council</a></div></div>';
  }
  function renderResults() {
    var answered = Q.filter(function (q) { return typeof state.answers[q.id] === 'number'; }).length;
    if (answered < MIN_OVERLAP) {
      root.innerHTML = '<h2>We need a few more answers</h2><p>You skipped most questions, so we can’t work out a match. Answer at least ' + MIN_OVERLAP + ' questions.</p><button class="btn" id="restart" type="button">Start again</button>';
      return;
    }
    var all = D.candidates.map(score);
    var ranked = all.filter(function (r) { return r.pct !== null; }).sort(function (a, b) { return b.pct - a.pct || b.n - a.n; });
    var thin = all.filter(function (r) { return r.pct === null; });
    var html = '<p class="reminder">' + caveat() + '</p>';
    html += '<h2>Who on council thinks most like you</h2>' + ranked.map(function (r, i) { return matchCard(r, i === 0 && r.pct >= RECOMMEND); }).join('');
    html += thinList(thin);
    html += '<p class="small">A match is only as good as the record. <a href="/about/#quiz">How matching works</a>.</p>';
    html += '<div class="btn-row no-print"><a class="btn big" href="/meetings/">See what council is deciding →</a><a class="btn secondary" href="/compare/#compass">★ See yourself on the compass</a><button class="btn secondary" id="share" type="button">Share</button><button class="btn secondary" id="restart" type="button">Start again</button></div>';
    root.innerHTML = html;
    var tpl = document.getElementById('tpl-compass'), first = root.querySelector('.match-card');
    if (tpl && first) { var mc = tpl.content.firstElementChild.cloneNode(true); root.insertBefore(mc, root.querySelector('h2')); if (!SV.compassYou(mc)) mc.remove(); }
  }
  function thinList(list) {
    if (!list.length) return '';
    return '<div class="card" style="margin:.8rem 0"><h3>Not enough public information to match</h3><p class="small">We don’t have enough of their answers on the questions you answered. Read their page to see what they have said.</p><ul class="namechips">' +
      list.map(function (r) { return '<li><a href="/council/' + r.c.slug + '/">' + esc(r.c.name) + '</a></li>'; }).join('') + '</ul></div>';
  }

  function render() {
    var intro = document.getElementById('quiz-intro');
    if (intro) intro.hidden = state.done || state.i > 0;
    if (state.done && !state.counted) { state.counted = true; save(); SV.track('Quiz finished'); }
    if (state.done && !state.ack) renderGate(); else if (state.done) renderResults(); else renderQuestion();
  }

  root.addEventListener('click', function (e) {
    var f = e.target.closest('[data-why]');
    if (f) { var d = document.getElementById('why-' + f.getAttribute('data-why')); if (d) d.open = true; return; }
    var t = e.target.closest('button'); if (!t) return;
    var q = Q[state.i];
    if (t.hasAttribute('data-a')) {
      var v = t.getAttribute('data-a');
      if (state.i === 0 && !state.started) { state.started = true; SV.track('Quiz started'); }
      state.answers[q.id] = v === 'skip' ? null : parseInt(v, 10);
      save();
      // show the choice for a moment, then move on by itself (one tap per question)
      root.querySelectorAll('[data-a]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === t)); x.disabled = true; });
      // how far people get (every 5th question) — the step number only, never the answer
      if ((state.i + 1) % 5 === 0 && state.i + 1 < Q.length) SV.track('Quiz reached', { question: state.i + 1 });
      setTimeout(function () { if (state.i < Q.length - 1) state.i++; else state.done = true; save(); render(); focusTop(); }, 450);
    } else if (t.id === 'showres') {
      state.ack = true; save(); render(); focusTop();
    } else if (t.id === 'next') {
      if (state.i < Q.length - 1) state.i++; else state.done = true;
      save(); render(); focusTop();
    } else if (t.id === 'back') {
      if (state.i > 0) state.i--; save(); render(); focusTop();
    } else if (t.id === 'restart') {
      state = { answers: {}, important: {}, i: 0, done: false }; save(); render(); focusTop();
    } else if (t.id === 'share') {
      SV.track('Quiz share');
      var txt = 'Which Squamish council member thinks most like you? Take the quiz.';
      if (navigator.share) navigator.share({ title: 'Squamish Voters', text: txt, url: 'https://squamishvoters.com/quiz/' }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(txt + ' https://squamishvoters.com/quiz/').then(function () { SV.toast('Link copied'); });
    }
  });
  root.addEventListener('change', function (e) {
    if (e.target.id === 'imp') { state.important[Q[state.i].id] = e.target.checked; save(); }
  });
  if (state.done) state.counted = true; // finished before this visit: don't count it again
  render();
})();
