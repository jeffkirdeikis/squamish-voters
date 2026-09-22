/* Quiz: one question per screen, big buttons, results computed entirely in the browser.
   Nothing is sent anywhere. */
(function () {
  var D = window.SV_DATA, Q = D.questions, root = document.getElementById('quiz');
  if (!root) return;
  var SHRINK = 2;
  var MIN_OVERLAP = 4; // a candidate needs this many comparable answers to get a % match
  // Below this you disagree more than you agree. Such a candidate is never presented as a pick,
  // even when so few candidates are matchable that they'd otherwise fall into the top 6.
  var RECOMMEND = 55;
  var CHOICES = [[2, 'Strongly agree'], [1, 'Somewhat agree'], [0, 'Mixed — I’m in the middle'], [-1, 'Somewhat disagree'], [-2, 'Strongly disagree']];
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
      (q.what ? '<p class="q-what"><b>' + esc(q.what.term) + '</b> — ' + esc(q.what.def) + '</p>' : '') +
      '<p class="q-why">' + esc(q.why) + '</p>' +
      // Above the answers: tapping an answer moves on, so anything below it can never be reached.
      '<label class="important"><input type="checkbox" id="imp"' + (state.important[q.id] ? ' checked' : '') + '><span>★ This one matters a lot to me <small>(counts double)</small></span></label>' +
      '<div class="answers" role="group" aria-label="Your answer — tap one to continue">' +
      CHOICES.map(function (c) { return '<button type="button" data-a="' + c[0] + '" aria-pressed="' + (a === c[0]) + '">' + c[1] + '</button>'; }).join('') +
      '<button type="button" class="skipbtn" data-a="skip" aria-pressed="' + (a === null) + '">Not sure — skip this one</button></div>' +
      '<div class="quiz-nav"><button type="button" class="btn secondary" id="back"' + (state.i === 0 ? ' disabled' : '') + '>← Back</button>' +
      (a !== undefined ? '<button type="button" class="btn" id="next">' + (state.i === Q.length - 1 ? 'See my matches →' : 'Next →') + '</button>' : '') + '</div>';
  }

  function score(c) {
    var sum = 0, wsum = 0, n = 0, rows = [];
    Q.forEach(function (q) {
      var u = state.answers[q.id], v = c.answers[q.id];
      if (u === undefined || u === null || v === undefined || v === null) return;
      var w = state.important[q.id] ? 2 : 1, d = Math.abs(u - v);
      // 0 = same answer, 1 step apart = 0.67, 2 steps = 0.33, 3+ steps = 0.
      // (The old 1 - d/4 curve gave a middle answer half credit against a strong yes, which read as agreement.)
      sum += w * Math.max(0, 1 - d / 3); wsum += w; n++;
      rows.push({ q: q, d: d, u: u, v: v });
    });
    // Shrink toward 50% by SHRINK pseudo-questions so a thin public record can't top the list on 4 lucky answers.
    return { c: c, n: n, pct: n >= MIN_OVERLAP ? Math.round((sum + SHRINK * 0.5) / (wsum + SHRINK) * 100) : null, rows: rows };
  }
  function answeredCount() { return Q.filter(function (x) { return typeof state.answers[x.id] === 'number'; }).length; }
  function word(v) { return { '2': 'strongly agrees', '1': 'somewhat agrees', '0': 'is in the middle', '-1': 'somewhat disagrees', '-2': 'strongly disagrees' }[String(v)]; }
  function avatar(c) { return c.photo ? '<img class="avatar sm" src="' + c.photo + '" alt="">' : '<span class="avatar sm" aria-hidden="true">' + esc(c.initials) + '</span>'; }

  function matchCard(r, top) {
    var c = r.c;
    return '<div id="card-' + c.slug + '" class="match-card' + (top ? ' top' : '') + (r.pct < RECOMMEND ? ' far' : '') + '">' +
      '<a class="match" href="/candidates/' + c.slug + '/">' + avatar(c) +
      '<span class="match-txt"><b>' + esc(c.name) + '</b>' + (c.direct ? '<span class="badge direct">✓ Answered us directly</span>' : '') +
      '<span class="meter" aria-hidden="true"><span style="width:' + r.pct + '%"></span></span>' +
      '<span class="pctline"><b class="pct">' + r.pct + '%</b> ' + (r.pct < RECOMMEND ? 'match — you mostly disagree' : 'match') + ' · ' + 'based on ' + (r.n < 5 ? 'only ' : '') + r.n + ' of your ' + answeredCount() + ' answers' + '</span></span>' +
      '<span class="go" aria-hidden="true">\u203a</span></a>' +
      '<div class="match-foot no-print"><button type="button" class="btn secondary add" aria-label="Add ' + esc(c.name) + ' to my ballot" data-pick="' + c.slug + '" data-office="' + c.office + '" data-name="' + esc(c.name) + '">+ Add</button>' +
      '<details id="why-' + c.slug + '"><summary>Why ' + r.pct + '%? You’re close on ' + r.rows.filter(function (x) { return x.d <= 1; }).length + ' of ' + r.n + '</summary><p class="small">✓ close to you · ~ partly · ✕ far apart</p><ul class="agree-list">' +
      r.rows.slice().sort(function (a, b) { return a.d - b.d; }).map(function (x) {
        return '<li class="' + (x.d <= 1 ? 'same' : x.d >= 3 ? 'diff' : 'part') + '"><b>' + esc(x.q.short) + ':</b> ' + esc(c.name.split(' ').slice(-1)[0]) + ' ' + word(x.v) + '</li>';
      }).join('') + '</ul><p class="small">Based on ' + r.n + ' of your ' + Q.length + ' answers.</p></details></div></div>';
  }

  function good(list) { return list.filter(function (r) { return r.pct >= RECOMMEND; }); }
  function resultCard(m, c) {
    var gm = good(m).slice(0, 1), gc = good(c).slice(0, 6), picks = gm.concat(gc);
    if (!picks.length) return '<div class="result-card"><h2>No strong matches yet</h2><p class="small">None of the candidates we have enough information on agrees with you more than they disagree. Many candidates have said little in public — check their profiles or ask them directly.</p></div>';
    return '<div class="result-card"><h2>Your Squamish shortlist</h2>' +
      [['For mayor', gm, 'No clear match for mayor — compare the three below.'], ['For council — ' + gc.length + ' of 6', gc, 'No clear matches for council.']].map(function (g) {
        return '<p class="rf-h">' + g[0] + '</p>' + (g[1].length ? '<div class="result-faces">' + g[1].map(function (r) {
          return '<a href="#card-' + r.c.slug + '" data-why="' + r.c.slug + '"><span class="rf">' + avatar(r.c) + '<b>' + esc(r.c.name.split(' ').slice(-1)[0]) + '</b><span>' + r.pct + '%</span></span></a>';
        }).join('') + '</div>' : '<p class="small">' + g[2] + '</p>');
      }).join('') +
      (gc.length && gc.length < 6 ? '<p class="small">We only found ' + gc.length + ' council candidate' + (gc.length === 1 ? '' : 's') + ' who clearly agree' + (gc.length === 1 ? 's' : '') + ' with you. Pick the rest yourself, or vote for fewer — that’s allowed.</p>' : '') +
      '<p class="small">Tap a face to see why they match.</p>' +
      '<div class="btn-row no-print"><button type="button" class="btn" id="saveall">Save these to my ballot</button><button type="button" class="btn secondary" id="share">Share</button></div></div>';
  }

  var ST = D.stats || {};
  var REPO = 'https://github.com/jeffkirdeikis/squamish-voters';
  function caveat() { return '<b>Not all candidates</b> have answered our questionnaire yet.'; }
  // Shown once, between the last answer and the results, so nobody reads a match as a verdict.
  function renderGate() {
    root.innerHTML = '<div class="gate"><h2>Before you see your matches</h2>' +
      '<p>These results are <b>unbiased, but not yet fully reliable</b>. ' + caveat() + ' For the others we scored their public statements and votes, and some candidates have said very little, so they can’t be matched well or at all yet.</p>' +
      '<p>Please treat this as a starting point, not an answer. Every candidate has a profile on this site with their positions and sources. Read them before you decide.</p>' +
      '<p>This quiz has <b>no agenda</b>. Every score comes only from what candidates have said and done in public — their council votes, their websites and interviews, or their own answers to our questionnaire — and each one links to its source. Nothing is guessed. The whole site is <b>open source</b>: anyone can read the code and the data at <a href="' + REPO + '" target="_blank" rel="noopener">github.com/jeffkirdeikis/squamish-voters</a>.</p>' +
      '<div class="btn-row"><button class="btn big" id="showres" type="button">Show my matches →</button><a class="btn secondary" href="/candidates/">Browse the candidates</a></div></div>';
  }
  function renderResults() {
    var answered = Q.filter(function (q) { return typeof state.answers[q.id] === 'number'; }).length;
    if (answered < MIN_OVERLAP) {
      root.innerHTML = '<h2>We need a few more answers</h2><p>You skipped most questions, so we can’t work out a match. Answer at least ' + MIN_OVERLAP + ' questions.</p><button class="btn" id="restart" type="button">Start again</button>';
      return;
    }
    var all = D.candidates.map(score);
    function ranked(office) { return all.filter(function (r) { return r.c.office === office && r.pct !== null; }).sort(function (a, b) { return b.pct - a.pct || b.n - a.n; }); }
    function thin(office) { return all.filter(function (r) { return r.c.office === office && r.pct === null; }); }
    var m = ranked('mayor'), c = ranked('council'), html = '';
    html += '<p class="reminder">Based only on the public record, with a source for every score. ' + caveat() + ' <a href="/candidates/">Browse all candidates</a> · <a href="' + REPO + '" target="_blank" rel="noopener">Open source</a>.</p>';
    html += resultCard(m, c);
    html += '<h2>For Mayor <span class="small">(you vote for 1)</span></h2>' + m.map(function (r, i) { return matchCard(r, i === 0 && r.pct >= RECOMMEND); }).join('');
    html += thinList(thin('mayor'));
    var top = good(c).slice(0, 6), others = c.filter(function (r) { return top.indexOf(r) < 0; });
    html += '<h2>For Council <span class="small">(you can vote for up to 6)</span></h2>';
    html += top.length ? '<h3>Your ' + (top.length === 6 ? '6 ' : '') + 'closest</h3>' + top.map(function (r) { return matchCard(r, true); }).join('') : '<p>None of the council candidates we can match agrees with you more than they disagree.</p>';
    if (top.length && top.length < 6) html += '<p class="small">Only ' + top.length + ' council candidate' + (top.length === 1 ? '' : 's') + ' we can match agree' + (top.length === 1 ? 's' : '') + ' with you more than they disagree. We don’t fill the rest of your 6 with people you mostly disagree with.</p>';
    if (others.length) html += '<details class="drop"><summary>See the other ' + others.length + ' council candidates we could match</summary>' + others.map(function (r) { return matchCard(r, false); }).join('') + '</details>';
    html += thinList(thin('council'));
        html += '<p class="small">A match is only as good as the public record — some candidates have said very little, so they match on fewer questions. <a href="/about/#quiz">How matching works</a>.</p>';
    html += '<div class="btn-row no-print"><a class="btn big" href="/my-ballot/">Go to my ballot →</a><a class="btn secondary" href="/compass/">★ See yourself on “Where they lean”</a><button class="btn secondary" id="print" type="button">Print</button><button class="btn secondary" id="restart" type="button">Start again</button></div>';
    root.innerHTML = html;
    SV.renderPicks();
  }
  function thinList(list) {
    if (!list.length) return '';
    return '<div class="card" style="margin:.8rem 0"><h3>Not enough public information to match</h3><p class="small">We could not find enough public statements from these candidates on the questions you answered. That is not a mark against them — contact them or read their profile.</p><ul class="namechips">' +
      list.map(function (r) { return '<li><a href="/candidates/' + r.c.slug + '/">' + esc(r.c.name) + '</a></li>'; }).join('') + '</ul></div>';
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
    } else if (t.id === 'print') { window.print();
    } else if (t.id === 'saveall') {
      var all2 = D.candidates.map(score);
      var mm = all2.filter(function (r) { return r.c.office === 'mayor' && r.pct !== null; }).sort(function (a, b) { return b.pct - a.pct; });
      var cc = all2.filter(function (r) { return r.c.office === 'council' && r.pct !== null; }).sort(function (a, b) { return b.pct - a.pct; });
      mm = good(mm); cc = good(cc);
      SV.setBallot({ mayor: mm.length ? mm[0].c.slug : null, council: cc.slice(0, 6).map(function (r) { return r.c.slug; }) });
      SV.toast('Saved — see My ballot');
      SV.track('Quiz save all');
    } else if (t.id === 'share') {
      SV.track('Quiz share');
      var txt = 'I found my Squamish 6 — see where every candidate stands before Oct 17.';
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
