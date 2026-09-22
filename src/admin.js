/* Private responses view. Polls the API so new answers appear on their own. */
(function () {
  var Q = window.SV_Q, list = document.getElementById('a-list'), status = document.getElementById('a-status');
  var token = new URLSearchParams(location.search).get('token') || '';
  var WORD = { '2': 'Strongly agree', '1': 'Somewhat agree', '0': 'Mixed / middle', '-1': 'Somewhat disagree', '-2': 'Strongly disagree' };
  var CLS = { '2': 'a2', '1': 'a1', '0': 'n0', '-1': 'd1', '-2': 'd2' };
  var lastCount = -1, timer;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function card(r) {
    var c = el('div', 'card resp' + (r.verified ? ' ok' : ' flagged'));
    var head = el('div', 'resp-head');
    var h = el('h2', null, r.who || '(no name)');
    head.append(h);
    head.append(el('span', 'tagpill ' + (r.verified ? 'good' : 'warn'), r.verified ? '✓ verified' : '⚠ needs checking'));
    if (r.duplicate) head.append(el('span', 'tagpill warn', 'duplicate'));
    c.append(head);
    c.append(el('p', 'small', r.email + ' · ' + new Date(r.received).toLocaleString('en-CA')));
    (r.flags || []).forEach(function (f) { c.append(el('p', 'flagline', '⚠ ' + f)); });

    var answers = r.answers || {}, ids = Object.keys(answers);
    if (ids.length) {
      c.append(el('h3', null, ids.length + ' answers'));
      var tbl = el('table', 'resp-table');
      Q.forEach(function (q) {
        if (!(q.id in answers)) return;
        var tr = el('tr');
        tr.append(el('td', 'qcell', (q.core ? '★ ' : '') + q.text));
        var td = el('td');
        td.append(el('span', 'cell ' + CLS[String(answers[q.id])], WORD[String(answers[q.id])]));
        if (r.notes && r.notes[q.id]) td.append(el('div', 'notecell', '“' + r.notes[q.id] + '”'));
        tr.append(td); tbl.append(tr);
      });
      c.append(tbl);
    }
    var w = r.writing || {}, wk = Object.keys(w);
    if (wk.length) {
      c.append(el('h3', null, 'In their own words'));
      wk.forEach(function (k) {
        c.append(el('p', 'small muted', k.replace(/_/g, ' ')));
        c.append(el('blockquote', null, w[k]));
      });
    }
    return c;
  }

  function render(d) {
    list.textContent = '';
    if (!d.count) {
      status.textContent = 'No responses yet. This page updates on its own as they arrive.';
      var empty = el('div', 'card');
      empty.append(el('p', null, 'Nothing has come in yet. The form candidates use is at squamishvoters.com/for-candidates/'));
      list.append(empty);
      return;
    }
    var s = d.summary || {};
    status.textContent = d.count + ' response' + (d.count === 1 ? '' : 's') + ' · ' + (s.verified || 0) + ' verified · ' + (s.needsReview || 0) + ' need checking';
    d.responses.forEach(function (r) { list.append(card(r)); });
  }

  function load(announce) {
    if (!token) { status.textContent = 'Missing token. Open this page using the private link.'; return; }
    fetch('/api/responses/?token=' + encodeURIComponent(token))
      .then(function (r) { if (r.status === 401) throw new Error('Wrong or missing token.'); return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error('Could not load.');
        if (d.count !== lastCount) {
          if (lastCount >= 0 && d.count > lastCount) document.title = '(' + d.count + ') Responses — Squamish Voters';
          lastCount = d.count; render(d);
        } else if (announce) { render(d); }
      })
      .catch(function (e) { status.textContent = e.message || 'Could not load.'; });
  }

  document.getElementById('a-refresh').addEventListener('click', function () { load(true); });
  document.getElementById('a-auto').addEventListener('change', function (e) {
    clearInterval(timer);
    if (e.target.checked) timer = setInterval(load, 20000);
  });
  timer = setInterval(load, 20000);
  load(true);
})();
